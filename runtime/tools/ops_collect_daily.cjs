#!/usr/bin/env node
'use strict';
// Scoped collector for the Por2D unit. No raw journal is written to disk.
const {spawn}=require('node:child_process');
const readline=require('node:readline');
const fs=require('node:fs');
const {createSummary,parseLine,dayBounds}=require(fs.existsSync(require('node:path').join(__dirname,'server_stats.cjs'))?'./server_stats.cjs':'../server-stats.cjs');
const {persist}=require('./ops_daily.cjs');
function argumentsFor(namespace=false){return [...(namespace?['--namespace=+por2d']:[]),'-u','por2d.service','-o','cat','--no-pager'];}
async function collect({date,namespace=false,directory,run=spawn}) {
  const bounds=dayBounds(date);if(bounds.end>Date.now())throw Error('Only completed days may be collected');
  const summary=createSummary({date,timeZone:'Asia/Shanghai'});
  const child=run('/usr/bin/journalctl',argumentsFor(namespace),{stdio:['ignore','pipe','pipe']});
  let stderr='',observed=0;
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(0,4096);});
  const completion=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('Scoped journal read failed')));});
  // Observe failure immediately so a missing executable cannot yield an unhandled rejection.
  completion.catch(()=>{});
  for await(const line of readline.createInterface({input:child.stdout,crlfDelay:Infinity})) {
    const event=parseLine(line);if(event)observed++;summary.add(event);
  }
  await completion;
  if(stderr.trim()||!observed)throw Error('Journal coverage unavailable or warned; inspect service log access before persisting');
  const result=summary.finish();
  if(directory)persist(directory,result);
  return result;
}
if(require.main===module){
  const args=process.argv.slice(2),date=args.shift(),namespace=args.includes('--namespace');
  const pos=args.indexOf('--write'),directory=pos>=0?args[pos+1]:undefined;
  if(!date||args.some((a,i)=>!['--namespace','--write'].includes(a)&&i!==pos+1)||pos>=0&&!directory){console.error('Usage: ops_collect_daily.cjs YYYY-MM-DD [--namespace] [--write PRIVATE_DIRECTORY]');process.exitCode=1;}
  else collect({date,namespace,directory}).then(summary=>console.log(JSON.stringify(summary,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={collect,argumentsFor};
