'use strict';
const {WebSocketServer,WebSocket}=require('ws');
const crypto=require('node:crypto');
const M=require('./dist/editor/model.js');

module.exports=function attachEditor(server, connectionLog = ws => { ws.log = () => {}; }){
  const rooms=new Map(), wss=new WebSocketServer({noServer:true,maxPayload:1048576,perMessageDeflate:false});
  const send=(ws,msg)=>{if(ws.readyState===WebSocket.OPEN){if(ws.bufferedAmount>2097152){ws.logCloseReason='slow_receiver';return ws.terminate();}ws.send(JSON.stringify(msg));}};
  const broadcast=(room,msg)=>room.members.forEach(ws=>send(ws,msg));
  const snapshot=(ws,error='')=>send(ws,{type:'state',map:ws.room.map,revision:ws.room.revision,error});
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/editor-coop')return;
    try {if(req.headers.origin && new URL(req.headers.origin).host!==req.headers.host) return socket.destroy();}
    catch(_){return socket.destroy();}
    if(wss.clients.size>=32)return socket.destroy();
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  });
  wss.on('connection',(ws,req)=>{
    connectionLog(ws,req,'editor');
    ws.alive=true; ws.count=0; ws.since=Date.now();
    ws.on('error',()=>{});ws.on('pong',()=>{ws.alive=true;});
    ws.on('close',()=>{
      if(!ws.room)return;
      const room=ws.room;rooms.delete(room.code);
      for(const peer of room.members){peer.log('room_leave',{room:room.code,reason:'editor_room_closed'});peer.room=null;if(peer!==ws){peer.logCloseReason='editor_room_closed';send(peer,{type:'ended'});peer.close();}}
    });
    ws.on('message',(data,binary)=>{
      try{
        if(Date.now()-ws.since>=1000){ws.since=Date.now();ws.count=0;}
        if(binary||++ws.count>100){ws.logCloseReason='invalid_traffic';return ws.close(1008,'Invalid traffic');}
        const msg=JSON.parse(data.toString());
        if(!msg || typeof msg!=='object')return;
        if(msg.type==='create'||msg.type==='join'){
          if(ws.room)throw Error('已经在房间中');
          let room;
          if(msg.type==='create'){
            if(rooms.size>=16)throw Error('编辑房间已满');
            const map=M.parse(JSON.stringify(msg.map));
            let code;do{code=crypto.randomBytes(3).toString('hex').toUpperCase();}while(rooms.has(code));
            room={code,map,revision:0,members:[]};rooms.set(code,room);
          }else{
            room=typeof msg.code==='string'&&rooms.get(msg.code.toUpperCase());
            if(!room||room.members.length!==1)throw Error('编辑房间不存在或已满');
          }
          ws.room=room;ws.player=room.members.length;room.members.push(ws);
          ws.log(msg.type==='create'?'room_create':'room_join',{room:room.code,player:ws.player});
          send(ws,{type:'joined',code:room.code,player:ws.player});snapshot(ws);
          broadcast(room,{type:'members',count:room.members.length});return;
        }
        if(!ws.room)return;
        if(msg.type==='patch'){
          ws.room.map=M.applyChanges(ws.room.map,msg.changes);ws.room.revision++;
          broadcast(ws.room,{type:'state',map:ws.room.map,revision:ws.room.revision,author:ws.player});
        }else if(msg.type==='cursor'){
          const p=msg.point;
          if(p!==null && (!p||!Number.isInteger(p.x)||!Number.isInteger(p.y)||p.x<0||p.x>=50||p.y<0||p.y>=30))return;
          ws.room.members.filter(peer=>peer!==ws).forEach(peer=>send(peer,{type:'cursor',player:ws.player,point:p}));
        }
      }catch(error){if(ws.room)snapshot(ws,error.message);else send(ws,{type:'error',message:error.message});}
    });
  });
  const timer=setInterval(()=>{for(const ws of wss.clients){if(!ws.alive){ws.logCloseReason='heartbeat_timeout';ws.terminate();continue;}ws.alive=false;ws.ping();}},5000);
  return async()=>{clearInterval(timer);for(const ws of wss.clients){ws.logCloseReason='server_shutdown';ws.terminate();}await new Promise(resolve=>wss.close(resolve));};
};
