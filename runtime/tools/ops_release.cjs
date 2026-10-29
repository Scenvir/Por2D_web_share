'use strict';
// Deliberately no configurable CLI paths, service names or shell fragments.
// Installation must configure por2d.service to use current/runtime/server.cjs
// and WorkingDirectory=current/runtime. Releases must be operator-trusted and
// immutable during an operation; this is not a privilege boundary or sandbox.
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const {createHash} = require('node:crypto');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const base = '/home/ubuntu/por2d';
const defaults = {root:base+'/releases',current:base+'/current',state:base+'/operations-state.json'};
const shaPattern = /^[a-f0-9]{40}$/;
const nameFor = sha => 'Por2D_web_share-'+sha;

function health(port) {
  return new Promise((resolve,reject) => {
    const request = http.get({host:'127.0.0.1',port,path:'/healthz',timeout:3000},response => {
      let text = '';
      response.on('data',chunk => { text += chunk; if (text.length > 4096) request.destroy(Error('Oversized health response')); });
      response.on('error',reject);
      response.on('end',() => {
        try { if (response.statusCode !== 200) throw Error('Health HTTP '+response.statusCode); resolve(JSON.parse(text)); }
        catch (error) { reject(error); }
      });
    });
    request.on('timeout',() => request.destroy(Error('Health timeout'))); request.on('error',reject);
  });
}
function createOperations(layout = defaults, dependencies = {}) {
  const probe = dependencies.health || health;
  const restart = dependencies.restart || (() => promisify(execFile)('/usr/bin/systemctl',['restart','por2d.service'],{timeout:30000}));
  const delay = dependencies.delay || (ms => new Promise(resolve => setTimeout(resolve,ms)));
  async function realDirectory(directory) {
    if (await fs.realpath(directory) !== directory || !(await fs.lstat(directory)).isDirectory()) throw Error('Untrusted directory: '+directory);
  }
  async function validate(sha) {
    if (!shaPattern.test(sha || '')) throw Error('Release must be a full lowercase 40-character Git SHA');
    await realDirectory(layout.root);
    const directory = path.join(layout.root,nameFor(sha)), runtime = path.join(directory,'runtime');
    await realDirectory(directory); await realDirectory(runtime);
    const manifestPath = path.join(directory,'SHA256.json');
    if (await fs.realpath(manifestPath) !== manifestPath) throw Error('Symlink manifest rejected');
    const manifest = JSON.parse(await fs.readFile(manifestPath,'utf8'));
    const required = ['runtime/server.cjs','runtime/release.json','runtime/http-compression.cjs',
      'runtime/resource-cache.cjs','runtime/server-operations.cjs','runtime/editor-server.cjs',
      'runtime/dist/por2.js','runtime/dist/por2.wasm'];
    if (!manifest || Array.isArray(manifest) || required.some(name => !manifest[name])) throw Error('Invalid release manifest');
    for (const [relative,expected] of Object.entries(manifest)) {
      if (/[\\:\x00-\x1f\x7f]/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..') || path.isAbsolute(relative) || typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) throw Error('Invalid manifest path or digest');
      const filename = path.join(directory,relative);
      if (await fs.realpath(filename) !== filename || !(await fs.stat(filename)).isFile()) throw Error('Symlink/non-file artifact rejected');
      const actual = createHash('sha256').update(await fs.readFile(filename)).digest('hex');
      if (actual !== expected) throw Error('Artifact digest mismatch: '+relative);
    }
    const release = JSON.parse(await fs.readFile(path.join(runtime,'release.json'),'utf8'));
    if (typeof release.version !== 'string' || !release.version || release.version.length > 128) throw Error('Invalid release version');
    return {sha,directory,version:release.version};
  }
  async function currentIdentity() {
    const target = await fs.readlink(layout.current);
    const resolved = path.resolve(path.dirname(layout.current),target);
    const name = path.basename(resolved), sha = name.slice('Por2D_web_share-'.length);
    if (!shaPattern.test(sha) || resolved !== path.join(layout.root,nameFor(sha))) throw Error('Current release is not a managed release');
    return {sha,directory:resolved};
  }
  async function active() { return validate((await currentIdentity()).sha); }
  async function check(port,release) {
    const result = await probe(port);
    if (result.status !== 'ok' || result.protocol !== 11 || result.version !== release.version) throw Error('Unexpected health response');
  }
  async function postcheck(release) {
    let last;
    for (let i=0;i<15;i++) { try { await check(8000,release); return; } catch (error) { last=error; await delay(1000); } }
    throw last;
  }
  async function atomicLink(directory) {
    const temporary = layout.current+'.operations-'+process.pid;
    await fs.symlink(directory,temporary);
    try { await fs.rename(temporary,layout.current); } finally { await fs.unlink(temporary).catch(()=>{}); }
  }
  async function atomicState(value) {
    const temporary = layout.state+'.operations-'+process.pid;
    await fs.writeFile(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
    try { await fs.rename(temporary,layout.state); } finally { await fs.unlink(temporary).catch(()=>{}); }
  }
  async function run({sha,rollback=false,apply=false,healthPort} = {}) {
    if (rollback && sha) throw Error('Choose release or rollback');
    await realDirectory(path.dirname(layout.current));
    await realDirectory(path.dirname(layout.state));
    // Rescue requires a managed identity, not readable/healthy current files.
    // The persisted current SHA must still match exactly before choosing target.
    const previous = rollback ? await currentIdentity() : await active();
    if (rollback) {
      if (await fs.realpath(layout.state) !== layout.state) throw Error('Symlink state rejected');
      const state = JSON.parse(await fs.readFile(layout.state,'utf8'));
      if (state.current !== previous.sha) throw Error('Rollback state does not match current release');
      sha = state.previous;
    }
    const candidate = await validate(sha);
    if (candidate.sha === previous.sha) throw Error('Release is already active');
    if (!rollback && (!Number.isInteger(healthPort) || healthPort < 1024 || healthPort > 65535 || healthPort === 8000)) throw Error('Candidate --health-port must be 1024..65535, excluding 8000');
    // Rollback is a rescue operation: an unhealthy current process must not
    // prevent restoring the validated previous release. Check it after restart.
    if (!rollback) await check(healthPort,candidate);
    const plan = {action:rollback?'rollback':'deploy',apply,previous:previous.sha,current:candidate.sha,
      currentLink:layout.current,service:'por2d.service',preserved:previous.directory};
    if (!apply) return plan;
    // Exclusive lock prevents two helpers racing. A stale lock requires explicit
    // operator inspection, never silent deletion or guessing about partial state.
    const lock = await fs.open(layout.state+'.lock','wx',0o600);
    try {
      if ((await currentIdentity()).sha !== previous.sha) throw Error('Current changed after preflight');
      await atomicLink(candidate.directory);
      try {
        await restart(); await postcheck(candidate);
        await atomicState({current:candidate.sha,previous:previous.sha});
      } catch (error) {
        await atomicLink(previous.directory);
        try { await restart(); if (!rollback) await postcheck(previous); }
        catch (restoreError) {
          throw Error('Release failed; previous link restored but recovery failed'+
            (rollback ? ' (previous integrity and health unverified; manual check required)' : '')+
            ': '+restoreError.message+'; original: '+error.message);
        }
        if (rollback) throw Error('Rollback failed; previous link restored and restart attempted, but previous integrity and health are unverified; manual check required: '+error.message);
        throw Error('Release failed; previous release restored: '+error.message);
      }
      return plan;
    } finally { await lock.close(); await fs.unlink(layout.state+'.lock'); }
  }
  return {run,validate};
}
module.exports = {createOperations,defaults};
if (require.main === module) {
  const args = process.argv.slice(2), options = {};
  try {
    while (args.length) {
      const argument = args.shift();
      if (argument === '--release') options.sha = args.shift();
      else if (argument === '--health-port') options.healthPort = Number(args.shift());
      else if (argument === '--rollback') options.rollback = true;
      else if (argument === '--apply') options.apply = true;
      else throw Error('Usage: node tools/ops_release.cjs (--release SHA --health-port PORT | --rollback) [--apply]');
    }
    createOperations().run(options).then(plan => console.log(JSON.stringify(plan,null,2)))
      .catch(error => { console.error(error.message); process.exitCode=1; });
  } catch (error) { console.error(error.message); process.exitCode=1; }
}
