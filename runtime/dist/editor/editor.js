'use strict';
const M = MapModel, $ = id => document.getElementById(id);
const canvas = $('map'), ctx = canvas.getContext('2d');
let map = M.blank(), tool = '1', zoom = 1, dirty = false, history = [], future = [], stroke = null;
let selection = {tiles:[], bodies:[]};
let editorSocket=null, editorPlayer=-1, pendingEdit=false, remoteCursor=null, cursorTime=0;
function editorSend(msg){if(editorSocket?.readyState===WebSocket.OPEN)editorSocket.send(JSON.stringify(msg));}
function roomControls(){
  const connected=!!editorSocket;
  for(const id of ['editor-create','editor-join','editor-code','new','open'])$(id).disabled=connected;
  for(const id of ['name','commentary','playerCount','direction'])$(id).disabled=pendingEdit;
  $('editor-leave').hidden=!connected;
}
function disconnectEditor(){
  const ws=editorSocket;editorSocket=null;editorPlayer=-1;pendingEdit=false;remoteCursor=null;
  if(ws)ws.close();roomControls();draw();
}
function connectEditor(join){
  if(editorSocket)return;
  finish();
  if(join&&dirty&&!confirm('加入房间会载入房主地图，请先导出当前草稿。继续加入？'))return;
  const url=new URL('/editor-coop',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';
  const ws=editorSocket=new WebSocket(url);pendingEdit=true;roomControls();
  $('editor-room').textContent='正在连接…';
  const timeout=setTimeout(()=>{if(editorSocket===ws&&editorPlayer<0){disconnectEditor();$('editor-room').textContent='连接超时，请使用 Node 联机服务。';}},8000);
  ws.onopen=()=>editorSend(join?{type:'join',code:$('editor-code').value.trim()}:{type:'create',map});
  ws.onmessage=e=>{
    if(editorSocket!==ws)return;
    try{
      const msg=JSON.parse(e.data);
      if(msg.type==='joined'){clearTimeout(timeout);editorPlayer=msg.player;$('editor-room').textContent=`编辑房间 ${msg.code} · P${editorPlayer+1}`;}
      if(msg.type==='members')status(msg.count===2?'队友已加入：改动和鼠标实时同步。联机编辑暂不支持撤销；导出与加入可玩列表由各自操作。':'等待队友加入编辑房间。');
      if(msg.type==='state'){
        if(pendingEdit&&msg.author!==undefined&&msg.author!==editorPlayer)return;
        const next=M.parse(JSON.stringify(msg.map));
        if(stroke){stroke=null;status('收到队友修改，未完成的拖动已取消，请重试。');}
        map=next;pendingEdit=false;history=[];future=[];markChanged();controls();roomControls();draw();
        if(msg.error)status(msg.error);
      }
      if(msg.type==='cursor'){remoteCursor=msg.point?{...msg.point,player:msg.player}:null;draw();}
      if(msg.type==='error'){status(msg.message);disconnectEditor();}
      if(msg.type==='ended'){disconnectEditor();$('editor-room').textContent='队友已离开。地图保留在本页，请导出保存。';}
    }catch(err){status('同步失败：'+err.message);disconnectEditor();}
  };
  ws.onclose=()=>{clearTimeout(timeout);if(editorSocket===ws){disconnectEditor();$('editor-room').textContent='连接已断开，当前地图保留。请使用 node server.cjs 启动协作服务。';}};
  ws.onerror=()=>{status('无法连接编辑服务，请确认双方使用同一 Node 服务地址。');};
}
$('editor-create').onclick=()=>connectEditor(false);$('editor-join').onclick=()=>connectEditor(true);
$('editor-leave').onclick=()=>{finish();disconnectEditor();$('editor-room').textContent='已离开，当前地图保留。';};
const clearSelection = () => { selection={tiles:[],bodies:[]}; };
const brushTile = () => tool === 'half-portal' ? 3+Number($('half-direction').value) : tool === 'half-solid' ? 7+Number($('half-direction').value) : Number(tool);
function selectedAt(c) {
  return selection.tiles.some(t=>t.x===c.x&&t.y===c.y)||selection.bodies.some(key=>{
    const r=M.bounds(map[key]);
    return c.x*20<r.x+r.w&&(c.x+1)*20>r.x&&c.y*20<r.y+r.h&&(c.y+1)*20>r.y;
  });
}
const snapshot = () => JSON.stringify(map);
function status(text) { $('status').textContent = text; }
function markChanged() { dirty = true; document.title = '* Por2D 地图编辑器'; $('validation').textContent = ''; }
function record(before) {
  if (before === snapshot()) return;
  if(editorSocket){
    const changes=M.diff(M.parse(before),map);
    pendingEdit=true;roomControls();editorSend({type:'patch',changes});markChanged();draw();return;
  }
  history.push(before); if(history.length > 100) history.shift(); future=[]; markChanged(); draw();
}
function controls() {
  clearSelection(); $('name').value = map.name; $('commentary').value = map.commentary; $('playerCount').value = map.playerCount;
  for(const key of ['spawn2','exit2'])document.querySelector(`[data-tool="${key}"]`).hidden=map.playerCount!==2;
  if(map.playerCount!==2&&['spawn2','exit2'].includes(tool))selectTool('spawn');
  if(map[tool]) $('direction').value = map[tool].direction;
}
function selectTool(value) {
  if(map.playerCount!==2&&['spawn2','exit2'].includes(value))return;
  cancel();clearSelection();
  tool=value; document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active',b.dataset.tool===tool));
  if(map[tool]) $('direction').value=map[tool].direction;
  draw();
}
function draw() {
  const cell=20*zoom, margin=32;
  canvas.width = margin + M.W*cell+1; canvas.height = margin+M.H*cell+1;
  ctx.fillStyle='#121923'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.font='10px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
  for(let x=0;x<M.W;x++){ctx.fillStyle='#a8bfdc';ctx.fillText(x,margin+(x+.5)*cell,16);}
  for(let y=0;y<M.H;y++){
    ctx.fillStyle='#a8bfdc';ctx.fillText(y,14,margin+(y+.5)*cell);
    for(let x=0;x<M.W;x++){
      ctx.fillStyle='#18212e';
      ctx.fillRect(margin+x*cell,margin+y*cell,cell,cell);
      const t=map.tiles[y][x];
      if(t){const r=M.tileBounds(t,x,y);ctx.fillStyle=t===11?'#701c24':M.portalSurface(t)?'#e5ebf2':'#596579';ctx.fillRect(margin+r.x*zoom,margin+r.y*zoom,r.w*zoom,r.h*zoom);}
    }
  }
  ctx.lineWidth=1;
  for(let x=0;x<=M.W;x++){ctx.strokeStyle=x%5?'#344154':'#62718a';ctx.beginPath();ctx.moveTo(margin+x*cell+.5,margin);ctx.lineTo(margin+x*cell+.5,canvas.height);ctx.stroke();}
  for(let y=0;y<=M.H;y++){ctx.strokeStyle=y%5?'#344154':'#62718a';ctx.beginPath();ctx.moveTo(margin,margin+y*cell+.5);ctx.lineTo(canvas.width,margin+y*cell+.5);ctx.stroke();}
  for(const key of M.bodyKeys(map)) {
    const b=map[key];if(!b)continue;
    const r=M.bounds(b), x=margin+r.x*zoom,y=margin+r.y*zoom,w=r.w*zoom,h=r.h*zoom;
    const color=key.endsWith('2')?'#e8a5eb':'#77dbac';
    ctx.fillStyle=color+'66';ctx.fillRect(x,y,w,h);
    ctx.strokeStyle=color;ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);
    if(key.startsWith('exit')) {
      ctx.save();ctx.translate(x+w/2,y+h/2);ctx.rotate(b.direction*Math.PI/2);ctx.scale(zoom,zoom);
      ctx.strokeStyle='#e6fff7';ctx.fillStyle='#e6fff7';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(-7,-24);ctx.lineTo(7,-24);ctx.stroke();
      ctx.beginPath();ctx.moveTo(0,17);ctx.lineTo(0,-9);ctx.stroke();
      ctx.beginPath();ctx.moveTo(0,-19);ctx.lineTo(-6,-7);ctx.lineTo(6,-7);ctx.closePath();ctx.fill();ctx.restore();
    } else {ctx.fillStyle='#fff';ctx.font=`bold ${14*zoom}px sans-serif`;ctx.fillText(['↑','→','↓','←'][b.direction],x+w/2,y+h/2);}
    ctx.fillStyle=color;ctx.font='11px sans-serif';ctx.fillText((key.endsWith('2')?'P2 ':'P1 ')+(key.startsWith('spawn')?'出生':'出口 · 头朝'+['上','右','下','左'][b.direction]),x+w/2,key.endsWith('2')?y+h+9:y-7);
  }
  ctx.strokeStyle='#5cc8ff';ctx.fillStyle='#5cc8ff55';ctx.lineWidth=2;
  for(const c of selection.tiles){ctx.fillRect(margin+c.x*cell,margin+c.y*cell,cell,cell);ctx.strokeRect(margin+c.x*cell+2,margin+c.y*cell+2,cell-4,cell-4);}
  for(const key of selection.bodies){const r=M.bounds(map[key]);ctx.strokeRect(margin+r.x*zoom,margin+r.y*zoom,r.w*zoom,r.h*zoom);}
  if(stroke && (stroke.rectangle||stroke.selecting) && stroke.last) {
    const a=stroke.start,b=stroke.last;
    const x=margin+Math.min(a.x,b.x)*cell,y=margin+Math.min(a.y,b.y)*cell;
    const w=(Math.abs(a.x-b.x)+1)*cell,h=(Math.abs(a.y-b.y)+1)*cell;
    ctx.fillStyle=stroke.erase?'#ff997755':'#7be4cd55';ctx.fillRect(x,y,w,h);
    ctx.strokeStyle='#7be4cd';ctx.setLineDash([5,3]);ctx.strokeRect(x,y,w,h);ctx.setLineDash([]);
  }
  if(remoteCursor){
    const x=margin+(remoteCursor.x+.5)*cell,y=margin+(remoteCursor.y+.5)*cell;
    ctx.strokeStyle=remoteCursor.player===0?'#77dbac':'#e8a5eb';ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(x-9,y);ctx.lineTo(x+9,y);ctx.moveTo(x,y-9);ctx.lineTo(x,y+9);ctx.stroke();
    ctx.font='bold 12px sans-serif';ctx.fillText(`P${remoteCursor.player+1}`,x+14,y-12);
  }
  $('undo').disabled=!!editorSocket||!history.length; $('redo').disabled=!!editorSocket||!future.length;
}
function cellAt(e) {
  const r=canvas.getBoundingClientRect();
  const x=Math.floor(((e.clientX-r.left)*canvas.width/r.width-32)/(20*zoom));
  const y=Math.floor(((e.clientY-r.top)*canvas.height/r.height-32)/(20*zoom));
  return x>=0&&x<M.W&&y>=0&&y<M.H?{x,y}:null;
}
function paint(c,erase) {
  if(erase){
    let removed=false;
    for(const key of (M.bodyKeys(map).includes(tool)?[tool]:M.bodyKeys(map))){const b=map[key];if(b){const r=M.bounds(b);if(c.x*20<r.x+r.w&&(c.x+1)*20>r.x&&c.y*20<r.y+r.h&&(c.y+1)*20>r.y){map[key]=null;removed=true;}}}
    if(!removed)map.tiles[c.y][c.x]=0;
  }else if(M.bodyKeys(map).includes(tool))map[tool]={...c,direction:Number($('direction').value)};
  else map.tiles[c.y][c.x]=stroke?.tile??brushTile();
}
function move(e) {
  const c=cellAt(e);
  if(editorSocket&&performance.now()-cursorTime>50){editorSend({type:'cursor',point:c});cursorTime=performance.now();}
  $('coords').textContent=c?`格坐标 (${c.x}, ${c.y}) · 左上像素 (${c.x*20}, ${c.y*20})`:'鼠标位于网格外';
  if(!stroke)return;
  if(!c){if(stroke.moving)stroke.valid=false;return;}
  if(stroke.selecting){stroke.last=c;selection=M.selectRectangle(map,stroke.start,c);draw();return;}
  if(stroke.moving){
    const result=M.moveSelection(M.parse(stroke.before),stroke.selection,c.x-stroke.start.x,c.y-stroke.start.y);
    stroke.valid=!!result;
    if(result){map=result.map;selection=result.selection;}
    status(result?'松开鼠标完成整体移动；Esc 取消。':'无法放置：超出地图边界或覆盖其他方块。松开将取消本次移动。');
    draw();return;
  }
  if(stroke.rectangle){stroke.last=c;draw();return;}
  const a=stroke.last||c, steps=Math.max(Math.abs(c.x-a.x),Math.abs(c.y-a.y),1);
  for(let i=1;i<=steps;i++)paint({x:Math.round(a.x+(c.x-a.x)*i/steps),y:Math.round(a.y+(c.y-a.y)*i/steps)},stroke.erase);
  stroke.last=c;draw();
}
function finish(){if(stroke){const before=stroke.before;
  if(stroke.moving&&!stroke.valid){cancel();return;}
  if(stroke.selecting)status(`已选中 ${selection.tiles.length} 个方块、${selection.bodies.length} 个标记。拖动选中元素移动；在其他位置拖动重新框选。`);
  if(stroke.rectangle && stroke.last) M.fillRectangle(map,stroke.start,stroke.last,stroke.erase?0:stroke.tile);
  stroke=null;record(before);draw();}}
function cancel(){if(stroke){map=M.parse(stroke.before);if(stroke.selection)selection=stroke.selection;stroke=null;draw();}}
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{
  if(pendingEdit)return;
  const c=cellAt(e);if(stroke||e.button!==0&&e.button!==2||!c)return;e.preventDefault();
  if(tool==='select'){
    if(e.button!==0)return;
    stroke={before:snapshot(),start:c,last:c,selection, moving:selectedAt(c),valid:true};
    stroke.selecting=!stroke.moving;
  }else stroke={before:snapshot(),erase:e.button===2,last:null,start:c,tool,tile:brushTile(),rectangle:$('shape').value==='rectangle'&&M.validTile(brushTile())};
  canvas.setPointerCapture(e.pointerId);move(e);
});
canvas.addEventListener('pointermove',move);
canvas.addEventListener('pointerleave',()=>editorSend({type:'cursor',point:null}));
window.addEventListener('blur',()=>{cancel();editorSend({type:'cursor',point:null});});
document.addEventListener('visibilitychange',()=>{if(document.hidden){cancel();editorSend({type:'cursor',point:null});}});
canvas.addEventListener('pointerup',e=>{move(e);finish();});canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('lostpointercapture',cancel);
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>selectTool(b.dataset.tool));
$('direction').onchange=()=>{if(map[tool]){const before=snapshot();map[tool].direction=Number($('direction').value);record(before);}};
for(const key of ['name','commentary'])$(key).oninput=()=>{const before=snapshot();map[key]=$(key).value;record(before);};
$('playerCount').onchange=()=>{const before=snapshot();map.playerCount=Number($('playerCount').value);
  if(map.playerCount===2){if(!map.spawn2)map.spawn2=M.partnerSpawn(map);if(!map.exit2&&map.exit)map.exit2={...map.exit};}
  controls();record(before);};
$('zoom').onchange=()=>{zoom=Number($('zoom').value);draw();};
function travel(from,to){if(editorSocket)return;finish();if(!from.length)return;to.push(snapshot());map=M.parse(from.pop());clearSelection();markChanged();controls();draw();}
$('undo').onclick=()=>travel(history,future);$('redo').onclick=()=>travel(future,history);
async function saveExport(text,extension){
  const name=(map.name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_')||'map')+extension;
  // Static browser edition: export a portable file without a native host service.
  const blob=new Blob([text],{type:extension==='.json'?'application/json;charset=utf-8':'text/plain;charset=utf-8'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  return true;
}
let saving=false;
async function exportMap(cpp){
  if(saving)return;
  finish();const saved=snapshot();saving=true;$('save').disabled=$('export').disabled=true;
  try{
    if(!await saveExport(cpp?M.cpp(map):M.json(map),cpp?'.cpp':'.json'))return;
    if(!cpp&&snapshot()===saved){dirty=false;document.title='Por2D 地图编辑器';}
    status(cpp?'已发起 C++ 下载；JSON 地图仍需单独保存。':'已发起 JSON 下载，请确认文件已保存。返回游戏，在“地图与回放”中导入 JSON 即可游玩。');
  }catch(e){status(e.name==='AbortError'?'已取消保存，当前修改仍未保存。':'保存失败：'+e.message);}
  finally{saving=false;$('save').disabled=$('export').disabled=false;}
}
$('save').onclick=()=>exportMap(false);
$('export').onclick=()=>exportMap(true);
$('add-playable').onclick=()=>{
  finish();
  if(pendingEdit)return status('请等当前编辑同步完成后再加入列表。');
  try{
    const errors=M.validate(map);if(errors.length)throw Error(errors.join('；'));
    const key='por2-web-v1', prefs=JSON.parse(localStorage.getItem(key)||'{}');
    if(!prefs||typeof prefs!=='object'||Array.isArray(prefs))throw Error('浏览器设置损坏，请先备份现有地图。');
    const json=snapshot(), existing=Array.isArray(prefs.maps)?prefs.maps:[];
    prefs.maps=[{name:map.name,json},...existing.filter(m=>m&&m.json!==json)].slice(0,20);
    localStorage.setItem(key,JSON.stringify(prefs));
    status('已加入本浏览器可玩列表。返回游戏 → 地图与回放，可选单人、单机双角色或创建联机房间。建议另导出 JSON 备份。');
  }catch(e){status('未加入列表：'+e.message);}
};
$('validate').onclick=()=>{const errors=M.validate(map);$('validation').textContent=errors.join('；');status(errors.length?'请检查以下问题（仍可保存 JSON 草稿）。':'检查通过：出生点和出口有效且未与墙重叠。尚未验证关卡可解性。');};
$('new').onclick=()=>{if(dirty&&!confirm('当前地图尚未保存，确定新建？'))return;map=M.blank();history=[];future=[];dirty=false;document.title='Por2D 地图编辑器';controls();draw();$('validation').textContent='';status('已新建空白地图。');};
$('open').onclick=()=>{if(dirty&&!confirm('当前地图尚未保存，确定打开其他地图？'))return;$('file').click();};
$('file').onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  try{if(file.size>1024*1024)throw Error('地图文件不能超过 1 MB');const next=M.parse(await file.text());map=next;history=[];future=[];dirty=false;document.title='Por2D 地图编辑器';controls();draw();$('validation').textContent='';status('已打开 '+file.name);}
  catch(err){status('打开失败：'+err.message);}finally{e.target.value='';}
};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&stroke){e.preventDefault();cancel();return;}
  if(e.key==='Escape'){clearSelection();draw();return;}
  if(e.ctrlKey||e.metaKey){if(e.key.toLowerCase()==='s'){e.preventDefault();$('save').click();return;}}
  if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))return;
  if(e.ctrlKey||e.metaKey){const k=e.key.toLowerCase();if(k==='z'||k==='y'){e.preventDefault();(k==='y'||e.shiftKey?$('redo'):$('undo')).click();}}
  else if(/^[1-9]$/.test(e.key))selectTool(['0','1','2','spawn','exit','spawn2','exit2','half-portal','half-solid'][Number(e.key)-1]);
  else if(e.key.toLowerCase()==='v')selectTool('select');
});
controls();draw();
