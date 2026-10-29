#!/usr/bin/env node
'use strict';
// Local aggregate storage only. No addresses, identifiers, raw lines or arbitrary fields.
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const {createSummary,parseLine,dayBounds}=require(fs.existsSync(path.join(__dirname,'server_stats.cjs'))?'./server_stats.cjs':'../server-stats.cjs');
const numericKeys=Object.keys(createSummary().finish()).filter(k=>!['date','timeZone'].includes(k));
function validateSummary(s) {
  if(!s||typeof s!=='object'||Array.isArray(s))throw Error('Invalid aggregate');
  if(Object.keys(s).sort().join()!==['date','timeZone',...numericKeys].sort().join())throw Error('Unexpected aggregate fields');
  dayBounds(s.date,s.timeZone);
  for(const key of numericKeys)if(!Number.isFinite(s[key])||s[key]<0)throw Error('Invalid aggregate number');
  return s;
}
function safeDirectory(dir) {
  const resolved=path.resolve(dir);
  for(let p=resolved;;p=path.dirname(p)) {
    if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('Symlink directory rejected');
    if(path.dirname(p)===p)break;
  }
  return resolved;
}
function persist(dir,summary) {
  validateSummary(summary);dir=safeDirectory(dir);fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const target=path.join(dir,summary.date+'.json');
  // Deliberately immutable: reruns cannot silently replace a complete daily aggregate with partial logs.
  fs.writeFileSync(target,JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600});return target;
}
function retentionPlan(dir,keepDays,now=Date.now()) {
  if(!Number.isInteger(keepDays)||keepDays<1||keepDays>36500)throw Error('Invalid retention days');
  dir=safeDirectory(dir);const cutoff=new Date(now-keepDays*86400000).toISOString().slice(0,10);
  return fs.readdirSync(dir).filter(n=>/^\d{4}-\d{2}-\d{2}\.json$/.test(n)&&n.slice(0,10)<cutoff).sort().map(n=>{
    const file=path.join(dir,n);if(!fs.lstatSync(file).isFile())throw Error('Unsafe aggregate file');
    const s=validateSummary(JSON.parse(fs.readFileSync(file,'utf8')));if(n!==s.date+'.json')throw Error('Aggregate date mismatch');return file;
  });
}
async function main(args) {
  const [command,dir,dateOrDays,zone='Asia/Shanghai',extra]=args;
  if(command==='write'&&dir&&dateOrDays&&!extra) {
    // Explicit past day only: do not persist an incomplete current day.
    const bounds=dayBounds(dateOrDays,zone);if(bounds.end>Date.now())throw Error('Only completed days may be persisted');
    const summary=createSummary({date:dateOrDays,timeZone:zone});
    for await(const line of readline.createInterface({input:process.stdin,crlfDelay:Infinity}))if(line.trim())summary.add(parseLine(line));
    console.log(persist(dir,summary.finish()));
  } else if(command==='prune'&&dir&&dateOrDays&&!extra&&(zone==='Asia/Shanghai'||zone==='--apply')) {
    const files=retentionPlan(dir,Number(dateOrDays));
    if(zone==='--apply')for(const file of files)fs.unlinkSync(file);
    console.log(JSON.stringify({applied:zone==='--apply',files},null,2));
  } else throw Error('Usage: ops_daily.cjs write DIRECTORY YYYY-MM-DD [TIMEZONE] < chronological.jsonl | prune DIRECTORY KEEP_DAYS [--apply]');
}
if(require.main===module)main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={validateSummary,safeDirectory,persist,retentionPlan};
