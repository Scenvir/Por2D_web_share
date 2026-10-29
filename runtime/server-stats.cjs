#!/usr/bin/env node
'use strict';
// Read-only summary of private, chronological JSON server logs. Never prints IPs.
const fs = require('node:fs');
const readline = require('node:readline');

function dayFormatter(timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
  return time => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(time)).map(p=>[p.type,p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
}
function dayBounds(date, timeZone = 'Asia/Shanghai', now = Date.now()) {
  const day = dayFormatter(timeZone);
  if (date === 'today') date = day(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date)
    throw Error('日期必须为 today 或有效的 YYYY-MM-DD。');
  const center = Date.parse(`${date}T00:00:00Z`);
  const boundary = target => {
    let low = center-36*3600000, high = center+60*3600000;
    while (low<high) { const middle=Math.floor((low+high)/2); if(day(middle)<target)low=middle+1;else high=middle; }
    return low;
  };
  const next = new Date(center+86400000).toISOString().slice(0,10);
  return {date,timeZone,start:boundary(date),end:boundary(next)};
}
function parseLine(line) {
  if (line.length>1048576) return null;
  try {
    let value=JSON.parse(line);
    if (typeof value.MESSAGE==='string') value=JSON.parse(value.MESSAGE);
    if (!value || typeof value!=='object' || !Number.isFinite(Date.parse(value.time)) || typeof value.event!=='string') return null;
    return value;
  } catch (_) { return null; }
}
function createSummary(options = {}) {
  const now=options.now ?? Date.now(), bounds=dayBounds(options.date || 'today',options.timeZone || 'Asia/Shanghai',now);
  const ips=new Set(),pageIps=new Set(),gameIps=new Set(),connections=new Map(),rooms=new Map();
  const result={date:bounds.date,timeZone:bounds.timeZone,observedIPs:0,pageIPs:0,pageViews:0,pageErrors:0,gameIPs:0,
    gameConnectionsStarted:0,roomSessionsStarted:0,closedGameConnections:0,closedRoomSessions:0,
    closedGameConnectionSeconds:0,closedRoomSeconds:0,unclosedGameConnections:0,unclosedRoomSessions:0,
    syncRetries:0,syncTimeouts:0,seatFailures:0,abnormalDisconnects:0,ignoredLines:0,excludedTestEvents:0,
    syncCompleted:0,syncDurationMsTotal:0,syncDurationMsMax:0,syncUnder1s:0,sync1to5s:0,sync5to15s:0,sync15sPlus:0};
  const inDay=time=>time>=bounds.start&&time<bounds.end;
  const overlap=(start,end)=>Math.max(0,Math.min(end,bounds.end,now)-Math.max(start,bounds.start));
  const ipOf=event=>typeof event.ip==='string'?event.ip.replace(/^::ffff:/,''):null;
  const addGameIP=ip=>{if(ip){ips.add(ip);gameIps.add(ip);}};
  function finishRoom(key,event,time) {
    const previous=rooms.get(key);
    const start=Number.isFinite(event.durationMs)&&event.durationMs>=0?time-event.durationMs:previous?.time;
    if (Number.isFinite(start) && time>=start) {
      const ms=overlap(start,time);
      if(ms>0)addGameIP(ipOf(event)||previous?.ip);
      if(ms>0 || inDay(time)) { result.closedRoomSessions++;result.closedRoomSeconds+=ms/1000; }
    }
    rooms.delete(key);
  }
  return {
    add(event) {
      if(!event) {result.ignoredLines++;return;}
      const time=Date.parse(event.time), inside=inDay(time), ip=ipOf(event);
      if(!Number.isFinite(time)) {result.ignoredLines++;return;}
      // Trusted server process option only; never derived from client headers or messages.
      if(event.trafficKind==='test') {if(inside)result.excludedTestEvents++;return;}
      if(inside && ip)ips.add(ip);
      if(event.service==='http' && event.event==='request' && event.kind==='page' && inside) {
        if(event.status>=200&&event.status<400) {result.pageViews++;if(ip)pageIps.add(ip);}
        else if(event.status>=400)result.pageErrors++;
      }
      if(event.service!=='game')return;
      if(inside&&ip)gameIps.add(ip);
      const key=typeof event.connection==='string'?event.connection:null;
      if(event.event==='connect'&&key) {
        connections.set(key,{time,ip});if(inside)result.gameConnectionsStarted++;
      }
      if((event.event==='room_create'||event.event==='room_join')&&key) {
        rooms.set(key,{time,session:event.session,ip});if(inside)result.roomSessionsStarted++;
      }
      if(event.event==='room_leave'&&key)finishRoom(key,event,time);
      if(event.event==='disconnect'&&key) {
        const previous=connections.get(key);
        const start=Number.isFinite(event.durationMs)&&event.durationMs>=0?time-event.durationMs:previous?.time;
        if(Number.isFinite(start)&&time>=start) {
          const ms=overlap(start,time);
          if(ms>0)addGameIP(ip||previous?.ip);
          if(ms>0||inside) {result.closedGameConnections++;result.closedGameConnectionSeconds+=ms/1000;}
        }
        // A missing room_leave can be bounded by the socket close, but cannot use socket duration as room duration.
        if(rooms.has(key))finishRoom(key,{},time);
        connections.delete(key);
        if(inside && event.reason!=='normal_close')result.abnormalDisconnects++;
      }
      if(inside) {
        if(event.event==='sync_complete' && Number.isFinite(event.durationMs) && event.durationMs>=0) {
          const ms=event.durationMs;
          result.syncCompleted++;result.syncDurationMsTotal+=ms;result.syncDurationMsMax=Math.max(result.syncDurationMsMax,ms);
          result[ms<1000?'syncUnder1s':ms<5000?'sync1to5s':ms<15000?'sync5to15s':'sync15sPlus']++;
        }
        if(event.event==='sync_retry')result.syncRetries++;
        if(event.event==='sync_timeout')result.syncTimeouts++;
        if(event.event==='seat_result'&&event.ok===false)result.seatFailures++;
      }
    },
    finish() {
      // A session can cover this entire day without emitting an event within it.
      // Unclosed records remain observations, not proof the peer is still online.
      for(const session of [...connections.values(),...rooms.values()])
        if(overlap(session.time,now)>0)addGameIP(session.ip);
      result.observedIPs=ips.size;result.pageIPs=pageIps.size;result.gameIPs=gameIps.size;
      result.unclosedGameConnections=[...connections.values()].filter(s=>s.time<Math.min(now,bounds.end)).length;
      result.unclosedRoomSessions=[...rooms.values()].filter(s=>s.time<Math.min(now,bounds.end)).length;
      result.closedGameConnectionSeconds=Math.round(result.closedGameConnectionSeconds);
      result.closedRoomSeconds=Math.round(result.closedRoomSeconds);
      return {...result};
    }
  };
}
function formatSummary(s) {
  const duration=n=>`${Math.floor(n/3600)}小时${Math.floor(n%3600/60)}分${n%60}秒`;
  return [
    `Por2D 访问统计：${s.date}（${s.timeZone}）`,
    `观察到的独立 IP：${s.observedIPs}；网页 IP：${s.pageIPs}；游戏连接 IP：${s.gameIPs}`,
    `成功网页加载：${s.pageViews} 次；页面错误：${s.pageErrors} 次（静态资源请求未记录，不计为访问）`,
    `新建游戏连接：${s.gameConnectionsStarted}；进入房间：${s.roomSessionsStarted} 次`,
    `已关闭游戏连接：${s.closedGameConnections}，当日重叠时长合计 ${duration(s.closedGameConnectionSeconds)}`,
    `已结束房间会话：${s.closedRoomSessions}，当日重叠时长合计 ${duration(s.closedRoomSeconds)}`,
    `日志中尚无结束记录：游戏连接 ${s.unclosedGameConnections}，房间会话 ${s.unclosedRoomSessions}（不纳入时长）`,
    `同步重试 ${s.syncRetries}；同步超时 ${s.syncTimeouts}；切席失败 ${s.seatFailures}；非正常断连 ${s.abnormalDisconnects}`,
    `同步完成 ${s.syncCompleted}；耗时分布 <1秒 ${s.syncUnder1s}，1–5秒 ${s.sync1to5s}，5–15秒 ${s.sync5to15s}，≥15秒 ${s.sync15sPlus}（仅完成同步）`,
    `排除的服务端标记测试事件：${s.excludedTestEvents}`,
    '口径：IP 不等于人数；刷新会增加网页次数。连接/房间时长包含观战、菜单和空闲，不等于有效游玩时长。',
    '仅统计提供且保留的日志；历史版本无页面日志，不能补算访问量。缺失结束记录可能是仍在线，也可能是重启或日志不完整。'
  ].join('\n');
}
async function main(args=process.argv.slice(2)) {
  const options={};let file, json=false;
  for(let i=0;i<args.length;i++) {
    const arg=args[i];
    if(arg==='--date'||arg==='--timezone'||arg==='--file') {
      const value=args[++i];if(!value||value.startsWith('--'))throw Error(`${arg} 缺少值。`);
      if(arg==='--file')file=value;else options[arg==='--date'?'date':'timeZone']=value;
    } else if(arg==='--json')json=true;
    else if(arg==='--help'||arg==='-h') {console.log('Usage: node server_stats.cjs [--date today|YYYY-MM-DD] [--timezone Asia/Shanghai] [--file log.jsonl] [--json]\nRead chronological JSON lines from a file or stdin (journalctl -o cat or -o json).');return;}
    else throw Error(`未知参数：${arg}`);
  }
  if(!file&&process.stdin.isTTY)throw Error('请使用 --file 日志文件，或通过管道输入 journalctl 日志。');
  const summary=createSummary(options);
  const input=file?fs.createReadStream(file,{encoding:'utf8'}):process.stdin;
  for await(const line of readline.createInterface({input,crlfDelay:Infinity})) if(line.trim())summary.add(parseLine(line));
  const result=summary.finish();console.log(json?JSON.stringify(result,null,2):formatSummary(result));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={dayBounds,parseLine,createSummary,formatSummary};
