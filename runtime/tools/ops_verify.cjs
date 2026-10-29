#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {safeDirectory}=require('./ops_daily.cjs');
function verifyManifest(root,manifest) {
  root=safeDirectory(root);
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||!Object.keys(manifest).length)throw Error('Empty/invalid manifest');
  for(const [name,digest] of Object.entries(manifest)) {
    if(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest)||name.includes('\\')||name.includes(':')||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Unsafe manifest entry');
    const file=path.join(root,name);safeDirectory(path.dirname(file));
    if(!fs.lstatSync(file).isFile())throw Error('Non-regular manifest file');
    if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==digest)throw Error('Manifest checksum mismatch: '+name);
  }
  return Object.keys(manifest).length;
}
function validateHealth(body,version,protocol=11) {
  if(!body||body.status!=='ok'||body.version!==version||body.protocol!==protocol)throw Error('Health/version/protocol mismatch');return true;
}
async function health(url,version) {
  const parsed=new URL(url);
  if(parsed.username||parsed.password||parsed.hash||parsed.search||parsed.pathname!=='/healthz'||!(parsed.protocol==='https:'||(parsed.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))))throw Error('Use HTTPS or loopback HTTP /healthz without credentials/query');
  const response=await fetch(parsed,{redirect:'error',signal:AbortSignal.timeout(5000)});
  if(response.status!==200)throw Error('Health HTTP status mismatch');
  const reader=response.body.getReader();let data=Buffer.alloc(0);
  try {while(true){const {done,value}=await reader.read();if(done)break;data=Buffer.concat([data,Buffer.from(value)]);if(data.length>4096)throw Error('Oversized health response');}}
  finally {await reader.cancel();}
  validateHealth(JSON.parse(data.toString('utf8')),version);return true;
}
async function main(args) {
  const [command,a,b,...extra]=args;if(extra.length||!a||!b)throw Error('Usage: ops_verify.cjs manifest ROOT SHA256.json | health URL EXPECTED_VERSION');
  if(command==='manifest')console.log(`Verified ${verifyManifest(a,JSON.parse(fs.readFileSync(b,'utf8')))} manifest entries`);
  else if(command==='health'){await health(a,b);console.log('Health/version/protocol verified');}
  else throw Error('Unknown command');
}
if(require.main===module)main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={verifyManifest,validateHealth,health};
