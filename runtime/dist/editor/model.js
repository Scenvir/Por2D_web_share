/* Shared by the offline editor and its Node.js tests. Coordinates are row-major. */
(function (root) {
  'use strict';
  const W = 50, H = 30, TILE = 20;
  const tileNames = ['Empty','PortalSurface','Solid','PortalHalfUp','PortalHalfRight','PortalHalfDown','PortalHalfLeft','SolidHalfUp','SolidHalfRight','SolidHalfDown','SolidHalfLeft','GravitySwitch'];
  const validTile = t => Number.isInteger(t) && t >= 0 && t < tileNames.length;
  const portalSurface = t => t === 1 || t >= 3 && t <= 6;
  function tileBounds(t,x,y) {
    const r={x:x*TILE,y:y*TILE,w:TILE,h:TILE};
    if(t>=3&&t<=10)switch((t-3)%4){
      case 0:r.h=10;break;
      case 1:r.x+=10;r.w=10;break;
      case 2:r.y+=10;r.h=10;break;
      case 3:r.w=10;break;
    }
    return r;
  }
  const bodyKeys = m => m.playerCount === 2 ? ['spawn','exit','spawn2','exit2'] : ['spawn','exit'];
  const overlaps = (a,b) => a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
  function clearBody(m,b) {
    const r=bounds(b);
    if(r.x<=0||r.y<=0||r.x+r.w>=W*TILE||r.y+r.h>=H*TILE)return false;
    for(let y=Math.floor(r.y/TILE);y<=Math.floor((r.y+r.h-1)/TILE);y++)
      for(let x=Math.floor(r.x/TILE);x<=Math.floor((r.x+r.w-1)/TILE);x++)if(m.tiles[y][x]&&overlaps(r,tileBounds(m.tiles[y][x],x,y)))return false;
    return true;
  }
  // Match the game's legacy search exactly, including its two-pixel steps.
  function partnerSpawn(m) {
    if(!m.spawn)return null;
    const first=bounds(m.spawn);
    for(let d=2;d<W*TILE;d+=2)for(const [dx,dy] of [[d,0],[-d,0],[0,-d],[0,d]]) {
      const px=first.x-1+dx,py=first.y-1+dy;
      const b={x:Math.floor(px/TILE),y:Math.floor(py/TILE),direction:m.spawn.direction,
        offsetX:((px%TILE)+TILE)%TILE,offsetY:((py%TILE)+TILE)%TILE};
      if(clearBody(m,b)&&!overlaps(first,bounds(b)))return b;
    }
    return null;
  }
  function blank() {
    return {format: 'Por2D-map', version: 1, width: W, height: H, tileSize: TILE,
      name: '我的地图', commentary: '', playerCount: 1, tiles: Array.from({length: H}, () => Array(W).fill(0)), spawn: null, exit: null, spawn2: null, exit2: null};
  }
  function parse(text) {
    if (typeof text !== 'string' || text.length > 1048576) throw Error('地图文件不能超过 1 MB');
    const m = JSON.parse(text.replace(/^\uFEFF/,''));
    if (m && m.playerCount === undefined) m.playerCount = 1;
    if (!m || ![1,2].includes(m.playerCount)) throw Error('地图人数必须为单人或双人。');
    if (!m || m.format !== 'Por2D-map' || m.version !== 1 || m.width !== W || m.height !== H || m.tileSize !== TILE)
      throw Error('不是支持的 Por2D 地图格式（需要版本 1、50×30 网格）。');
    if (typeof m.name !== 'string' || m.name.length > 80 || typeof m.commentary !== 'string' || m.commentary.length > 200)
      throw Error('地图名称或评语格式错误。');
    if (!Array.isArray(m.tiles) || m.tiles.length !== H || m.tiles.some(row => !Array.isArray(row) || row.length !== W || row.some(t => !validTile(t))))
      throw Error('方块数据错误：需要 30 行、每行 50 个 0–11 的整数。');
    if(m.spawn2===undefined)m.spawn2=partnerSpawn(m);
    if(m.exit2===undefined)m.exit2=m.exit&&{...m.exit};
    for (const key of ['spawn', 'exit', 'spawn2', 'exit2']) {
      const b = m[key];
      if (b !== null && (!b || !Number.isInteger(b.x) || !Number.isInteger(b.y) || b.x < 0 || b.x >= W || b.y < 0 || b.y >= H || ![0,1,2,3].includes(b.direction)))
        throw Error('出生点或过关点坐标 / 朝向无效。');
      if(b)for(const offset of ['offsetX','offsetY'])if(b[offset]!==undefined&&(!Number.isInteger(b[offset])||b[offset]<0||b[offset]>=TILE))throw Error('标记像素偏移无效');
    }
    return {format: m.format, version: 1, width: W, height: H, tileSize: TILE,
      name: m.name, commentary: m.commentary, playerCount: m.playerCount, tiles: m.tiles.map(r => r.slice()),
      spawn: m.spawn && {...m.spawn}, exit: m.exit && {...m.exit}, spawn2: m.spawn2 && {...m.spawn2}, exit2: m.exit2 && {...m.exit2}};
  }
  function json(m) {
    // Keep each tile row on one line, matching the checked-in map files.
    return '{\n' + Object.entries(m).map(([key,value]) => {
      const text = key === 'tiles'
        ? '[\n' + value.map(row => '    [' + row.join(', ') + ']').join(',\n') + '\n  ]'
        : JSON.stringify(value,null,2).replace(/\n/g,'\n  ');
      return '  ' + JSON.stringify(key) + ': ' + text;
    }).join(',\n') + '\n}\n';
  }
  function bounds(b) {
    return {x: b.x * TILE + 1 + (b.offsetX??0), y: b.y * TILE + 1 + (b.offsetY??0), w: b.direction % 2 ? 58 : 18, h: b.direction % 2 ? 18 : 58};
  }
  function validate(m) {
    const errors = [];
    for (const key of bodyKeys(m)) {
      const label=(key.endsWith('2')?'P2 ':'P1 ')+(key.startsWith('spawn')?'出生点':'出口');
      const b = m[key];
      if (!b) { errors.push('尚未设置' + label); continue; }
      const r = bounds(b);
      if (r.x <= 0 || r.y <= 0 || r.x + r.w >= W*TILE || r.y + r.h >= H*TILE) errors.push(label + '身体触碰或超出地图边界');
      let overlap = false;
      for (let y = Math.floor(r.y/TILE); y <= Math.floor((r.y+r.h-1)/TILE) && y < H; y++)
        for (let x = Math.floor(r.x/TILE); x <= Math.floor((r.x+r.w-1)/TILE) && x < W; x++) if (m.tiles[y][x]&&overlaps(r,tileBounds(m.tiles[y][x],x,y))) overlap = true;
      if (overlap) errors.push(label + '身体与墙块重叠');
    }
    if(m.playerCount===2&&m.spawn&&m.spawn2&&overlaps(bounds(m.spawn),bounds(m.spawn2)))errors.push('两人的出生点不能重叠');
    return errors;
  }
  function cpp(m) {
    const issues = validate(m);
    if (issues.length) throw Error(issues.join('；'));
    const quote = s => 'u8"' + s.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/[\u0000-\u001f\u007f]/g,c => '\\' + c.charCodeAt(0).toString(8).padStart(3,'0')) + '"';
    const body = b => { const r = bounds(b); return '{{' + r.x + ', ' + r.y + '}, Direction::' + ['Up','Right','Down','Left'][b.direction] + '}'; };
    const lines = ['// Generated by Por2D editor. Add this function to your level selection.', '#include "por2/level.hpp"', '', 'namespace por2 {', 'Level makeCustomLevel() {', '    Level level;', '    level.id = 1000;', '    level.name = ' + quote(m.name) + ';', '    level.commentary = ' + quote(m.commentary) + ';', '    level.spawn = ' + body(m.spawn) + ';', '    level.exit = Body' + body(m.exit) + ';'];
    lines.push(`    level.playerCount = ${m.playerCount ?? 1};`);
    if(m.playerCount===2)for(const key of ['spawn2','exit2'])lines.push(`    level.${key} = Body${body(m[key])};`);
    for (let y=0;y<H;y++) for(let x=0;x<W;x++) {
      const t = m.tiles[y][x]; if (!t) continue;
      const start=x; while(x+1<W && m.tiles[y][x+1]===t) x++;
      lines.push(`    level.map.fill(Tile::${tileNames[t]}, ${start}, ${y}, ${x}, ${y});`);
    }
    return lines.concat('    return level;', '}', '} // namespace por2', '').join('\n');
  }
  function fillRectangle(m,a,b,tile) {
    if(!validTile(tile))throw Error('Invalid tile');
    for(const c of [a,b])if(!Number.isInteger(c.x)||!Number.isInteger(c.y)||c.x<0||c.x>=W||c.y<0||c.y>=H)throw Error('Invalid rectangle');
    for(let y=Math.min(a.y,b.y);y<=Math.max(a.y,b.y);y++)
      for(let x=Math.min(a.x,b.x);x<=Math.max(a.x,b.x);x++)m.tiles[y][x]=tile;
  }
  function selectRectangle(m,a,b) {
    const x=Math.min(a.x,b.x), y=Math.min(a.y,b.y);
    const right=Math.max(a.x,b.x)+1, bottom=Math.max(a.y,b.y)+1;
    const selection={tiles:[], bodies:[]};
    for(let row=y;row<bottom;row++)for(let col=x;col<right;col++)
      if(m.tiles[row][col])selection.tiles.push({x:col,y:row});
    for(const key of bodyKeys(m))if(m[key]){
      const r=bounds(m[key]);
      if(r.x<right*TILE&&r.x+r.w>x*TILE&&r.y<bottom*TILE&&r.y+r.h>y*TILE)selection.bodies.push(key);
    }
    return selection;
  }
  function moveSelection(m,s,dx,dy) {
    if(!Number.isInteger(dx)||!Number.isInteger(dy))return null;
    const next=parse(JSON.stringify(m));
    for(const c of s.tiles)next.tiles[c.y][c.x]=0;
    for(const c of s.tiles){
      const x=c.x+dx,y=c.y+dy;
      if(x<0||x>=W||y<0||y>=H||next.tiles[y][x])return null;
    }
    for(const key of s.bodies){
      next[key].x+=dx;next[key].y+=dy;
      const r=bounds(next[key]);
      if(r.x<0||r.y<0||r.x+r.w>W*TILE||r.y+r.h>H*TILE)return null;
    }
    for(const c of s.tiles)next.tiles[c.y+dy][c.x+dx]=m.tiles[c.y][c.x];
    return {map:next,selection:{tiles:s.tiles.map(c=>({x:c.x+dx,y:c.y+dy})),bodies:s.bodies.slice()}};
  }
  function diff(before,after) {
    const changes = [];
    for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(before.tiles[y][x]!==after.tiles[y][x])
      changes.push({key:'tile',x,y,from:before.tiles[y][x],to:after.tiles[y][x]});
    for(const key of ['name','commentary','playerCount','spawn','exit','spawn2','exit2'])if(JSON.stringify(before[key])!==JSON.stringify(after[key]))
      changes.push({key,from:before[key],to:after[key]});
    return changes;
  }
  function applyChanges(current,changes) {
    if(!Array.isArray(changes)||changes.length>1507)throw Error('编辑操作过大');
    const next=parse(JSON.stringify(current)), seen=new Set();
    for(const change of changes){
      if(!change || !['tile','name','commentary','playerCount','spawn','exit','spawn2','exit2'].includes(change.key))throw Error('无效编辑操作');
      const {key,x,y,from,to}=change;
      if(key==='tile' && (!Number.isInteger(x)||!Number.isInteger(y)||x<0||x>=W||y<0||y>=H))throw Error('无效格子');
      const id=key==='tile'?`${x},${y}`:key;
      if(seen.has(id))throw Error('重复编辑操作'); seen.add(id);
      const value=key==='tile'?next.tiles[y][x]:next[key];
      if(JSON.stringify(value)!==JSON.stringify(from))throw Error('编辑冲突：队友已修改同一位置，请在最新地图上重试。');
      if(key==='tile')next.tiles[y][x]=to;else next[key]=to;
    }
    return parse(JSON.stringify(next));
  }
  const api = {W,H,TILE,tileNames,validTile,portalSurface,tileBounds,bodyKeys,partnerSpawn,blank,parse,json,bounds,validate,cpp,fillRectangle,selectRectangle,moveSelection,diff,applyChanges};
  if (typeof module !== 'undefined') module.exports = api;
  else root.MapModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
