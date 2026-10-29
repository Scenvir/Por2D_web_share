'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {monitorEventLoopDelay} = require('node:perf_hooks');

// This state is process-private: never expose it through the HTTP health route.
function createOperations({log, snapshot, intervalMs = 60000}) {
  const histogram = monitorEventLoopDelay({resolution:20}); histogram.enable();
  const counters = {syncCompleted:0,syncFailures:0,syncRetries:0};
  const record = event => {
    if(event === 'sync_complete')counters.syncCompleted++;
    if(event === 'sync_timeout')counters.syncFailures++;
    if(event === 'sync_retry')counters.syncRetries++;
  };
  const sample = () => {
    const ms = value => Number.isFinite(value) ? Math.round(value / 1e6 * 100) / 100 : 0;
    log({time:new Date().toISOString(),service:'operations',event:'performance',
      eventLoopP50Ms:ms(histogram.percentile(50)),eventLoopP95Ms:ms(histogram.percentile(95)),
      eventLoopMaxMs:ms(histogram.max),...snapshot(),...counters});
    histogram.reset();
  };
  const timer = setInterval(sample, intervalMs); timer.unref();
  return {record,sample,close(){clearInterval(timer);histogram.disable();}};
}

function createInitializationGate({concurrency=2,globalLimit=12,peerLimit=6,windowMs=60000,now=Date.now}={}) {
  let active = 0;
  const attempts = [];
  return {
    get active(){return active;},
    acquire(peer) {
      const time=now();
      while(attempts.length && attempts[0].time<=time-windowMs)attempts.shift();
      if(active>=concurrency || attempts.length>=globalLimit || attempts.filter(a=>a.peer===peer).length>=peerLimit)return null;
      attempts.push({peer,time}); active++;
      let released=false;
      return () => {if(!released){released=true;active--;}};
    }
  };
}

function createMapCatalog(directory,parse,{refreshMs=0,now=Date.now}={}) {
  let checked=-Infinity, cached='{"maps":[]}', entries=new Map();
  return () => {
    const time=now(); if(time-checked<refreshMs)return cached; checked=time;
    const maps=[], next=new Map();
    try {
      const root=fs.realpathSync(directory);
      for(const file of fs.readdirSync(directory).sort()) {
        if(maps.length>=20)break;
        if(!file.toLowerCase().endsWith('.json'))continue;
        try {
          const filename=path.join(directory,file), real=fs.realpathSync(filename), stat=fs.statSync(real);
          if(!real.startsWith(root+path.sep)||!stat.isFile()||stat.size>1048576)continue;
          const key=[real,stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
          let item=entries.get(key);
          if(!item){const json=parse(fs.readFileSync(real,'utf8')); item={name:JSON.parse(json).name,json};}
          next.set(key,item);maps.push(item);
        }catch(_){} // Drafts and symlinks outside the map directory stay excluded.
      }
    }catch(_){}
    entries=next;cached=JSON.stringify({maps});return cached;
  };
}
module.exports={createOperations,createInitializationGate,createMapCatalog};
