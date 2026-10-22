'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const {WebSocketServer, WebSocket} = require('ws');
const PROTOCOL = 11;
const MapModel = require('./dist/editor/model.js');
// Log transport peers, never untrusted forwarding headers or message bodies.
function connectionLog(ws, req, service) {
  const connection = crypto.randomUUID(), ip = req.socket.remoteAddress;
  const started = Date.now();
  const log = (event, details = {}) => console.log(JSON.stringify({
    time:new Date().toISOString(), service, event, connection, ip, ...details
  }));
  ws.log = log;
  log('connect');
  ws.on('close', code => log('disconnect', {
    code, reason:ws.logCloseReason || (code === 1000 ? 'normal_close' : 'peer_or_network_close'),
    durationMs:Date.now()-started
  }));
  ws.on('error', () => { ws.logCloseReason = 'socket_error'; });
}
function playableMap(text) {
  const map = MapModel.parse(text), errors = MapModel.validate(map);
  if(errors.length)throw Error(errors.join('；'));
  return JSON.stringify(map);
}

function createServer({root = path.join(__dirname,'dist'), idleTimeoutMs = 15000, readyTimeoutMs = 15000} = {}) {
  root = path.resolve(root);
  const createCore = require(path.join(root,'por2.js'));
  const catalogs = new WeakMap();
  const validLevel = (core, msg) => {
    if (!catalogs.has(core)) {
      const text = core.UTF8ToString(core._web_catalog_json());
      if (!text) throw Error(core.UTF8ToString(core._web_error()));
      catalogs.set(core, JSON.parse(text));
    }
    return [msg.chapter,msg.section,msg.level].every(Number.isInteger) && catalogs.get(core).maps.some(m => m.chapter === msg.chapter && m.section === msg.section && m.id === msg.level);
  };
  const coreText = (core,method,text,...args) => {
    const bytes=Buffer.from(text), ptr=core._malloc(bytes.length+1);
    if(!ptr)throw Error('Core allocation failed');
    try {core.HEAPU8.set(bytes,ptr);core.HEAPU8[ptr+bytes.length]=0;return core[method](ptr,...args);}
    finally {core._free(ptr);}
  };
  const rooms = new Map();
  const representation = require('./http-compression.cjs')();
  const server = http.createServer(async (req,res) => {
    try {
      if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
      if(new URL(req.url,'http://localhost').pathname === '/api/maps') {
        const directory=path.join(root,'levels'), maps=[];
        if(fs.existsSync(directory))for(const file of fs.readdirSync(directory).sort()) {
          if(maps.length>=20)break;
          if(!file.toLowerCase().endsWith('.json'))continue;
          try {
            const filename=path.join(directory,file), real=fs.realpathSync(filename);
            if(!real.startsWith(fs.realpathSync(directory)+path.sep)||fs.statSync(real).size>1048576)continue;
            const json=playableMap(fs.readFileSync(real,'utf8'));maps.push({name:JSON.parse(json).name,json});
          }catch(_){} // Incomplete drafts are not playable entries.
        }
        res.setHeader('Content-Type','application/json;charset=utf-8');res.setHeader('Cache-Control','no-store');
        return res.end(req.method==='HEAD'?undefined:JSON.stringify({maps}));
      }
      let file = path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
      if (file !== root && !file.startsWith(root+path.sep)) { res.writeHead(403); return res.end(); }
      if (fs.statSync(file).isDirectory()) file = path.join(file,'index.html');
      const real = fs.realpathSync(file);
      if (!real.startsWith(fs.realpathSync(root)+path.sep)) { res.writeHead(403); return res.end(); }
      const type = {'.svg':'image/svg+xml', '.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.wasm':'application/wasm','.json':'application/json','.flac':'audio/flac','.opus':'audio/ogg'};
      res.setHeader('Content-Type',type[path.extname(file)] || 'text/plain;charset=utf-8');
      res.setHeader('Cache-Control','no-store');
      res.setHeader('X-Content-Type-Options','nosniff');
      const data = fs.readFileSync(file);
      const response = await representation(data, path.extname(file), req.headers['accept-encoding']);
      if (response.vary) res.setHeader('Vary','Accept-Encoding');
      if (response.encoding) res.setHeader('Content-Encoding',response.encoding);
      res.setHeader('Content-Length',response.data.length);
      res.statusCode = response.status || 200;
      res.end(req.method === 'HEAD' ? undefined : response.data);
    } catch (_) {
      res.writeHead(404, {'Content-Type':'text/plain;charset=utf-8'});
      res.end(req.method === 'HEAD' ? undefined : '请求的页面或资源不存在。请检查访问地址。\nThe requested page or resource was not found. Please check the URL.');
    }
  });
  const closeEditor = require('./editor-server.cjs')(server, connectionLog);
  const wss = new WebSocketServer({noServer:true,maxPayload:1052672,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head) => {
    if(req.url === '/editor-coop') return;
    let validOrigin = true;
    try { if (req.headers.origin) validOrigin = new URL(req.headers.origin).host === req.headers.host; }
    catch (_) { validOrigin = false; }
    if (req.url !== '/coop' || !validOrigin || wss.clients.size >= 64) return socket.destroy();
    wss.handleUpgrade(req,socket,head,ws => wss.emit('connection',ws,req));
  });
  const send = (ws,msg) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 262144) { ws.logCloseReason = 'slow_receiver'; return ws.terminate(); }
    ws.send(JSON.stringify(msg));
  };
  const broadcast = (room,msg) => room.members.forEach(ws => send(ws,msg));
  const validPoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x < 1000 && p.y >= 0 && p.y < 600;
  const crowns = room => room.owners.map(id => { const ws=room.members[id]; return !!(ws?.crownUnlocked && ws.crownVisible); });
  const count = room => room.map ? JSON.parse(room.map).playerCount : catalogs.get(room.core).maps.find(m=>m.chapter===room.chapter&&m.section===room.section&&m.id===room.level).players;
  const startMessage = (room, snapshot = null, sequence = 0) => ({type:'start',level:room.level,chapter:room.chapter,section:room.section,map:room.map,epoch:room.epoch,sequence,snapshot,crowns:crowns(room),owners:room.owners,playerCount:count(room)});
  const status = room => room.members.forEach(ws => send(ws,{type:'status',player:ws.player,speed:room.speed,members:room.members.length,locked:room.locked,roster:room.members.map(peer=>({id:peer.memberId,player:peer.player,ready:peer.ready,host:peer.player===0})),owners:room.owners,crowns:crowns(room),waiting:false,paused:room.members.map(peer => !peer.ready && (!peer.catchingUp || peer === ws))}));
  const resetInput = ws => { ws.flags = 0; ws.clearJump = true; ws.shots = []; ws.cursor = null; ws.spectate = false; };
  const catchUp = (room,ws) => {
    if (!ws.catchingUp || !ws.snapshotReady || ws.ack !== ws.sentThrough) return;
    if (ws.ack === room.sequence) {
      ws.catchingUp = false; ws.messages = 0; ws.ready = true; status(room);
    } else {
      const end = Math.min(ws.ack+100,room.sequence);
      for (let i=ws.ack;i<end;i++) send(ws,room.history[i-room.historyStart]);
      ws.sentThrough = end;
    }
  };
  const endRoom = (ws,reason) => {
    const room = ws.room;
    if (!room) return;
    ws.log('room_leave', {room:room.code, reason});
    const oldMembers = [...room.members];
    room.members = room.members.filter(peer => peer !== ws);
    ws.room = null; ws.idleSince = performance.now(); resetInput(ws); send(ws,{type:'ended',reason});
    if (!room.members.length) { rooms.delete(room.code); return; }
    room.owners = room.owners.map(id => room.members.indexOf(oldMembers[id]));
    room.members.forEach((peer,i) => { peer.player=i; resetInput(peer); });
    status(room);
  };
  const start = room => {
    const ok=room.map ? coreText(room.core,'_web_load_map',room.map,0) :
      room.core._web_load_catalog(room.chapter,room.section,room.level,0,0);
    if(!ok)throw Error(room.core.UTF8ToString(room.core._web_error()));
    room.sequence = 0; room.epoch++; room.history = []; room.historyBytes = 0; room.historyStart = 0;
    const previousOwners = room.owners;
    room.owners = Array.from({length:count(room)},(_,i)=>previousOwners[i] ?? (!previousOwners.length && i===0 ? 0 : -1));
    room.restart = false; room.checkpoint = false; room.clock = 0; room.lastTime = performance.now();
    for (const ws of room.members) { resetInput(ws); ws.ack = 0; ws.ready = false; ws.catchingUp = false; ws.readySince = performance.now(); }
    broadcast(room,startMessage(room));
    status(room);
    scheduleRooms();
  };
  wss.on('connection',(ws,req) => {
    connectionLog(ws,req,'game');
    ws.memberId = crypto.randomUUID(); ws.idleSince = performance.now(); ws.bytes = 0; ws.joinAttempts = 0;
    ws.room = null; ws.alive = true; ws.messages = 0; ws.window = Date.now();
    ws.ready = false; ws.ack = 0; ws.lastChat = -Infinity; resetInput(ws);
    ws.on('pong',() => { ws.alive = true; });
    ws.on('error',() => {});
    ws.on('close',() => endRoom(ws,'队友已断开连接，请重新创建或加入房间。'));
    ws.on('message',async (data,binary) => {
      try {
        if(ws.readyState !== WebSocket.OPEN) return;
        if (Date.now()-ws.window >= 1000) { ws.window = Date.now(); ws.messages = 0; ws.bytes = 0; }
        ws.bytes += data.length;
        if(ws.bytes > 4*1024*1024) { ws.logCloseReason = 'byte_rate_limit'; return ws.close(1008,'Traffic limit'); }
        if (++ws.messages > (ws.catchingUp ? 20000 : 200) || binary) { ws.logCloseReason = 'invalid_traffic'; return ws.close(1008,'Invalid traffic'); }
        const msg = JSON.parse(data.toString());
        if (!msg || typeof msg !== 'object') return;
        const error = text => send(ws,{type:'error',message:text});
        if(!['create','map'].includes(msg.type) && data.length > 4096) { ws.logCloseReason = 'oversized_control'; return ws.close(1008,'Control message too large'); }
        if (msg.type === 'create' || msg.type === 'join') {
          if (ws.room || ws.joinPending) return error('请先离开当前房间或等待加载。');
          if(++ws.joinAttempts > 10) { ws.logCloseReason = 'join_attempt_limit'; return ws.close(1008,'Too many attempts'); }
          if (msg.protocol !== PROTOCOL) return error('版本不一致，请重启联机服务并刷新双方网页。');
          let room;
          if (msg.type === 'create') {
            if (rooms.size >= 16) return error('房间已满，请稍后重试。');
            let custom = null;
            if(msg.map !== undefined) { try {custom=playableMap(msg.map);} catch(e){return error(e.message);} }
            else if (!Number.isInteger(msg.level) || msg.level < 0) return error('无效关卡。');
            if(msg.code !== undefined && typeof msg.code !== 'string') return error('房间编号须为 1–16 位字母、数字、横线或下划线。');
            let code = (msg.code || '').trim().toUpperCase();
            if(code && !/^[A-Z0-9_-]{1,16}$/.test(code)) return error('房间编号须为 1–16 位字母、数字、横线或下划线。');
            if(code && rooms.has(code)) return error('房间编号已被使用。');
            ws.joinPending = true;
            const core = await createCore();
            ws.joinPending = false;
            if (!custom && !validLevel(core,msg)) return error('无效关卡。');
            if(ws.readyState !== WebSocket.OPEN)return;
            if(rooms.size >= 16)return error('房间已满，请稍后重试。');
            if(code && rooms.has(code))return error('房间编号已被使用。');
            if(!code) do { code = crypto.randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
            room = {core,code,locked:false,level:custom ? -1 : msg.level,map:custom,chapter:custom ? 0 : msg.chapter,section:custom ? 0 : msg.section,owners:[],history:[],members:[],epoch:0,sequence:0,speed:1,clock:0}; rooms.set(code,room);
          } else {
            room = typeof msg.code === 'string' && rooms.get(msg.code.toUpperCase());
            if (!room || room.members.length >= 8) return error('房间不存在或已满（最多 8 人）。');
            if(room.locked) return error('房主已锁定房间，暂不接受加入。');
          }
          ws.crownUnlocked = msg.crownUnlocked === true; ws.crownVisible = msg.crownVisible === true;
          ws.room = room; ws.player = room.members.length; room.members.push(ws);
          ws.log(msg.type === 'create' ? 'room_create' : 'room_join', {room:room.code, player:ws.player});
          send(ws,{type:'joined',code:room.code,player:ws.player});
          if (room.members.length === 1) start(room);
          else {
            const vacant=room.owners.indexOf(-1);
            if(vacant>=0)room.owners[vacant]=ws.player;
            // Capture a complete state at this exact frame. The event loop cannot
            // advance the room between snapshot creation and registering the peer.
            const snapshot=room.core.UTF8ToString(room.core._web_snapshot());
            ws.ack = room.sequence;
            ws.catchingUp = true; ws.snapshotReady = false; ws.sentThrough = ws.ack;
            ws.catchupProgress = performance.now();
            send(ws,startMessage(room,snapshot,ws.ack));
            status(room);
          }
          return;
        }
        const room = ws.room;
        if (!room) return;
        if(msg.type === 'kick' || msg.type === 'lock') {
          if(ws !== room.members[0]) return error('只有房主可以管理玩家。');
          if(msg.epoch !== room.epoch) return error('房间已更新，请重试。');
          if(msg.type === 'lock') {
            if(typeof msg.locked !== 'boolean') return error('无效的房间设置。');
            room.locked = msg.locked; status(room); return;
          }
          const target = room.members.find(peer=>peer.memberId === msg.memberId);
          if(!target || target === ws) return error('该玩家已离开，或不能踢出自己。');
          room.locked = true;
          ws.log('room_kick',{room:room.code,target:target.memberId});
          endRoom(target,'你已被房主移出房间。');
          target.logCloseReason = 'kicked'; target.close(1008,'Removed by host'); return;
        }
        if (msg.type === 'crown' && typeof msg.visible === 'boolean') {
          ws.crownVisible = msg.visible;
          broadcast(room,{type:'crowns',crowns: crowns(room)}); return;
        }
        if (msg.type === 'chat') {
          if (typeof msg.text !== 'string' || msg.text.length > 200 || !msg.text.trim()) return error('消息须为 1–200 个字符。');
          const now = performance.now();
          if (now - ws.lastChat < 500) return error('发送太快，请稍后再试。');
          ws.lastChat = now;
          broadcast(room,{type:'chat',player:ws.player,text:msg.text.trim()});
          return;
        }
        if (msg.type === 'leave') return endRoom(ws,'联机已结束，已返回单人模式。');
        if (msg.type === 'level' && ws.player === 0 && validLevel(room.core,msg)) {
          room.level = msg.level; room.map = null; room.chapter = msg.chapter; room.section = msg.section;
          start(room);
          return;
        }
        if (msg.epoch !== room.epoch) return;
        if(msg.type === 'map' && ws.player === 0) {
          try {room.map=playableMap(msg.map);} catch(e){return error(e.message);}
          room.level=-1;room.chapter=0;room.section=0;start(room);return;
        }
        if (msg.type === 'speed') {
          if (![0.1,0.5,0.8,1,1.25].includes(msg.speed)) return error('无效速率。');
          room.speed = msg.speed; room.clock = 0; room.lastTime = performance.now();
          scheduleRooms();
          broadcast(room,{type:'speed',speed:room.speed}); return;
        }
        if (msg.type === 'ready') {
          const wasBlocked = room.members.some(peer => !peer.ready && !peer.catchingUp);
          if (ws.catchingUp) { ws.snapshotReady = true; catchUp(room,ws); }
          else ws.ready = true;
          if (wasBlocked) { room.clock = 0; room.lastTime = performance.now(); }
          scheduleRooms();
          status(room); return;
        }
        if (msg.type === 'clear') { resetInput(ws); return; }
        if (msg.type === 'ack' && (!ws.catchingUp || ws.snapshotReady) && Number.isInteger(msg.sequence) && msg.sequence >= ws.ack && msg.sequence <= (ws.catchingUp ? ws.sentThrough : room.sequence)) {
          if (msg.sequence > ws.ack) ws.catchupProgress = performance.now();
          ws.ack = msg.sequence;
          catchUp(room,ws);
          return;
        }
        if (msg.type === 'switch' && ws.ready) {
          const role=room.owners.indexOf(ws.player);
          if(role<0)return;
          for(let offset=1;offset<room.owners.length;offset++) {
            const next=(role+offset)%room.owners.length;
            if(room.owners[next]>=0)continue;
            resetInput(ws); room.owners[role]=-1; room.owners[next]=ws.player;
            status(room); break;
          }
          return;
        }
        if (msg.type === 'seat') {
          if(!['operate','watch'].includes(msg.seat))return;
          const role=room.owners.indexOf(ws.player);
          if(msg.seat === 'watch') {
            resetInput(ws);
            if(role>=0)room.owners[role]=-1;
          } else {
            if(!ws.ready)return;
            const vacant=msg.role ?? room.owners.indexOf(-1);
            if(!Number.isInteger(vacant) || vacant<0 || vacant>=room.owners.length || (room.owners[vacant]>=0 && room.owners[vacant]!==ws.player))return error('该操作席不可用，请选择空闲角色。');
            resetInput(ws);
            if(role>=0)room.owners[role]=-1;
            room.owners[vacant]=ws.player;
          }
          status(room); return;
        }
        if (msg.type === 'emote' && ws.ready) {
          if(!['up','right','down','left','yes','no','question','exclamation'].includes(msg.emote) || !validPoint(msg))return;
          const now=performance.now();
          if(now-(ws.lastEmote ?? -Infinity)<500)return;
          ws.lastEmote=now;
          broadcast(room,{type:'emote',player:ws.player,emote:msg.emote,x:msg.x,y:msg.y});return;
        }
        if (msg.type === 'input') {
          if (!ws.ready) return;
          if (!Number.isInteger(msg.flags) || msg.flags < 0 || msg.flags > 415 || (msg.flags & ~415)) return;
          ws.cursor = validPoint(msg.cursor) ? {x:msg.cursor.x,y:msg.cursor.y} : null;
          if(!room.owners.includes(ws.player))return;
          if (msg.flags & 256) ws.clearJump = true;
          ws.flags = msg.flags & 151; // Restart is an edge, never a held input.
          if (Array.isArray(msg.shots)) for (const shot of msg.shots.slice(0,16))
            if (validPoint(shot) && (shot.portal === 0 || shot.portal === 1) && ws.shots.length < 16)
              ws.shots.push({portal:shot.portal,x:shot.x,y:shot.y});
        }
        if (msg.type === 'restart' && ws.ready && room.owners.includes(ws.player)) room.restart = true;
        if (msg.type === 'checkpoint' && ws.ready && room.owners.includes(ws.player)) room.checkpoint = true;
      } catch (_) { ws.logCloseReason = 'invalid_message'; ws.close(1008,'Invalid message'); }
    });
  });
  const frameMilliseconds = 25, maxCatchupFrames = 6;
  let timer, closing = false;
  function scheduleRooms() {
    clearTimeout(timer);
    if (closing) return;
    const now = performance.now();
    // Keep readiness/catch-up timeout checks alive even when no room can run.
    let delay = Math.min(100,readyTimeoutMs);
    for (const room of rooms.values()) {
      if (!room.members.length || room.members.some(ws => !ws.ready && !ws.catchingUp)) continue;
      const deadline = (room.lastTime ?? now) + (frameMilliseconds-room.clock)/room.speed;
      delay = Math.min(delay,deadline-now);
    }
    // Round up: an early callback must not busy-loop before the deadline.
    timer = setTimeout(tickRooms,Math.max(1,Math.ceil(delay)));
  }
  function tickRooms() {
    for (const room of rooms.values()) {
      const now = performance.now();
      const elapsed = Math.max(0,now-(room.lastTime ?? now));
      room.lastTime = now;
      for (const peer of [...room.members]) if (peer.catchingUp && now-peer.catchupProgress > 10000)
        endRoom(peer,'同步长时间未响应，请重新加入。');
      for (const peer of [...room.members]) if (!peer.ready && !peer.catchingUp && now-peer.readySince > readyTimeoutMs)
        endRoom(peer,'加载长时间未就绪，请重新加入。');
      if (!room.members.length || room.members.some(ws => !ws.ready && !ws.catchingUp)) { room.clock=0; continue; }
      // Background menus never pause the room. A suspended/disconnected browser must rejoin.
      if (room.members.some(ws => !ws.catchingUp && room.sequence-ws.ack > 250)) {
        for(const peer of [...room.members]) if(!peer.catchingUp && room.sequence-peer.ack>250) endRoom(peer,'连接长时间未响应，请重新加入。');
        continue;
      }
      // Timer callbacks can be late (especially on Windows); count elapsed time, not callbacks.
      room.clock += elapsed*room.speed;
      // Drop excess whole frames after a stall, retaining the fractional phase.
      if (room.clock >= frameMilliseconds*(maxCatchupFrames+1))
        room.clock = frameMilliseconds*maxCatchupFrames + room.clock%frameMilliseconds;
      while (room.clock >= frameMilliseconds) {
      room.clock -= frameMilliseconds;
      const players = room.owners.map(id => {
        const ws=room.members[id];
        if(!ws?.ready)return {flags:256 | (room.restart ? 8 : 0) | (room.checkpoint ? 64 : 0),shots:[],cursor:null};
        const input = {flags:ws.flags | (ws.clearJump ? 256 : 0) | (room.restart ? 8 : 0) | (room.checkpoint ? 64 : 0) | (ws.spectate ? 32 : 0),shots:ws.shots,cursor:ws.cursor};
        ws.shots = []; ws.spectate = false; ws.clearJump = false; return input;
      });
      room.restart = false; room.checkpoint = false;
      const frame={type:'frame',epoch:room.epoch,sequence:++room.sequence,players};
      for(let id=0;id<players.length;id++)for(const shot of players[id].shots) {
        if(players.length===2)room.core._web_coop_shot(id,shot.portal,shot.x,shot.y);
        else room.core._web_shot(shot.portal,shot.x,shot.y);
      }
      if(players.length===2)room.core._web_coop_tick(players[0].flags,players[1].flags);
      else room.core._web_tick(players[0].flags);
      // Retain only frames still needed by clients loading a snapshot or catching up.
      // R remains an ordinary ordered input; it does not invalidate their baseline.
      const joining=room.members.filter(peer=>peer.catchingUp);
      const oldest=joining.length ? Math.min(...joining.map(peer=>peer.ack)) : room.sequence;
      const discard=Math.min(room.history.length,oldest-room.historyStart);
      for(let i=0;i<discard;i++)room.historyBytes-=JSON.stringify(room.history[i]).length;
      room.history.splice(0,discard); room.historyStart=oldest;
      if(joining.length) {
        room.history.push(frame); room.historyBytes += JSON.stringify(frame).length;
        if(room.historyBytes > 16*1024*1024) {
          for(const peer of joining)endRoom(peer,'同步缓存已满，请重新加入。');
          room.history=[]; room.historyBytes=0; room.historyStart=room.sequence;
        }
      }
      // Catching-up members receive only their ordered history window, never live frames.
      for (const peer of room.members) if (!peer.catchingUp) send(peer,frame);
      broadcast(room,{type:'cursors',cursors:room.members.map(ws=>({player:ws.player,cursor:ws.cursor}))});
      }
    }
    scheduleRooms();
  }
  scheduleRooms();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.logCloseReason = 'heartbeat_timeout'; ws.terminate(); continue; }
      ws.alive = false; ws.ping();
    }
  },5000);
  const idleTimer = setInterval(() => {
    for(const ws of wss.clients) if(!ws.room && performance.now()-ws.idleSince > idleTimeoutMs) {
      ws.logCloseReason = 'idle_timeout'; ws.terminate();
    }
  },Math.min(1000,idleTimeoutMs));
  async function close() {
    closing = true; clearTimeout(timer);
    await closeEditor();
    clearInterval(heartbeat); clearInterval(idleTimer);
    for (const ws of wss.clients) { ws.logCloseReason = 'server_shutdown'; ws.terminate(); }
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
  return {server,close};
}
function connectionHints(host, port, interfaces = os.networkInterfaces()) {
  const url = address => `http://${address.includes(':') ? `[${address}]` : address}:${port}`;
  const lines = [`Por2D 服务已启动，监听 ${host}:${port}`];
  if (host !== '0.0.0.0' && host !== '::') {
    lines.push(`访问地址：${url(host)}`);
    if (host === '127.0.0.1' || host === '::1' || host === 'localhost')
      lines.push('当前仅供本机访问。局域网联机请加 --host 0.0.0.0');
    return lines;
  }
  lines.push(`本机访问：${url('127.0.0.1')}`, '队友访问以下本机网卡地址（请选择双方实际连接的网络）：');
  let count = 0;
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const entry of addresses || []) {
      if (entry.internal || !['IPv4',4].includes(entry.family) || entry.address.startsWith('169.254.')) continue;
      const kind = /VMware|VMnet|VirtualBox|vEthernet|WSL|Docker/i.test(name) ? '虚拟机网络，普通 Wi-Fi 队友勿选'
        : /Radmin|VPN|Tailscale|ZeroTier|WireGuard|TAP|TUN/i.test(name) ? 'VPN，仅同一 VPN 的队友使用'
        : '局域网候选，同一 Wi-Fi／网线请核对网卡';
      lines.push(`  ${name}：${url(entry.address)}  [${kind}]`); count++;
    }
  }
  if (!count) lines.push('未发现可用的非回环 IPv4 地址，请检查 Wi-Fi／网线连接。');
  lines.push('请复制完整 http:// 地址及端口。不要使用默认网关、0.0.0.0 或队友自己的 127.0.0.1。',
    '这些是本机接口地址，不代表公网可达；同一 Wi-Fi 仍无法访问时检查设备隔离和防火墙。',
    '保持此窗口运行，按 Ctrl+C 停止。');
  return lines;
}
module.exports = {createServer, connectionHints};
if (require.main === module) {
  const value = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i+1]; };
  const host = value('--host') || '127.0.0.1', port = Number(value('--port') || 8000);
  const app = createServer();
  app.server.listen(port,host,() => console.log(connectionHints(host,app.server.address().port).join('\n')));
  app.server.on('error',err => {
    console.error(err.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。请使用已启动的服务，或改用 --port ${port+1}。` : err.message);
    process.exitCode=1; app.close();
  });
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,() => app.close());
}
