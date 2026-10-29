#!/usr/bin/env node
'use strict';
// An explicit data-only allowlist, not an archive of the runtime or server directory.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {validateSummary,safeDirectory}=require('./ops_daily.cjs');
const model=require(fs.existsSync(path.join(__dirname,'../web/editor/model.js'))?'../web/editor/model.js':'../dist/editor/model.js');
const MAX=32*1024*1024;
const configKeys=['port','idleTimeoutMs','readyTimeoutMs','catchupTimeoutMs','maxCatchupLagFrames','ackTimeoutMs'];
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function read(file,max=1048576) {
  safeDirectory(path.dirname(file));const s=fs.lstatSync(file);
  if(!s.isFile()||s.size>max)throw Error('Unsafe or oversized input');return fs.readFileSync(file,'utf8');
}
function config(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!configKeys.includes(k)))throw Error('Config must contain only approved numeric settings');
  for(const [k,v]of Object.entries(value))if(!Number.isSafeInteger(v)||v<1||v>(k==='port'?65535:3600000))throw Error('Invalid config value');return value;
}
function sanitizeMap(value) {
  const m=model.parse(JSON.stringify(value));m.name='Restored map';m.commentary='';
  for(const k of ['spawn','exit','spawn2','exit2'])if(m[k])m[k]=Object.fromEntries(['x','y','direction','offsetX','offsetY'].filter(p=>m[k][p]!==undefined).map(p=>[p,m[k][p]]));
  return m;
}
function normalize(name,value) {
  if(/^custommaps\/map-\d{6}\.json$/.test(name))return sanitizeMap(value);
  if(name==='ops-config.json')return config(value);
  if(/^aggregates\/\d{4}-\d{2}-\d{2}\.json$/.test(name)) {
    validateSummary(value);if(name!==`aggregates/${value.date}.json`)throw Error('Aggregate date mismatch');return value;
  }
  throw Error('File outside backup allowlist');
}
function prepare(source) {
  source=safeDirectory(source);const entries=[];let total=0;
  const add=(name,value)=>{
    const data=JSON.stringify(normalize(name,value));total+=Buffer.byteLength(data);
    if(total>MAX||entries.length>=10000)throw Error('Backup input exceeds limits');
    entries.push({name,data,sha256:hash(data)});
  };
  const mapdir=path.join(source,'custommaps');
  if(fs.existsSync(mapdir)) {
    safeDirectory(mapdir);let i=0;
    for(const name of fs.readdirSync(mapdir).sort()) {
      if(!/^[A-Za-z0-9_-]+\.json$/.test(name))throw Error('Unexpected custom map filename; curate source first');
      add(`custommaps/map-${String(++i).padStart(6,'0')}.json`,JSON.parse(read(path.join(mapdir,name))));
    }
  }
  const cfg=path.join(source,'ops-config.json');if(fs.existsSync(cfg))add('ops-config.json',JSON.parse(read(cfg)));
  const aggregateDir=path.join(source,'aggregates');
  if(fs.existsSync(aggregateDir)) {
    safeDirectory(aggregateDir);
    for(const name of fs.readdirSync(aggregateDir).sort())add('aggregates/'+name,JSON.parse(read(path.join(aggregateDir,name))));
  }
  if(!entries.length)throw Error('No allowlisted data found');
  const bundle={format:'por2d-local-backup',version:1,entries};
  if(Buffer.byteLength(JSON.stringify(bundle))>MAX)throw Error('Bundle exceeds 32 MiB');return bundle;
}
function validate(bundle) {
  if(!bundle||Object.keys(bundle).sort().join()!=='entries,format,version'||bundle.format!=='por2d-local-backup'||bundle.version!==1||!Array.isArray(bundle.entries)||!bundle.entries.length||bundle.entries.length>10000)throw Error('Invalid bundle');
  const seen=new Set();
  for(const entry of bundle.entries) {
    if(!entry||Object.keys(entry).sort().join()!=='data,name,sha256'||typeof entry.name!=='string'||typeof entry.data!=='string'||Buffer.byteLength(entry.data)>1048576||seen.has(entry.name)||hash(entry.data)!==entry.sha256)throw Error('Invalid or corrupt entry');
    seen.add(entry.name);
    if(JSON.stringify(normalize(entry.name,JSON.parse(entry.data)))!==entry.data)throw Error('Noncanonical or unsanitized entry');
  }
  return bundle;
}
function restore(bundle,destination) {
  validate(bundle);destination=safeDirectory(destination);
  // Never overwrite live files. A validated restore is still only a candidate for manual promotion.
  fs.mkdirSync(destination,{mode:0o700});
  for(const entry of bundle.entries) {
    const target=path.join(destination,entry.name);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    fs.writeFileSync(target,entry.data+'\n',{flag:'wx',mode:0o600});
  }
  return destination;
}
function main(args) {
  const [command,input,output,...extra]=args;if(extra.length||!input)throw Error('Invalid arguments');
  if(command==='prepare'&&output) {
    const bundle=validate(prepare(input));safeDirectory(path.dirname(output));
    fs.writeFileSync(output,JSON.stringify(bundle)+'\n',{flag:'wx',mode:0o600});console.log('Prepared local sanitized bundle; no transfer performed');
  } else if(command==='validate'&&!output) {validate(JSON.parse(read(input,MAX)));console.log('Backup checksum/schema validation passed');}
  else if(command==='restore'&&output)console.log(restore(JSON.parse(read(input,MAX)),output));
  else throw Error('Usage: ops_backup.cjs prepare CURATED_SOURCE NEW_BUNDLE | validate BUNDLE | restore BUNDLE NEW_STAGING_DIRECTORY');
}
if(require.main===module)try{main(process.argv.slice(2));}catch(e){console.error(e.message);process.exitCode=1;}
module.exports={prepare,validate,restore,sanitizeMap};
