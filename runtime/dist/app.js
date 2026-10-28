'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('game'), ctx = canvas.getContext('2d', {alpha: false});
  const menu = $('menu');
  const defaultBindings = {left:'KeyA', right:'KeyD', jump:'KeyW', down:'KeyS', exit:'KeyE', restart:'KeyR', checkpoint:'KeyC', preview:'KeyQ', blue:'KeyZ', orange:'KeyX', wallDirections:'KeyT'};
  const actionNames = {left:'向左', right:'向右', jump:'向上 / 跳跃', down:'向下', exit:'交互 / 进入出口', restart:'返回检查点／重试', checkpoint:'保存检查点', preview:'预览', blue:'蓝门', orange:'橙门', wallDirections:'全局门方向'};
  const storageKey = 'por2-web-v1';
  const defaults = {speed:1, speedBaseHz:40, volume:0.5, musicVolume:0.3, preview:true, shotFeedback:true, language:'zh-CN', wallDirections:false, debug:true, grid:false, crown:true, unlocked:false, reached:0, touch:'auto', bindings:{...defaultBindings}, maps:[]};
  let prefs = {...defaults, lastLevel:0, chapter:1, firstCompleted:[], secondLevel:0, secondReached:0, secondCompleted:[], thirdLevel:0, thirdReached:0, thirdCompleted:[]}, storageWarning = '';
  let secondCatalog = [], secondHiddenIds = new Set();
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved && typeof saved === 'object') {
      for (const key of ['preview','shotFeedback','wallDirections','debug','grid','crown']) if (typeof saved[key] === 'boolean') prefs[key] = saved[key];
      if (['zh-CN','en'].includes(saved.language)) prefs.language = saved.language;
      // Legacy unlocked records do not distinguish solo from co-op completion.
      prefs.unlocked = prefs.soloCrownUnlocked = saved.soloCrownUnlocked === true;
      if (saved.speedBaseHz === 40) {
        if ([0.1,0.5,0.8,1,1.25].includes(saved.speed)) prefs.speed = saved.speed;
      }
      if (Number.isFinite(saved.volume) && saved.volume >= 0 && saved.volume <= 1) prefs.volume = saved.volume;
      if (Number.isFinite(saved.musicVolume) && saved.musicVolume >= 0 && saved.musicVolume <= 1) prefs.musicVolume = saved.musicVolume;
      if (Number.isInteger(saved.reached) && saved.reached >= 0 && saved.reached < 15) prefs.reached = saved.reached;
      const lastLevel = saved.lastLevel ?? prefs.reached;
      if (Number.isInteger(lastLevel) && lastLevel >= 0 && lastLevel < 15) prefs.lastLevel = lastLevel;
      if (Number.isSafeInteger(saved.chapter) && saved.chapter > 0) prefs.chapter = saved.chapter;
      if (Array.isArray(saved.completedKeys)) prefs.completedKeys = saved.completedKeys.filter(k => typeof k === 'string' && /^\d+\/\d+\/\d+$/.test(k)).slice(0,10000);
      if (saved.lastMapIds && typeof saved.lastMapIds === 'object') prefs.lastMapIds = saved.lastMapIds;
      prefs.catalogIdVersion = saved.catalogIdVersion;
      for (const key of ["thirdLevel","thirdReached"]) if (Number.isInteger(saved[key]) && saved[key] >= 0 && saved[key] < 3) prefs[key] = saved[key];
      if (Array.isArray(saved.thirdCompleted)) prefs.thirdCompleted = [...new Set(saved.thirdCompleted.filter(i => Number.isInteger(i) && i >= 0 && i < 3))];
      if (Array.isArray(saved.firstCompleted)) prefs.firstCompleted = [...new Set(saved.firstCompleted.filter(i => Number.isInteger(i) && i >= 0 && i < 15))];
      for (const key of ['secondLevel','secondReached']) if (Number.isSafeInteger(saved[key]) && saved[key] >= 0) prefs[key] = saved[key];
      if (Array.isArray(saved.secondCompleted)) prefs.secondCompleted = [...new Set(saved.secondCompleted.filter(i => Number.isSafeInteger(i) && i >= 0))];
      if (['auto','on','off'].includes(saved.touch)) prefs.touch = saved.touch;
      const oldActions=Object.keys(defaultBindings).filter(k=>!['wallDirections','checkpoint','down'].includes(k));
      if (saved.bindings && oldActions.every(k=>validKey(saved.bindings[k])) && new Set(oldActions.map(k=>saved.bindings[k])).size===oldActions.length) {
        prefs.bindings=Object.fromEntries(oldActions.map(k=>[k,saved.bindings[k]]));
        const used=new Set(Object.values(prefs.bindings));
        prefs.bindings.wallDirections=[saved.bindings.wallDirections,'KeyT','KeyG','KeyH','KeyJ','KeyK','KeyL','KeyB','KeyN','KeyM'].find(k=>validKey(k)&&!used.has(k));
        used.add(prefs.bindings.wallDirections);
        prefs.bindings.checkpoint=[saved.bindings.checkpoint,'KeyC','KeyG','KeyH','KeyJ','KeyK','KeyL','KeyB','KeyN','KeyM'].find(k=>validKey(k)&&!used.has(k));
        used.add(prefs.bindings.checkpoint);
        prefs.bindings.down=[saved.bindings.down,'KeyS','ArrowDown','KeyJ','KeyK','KeyL'].find(k=>validKey(k)&&!used.has(k));
      }
      if (Array.isArray(saved.maps)) prefs.maps = saved.maps.filter(m => typeof m?.name === 'string' && typeof m.json === 'string' && m.json.length < 1048576).slice(0,20);
    }
  } catch (_) { storageWarning = '浏览器存储不可用或记录损坏；本次仍可游玩，请导出重要地图和录制。'; }
  const t = Por2I18n.text;
  Por2I18n.setLanguage(prefs.language);
  const shotAudio = new Por2ShotAudio(prefs.volume);
  const music = new Por2Music(prefs.musicVolume);
  // Start on page load; gestures retry if the browser blocks audible autoplay.
  music.unlock();
  document.addEventListener('pointerdown',() => music.unlock(),{capture:true});
  document.addEventListener('keydown',() => music.unlock(),{capture:true});
  document.addEventListener('pointerdown',() => shotAudio.unlock(),{capture:true});
  document.addEventListener('keydown',() => shotAudio.unlock(),{capture:true});
  let core, state, started = false, paused = true, ready = false, dirty = true;
  let previousTime = 0, accumulator = 0, tickMilliseconds, selectedPortal = 0, aim = null, aimGesture = null;
  let rebind = null, tutorialPaused = false, recordingText = '', recordingObserved = false;
  let coopRecorder = null, localShots = [];
  const pressed = new Set(), touches = new Map(), armed = new Set();
  let networkShots = [], remoteCursor = null;
  let remoteCursors = [], emoteWheel = null, emotes = [], chatBubbles = [];
  const emoteChoices = ['up','question','right','yes','down','no','left','exclamation'];
  const emoteStep = Math.PI*2/emoteChoices.length;
  function drawEmote(ctx, emote, x, y, size) {
    ctx.save();ctx.translate(x,y);ctx.scale(size/32,size/32);
    ctx.lineCap='round';ctx.lineJoin='round';
    ctx.beginPath();
    const direction=['up','right','down','left'].indexOf(emote);
    if(direction>=0) {
      ctx.rotate(direction*Math.PI/2);
      ctx.moveTo(0,12);ctx.lineTo(0,-12);
      ctx.moveTo(-9,-3);ctx.lineTo(0,-12);ctx.lineTo(9,-3);
    } else if(emote==='yes') {
      ctx.moveTo(-11,0);ctx.lineTo(-3,9);ctx.lineTo(12,-10);
    } else if(emote==='no') {
      ctx.moveTo(-10,-10);ctx.lineTo(10,10);ctx.moveTo(10,-10);ctx.lineTo(-10,10);
    } else if(emote==='question') {
      ctx.moveTo(-8,-7);ctx.bezierCurveTo(-8,-17,10,-17,9,-6);
      ctx.bezierCurveTo(9,0,0,0,0,5);
      ctx.moveTo(0,12);ctx.lineTo(0,12.1);
    } else if(emote==='exclamation') {
      ctx.moveTo(0,-13);ctx.lineTo(0,4);ctx.moveTo(0,12);ctx.lineTo(0,12.1);
    }
    ctx.strokeStyle='#10151e';ctx.lineWidth=7;ctx.stroke();
    ctx.strokeStyle=emote==='yes'?'#77dbac':emote==='no'?'#ff8585':'#fff';
    ctx.lineWidth=3.5;ctx.stroke();ctx.restore();
  }
  function canAim() { return !emoteWheel && (!net.connected || net.role >= 0); }
  function selectEmote(p) {
    if(!emoteWheel)return;
    const dx=(p?.x ?? emoteWheel.x)-emoteWheel.x, dy=(p?.y ?? emoteWheel.y)-emoteWheel.y;
    emoteWheel.selected = !p || Math.hypot(dx,dy)<22 ? -1 : (Math.round((Math.atan2(dy,dx)+Math.PI/2)/emoteStep)+emoteChoices.length)%emoteChoices.length;
    dirty=true;
  }
  function sendEmote() {
    if(!emoteWheel)return;
    const {origin:{x,y},selected}=emoteWheel;emoteWheel=null;dirty=true;
    if(selected<0 || !running())return;
    const event={type:'emote',emote:emoteChoices[selected],x,y};
    if(net.active)net.send(event);else showEmote({...event,player:0});
  }
  function showEmote(event) {
    emotes=emotes.filter(e=>e.player!==event.player);
    emotes.push({...event,born:performance.now()});dirty=true;
  }
  let catalogChapter = 0;
  const chapterSections = {};
  let levelCatalog = {sections:[],maps:[]};
  const catalogMaps = (chapter, section = 0) => levelCatalog.maps.filter(m => m.chapter === chapter && m.section === section);
  const mapKey = m => `${m.chapter}/${m.section}/${m.id}`;
  function chapterName(chapter) {
    return t(({1:'第一章 · 单人战役',2:'第二章 · 双角色合作',3:'第三章 · 重力机关'})[chapter] || `Chapter ${chapter}`);
  }
  function catalogUnlocked(map) {
    return !map.hidden || levelCatalog.maps.filter(m => m.chapter === map.chapter && m.section === map.section && !m.hidden)
      .every(m => prefs.completedKeys.includes(mapKey(m)));
  }
  function loadCatalogMap(map) {
    if (net.connected && net.player !== 0) return;
    try {
      if (net.connected) net.send({type:'level',chapter:map.chapter,section:map.section,level:map.id});
      else {
        stopRecording(); coopRecorder=null;
        if(!core._web_load_catalog(map.chapter,map.section,map.id,0,0))throw Error(string(core._web_error()));
        started=true; closeMenu(); sync();
      }
    } catch(e) { message(t('地图加载失败：') + e.message); }
  }
  function drawChapterSection() {
    const chapter = prefs.chapter;
    const sections = levelCatalog.sections.filter(s => s.chapter === chapter);
    const selected = chapterSections[chapter] ?? 'campaign';
    $('chapter-section').replaceChildren();
    for (const section of sections) {
      const option = document.createElement('option');
      option.value = section.section === 0 ? 'campaign' : String(section.section);
      option.textContent = section.name ? t(section.name) : (section.section === 0 ? t('战役') : t`小节 ${section.section}`);
      $('chapter-section').append(option);
    }
    $('chapter-section').value = selected;
    if (!$('chapter-section').value) $('chapter-section').selectedIndex = 0;
    chapterSections[chapter] = $('chapter-section').value;
    const section = chapterSections[chapter] === 'campaign' ? 0 : +chapterSections[chapter];
    const maps = catalogMaps(chapter,section);
    for (const option of $('chapter').options) option.textContent = chapterName(+option.value);
    $('chapter-description').textContent = maps.length ? t`共 ${maps.length} 张地图。` : t('本小节暂无地图。');
    $('level-list').hidden = section !== 0;
    $('section-list').hidden = section === 0;
    $('section-empty').hidden = maps.length > 0;
    $('level-list').replaceChildren(); $('section-list').replaceChildren();
    const list = $(section === 0 ? 'level-list' : 'section-list');
    maps.forEach((map,index) => {
      const button = document.createElement('button'), label = document.createElement('small');
      const completed = prefs.completedKeys.includes(mapKey(map));
      button.classList.toggle('completed',completed);
      button.classList.toggle('secret-level',map.hidden);
      button.hidden = !catalogUnlocked(map);
      label.textContent = (map.hidden ? 'level ？' : `LEVEL ${String(map.id).padStart(2,'0')}`) + (completed ? t(' · ✓ 已通关') : '');
      button.append(label,document.createTextNode(t(map.name) + t(map.players === 2 ? ' · 双人' : ' · 单人')));
      button.disabled = net.connected && net.player !== 0;
      button.onclick = () => section === 0 && chapter <= 3 ? beginLevel(index) : loadCatalogMap(map);
      list.append(button);
    });
  }
  const net = new CoopConnection(networkEvent);
  $('coop-status').onclick = () => openMenu('coop');
  $('room-button').onclick = () => openMenu('coop');
  $('room-lock').onclick = () => net.send({type:'lock',locked:!net.locked});
  let seatRequest = null, seatRequestNumber = 0, seatTimer, observedRole = -1, roleOptionsKey = '';
  function finishSeatRequest(text, success = false) {
    clearTimeout(seatTimer); seatRequest = null;
    $('seat-status').textContent = t(text);
    if (success) message(t(text));
    dirty = true;
  }
  function requestSeat(seat, role) {
    if (seatRequest || !net.code) return;
    clearInput();
    seatRequest = {seat,role,requestId:++seatRequestNumber};
    $('seat-status').textContent = t('正在切换席位…');
    net.send({type:'seat',...seatRequest});
    seatTimer = setTimeout(() => {
      finishSeatRequest('席位切换未确认，请检查连接后重试。'); sync();
    },5000);
    sync();
  }
  $('coop-seat').onclick = () => requestSeat(net.role<0?'operate':'watch',Number($('coop-role').value));
  $('room-resume').onclick = closeMenu;
  function renderMembers() {
    $('room-management').hidden = !net.code;
    $('room-lock').hidden = net.player !== 0;
    $('room-lock').textContent = net.locked ? t('开放加入') : t('锁定房间');
    $('room-access').textContent = net.locked ? t('房间已锁定，暂不接受加入。') : t('房间开放，知道房间码即可加入。');
    $('room-members').replaceChildren(...net.roster.map(member => {
      const row = document.createElement('div'), label = document.createElement('span'); row.className = 'row';
      const role = net.owners.indexOf(member.player);
      label.textContent = `P${member.player+1}${member.player===net.player?t('（你）'):''}${member.host?t(' · 房主'):''} · ${role<0?t('观战席'):t`操作席 · 角色 ${role+1}`}${member.ready?'':t(' · 同步中')}`;
      row.append(label);
      if(net.player===0 && !member.host) {
        const kick = document.createElement('button'); kick.textContent = t('踢出');
        kick.setAttribute('aria-label',t`踢出 P${member.player+1}`);
        kick.onclick = () => net.send({type:'kick',memberId:member.id}); row.append(kick);
      }
      return row;
    }));
  }
  const chat = $('chat');
  let unreadChat = 0;
  function resetChat() {
    chat.close(); $('chat-log').replaceChildren(); $('chat-input').value = '';
    $('chat-notice').textContent = ''; unreadChat = 0; chatBubbles = []; updateChatLabels();
  }
  function updateChatLabels() {
    for (const id of ['chat-open','chat-menu-open']) $(id).textContent = unreadChat ? t`聊天 (${unreadChat})` : t('房间聊天');
  }
  function openChat() {
    if (!net.code) return;
    clearInput(); unreadChat = 0; updateChatLabels(); chat.showModal();
    $('chat-log').scrollTop = $('chat-log').scrollHeight;
    $('chat-input').focus();
  }
  $('chat-open').onclick = $('chat-menu-open').onclick = openChat;
  $('chat-close').onclick = () => chat.close();
  chat.addEventListener('close',() => { clearInput(); if (!menu.open) canvas.focus({preventScroll:true}); });
  $('chat-input').addEventListener('keydown',e => {
    if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229)) e.preventDefault();
  });
  $('chat-form').onsubmit = e => {
    e.preventDefault();
    const text = $('chat-input').value.trim();
    if (!net.code || !text) return;
    net.send({type:'chat',text}); $('chat-input').value = ''; $('chat-input').focus();
  };
  function networkEvent(event) {
    if (event.type === 'joined') {
      resetChat();
      $('coop-room').textContent = t`房间码：${event.code} · 你是 P${event.player+1}。等待另一名玩家…`;
    } else if (event.type === 'start') {
      observedRole = net.role;
      finishSeatRequest('正在同步关卡…');
      remoteCursors=[];emotes=[];
      chatBubbles=[];
      stopRecording();
      if(event.map) callText('_web_load_map',event.map,Math.max(0,net.role));
      else if (!(core._web_load_catalog(event.chapter,event.section,event.level,Math.max(0,net.role),0))) throw Error(string(core._web_error()));
      if(event.snapshot) callText('_web_restore_snapshot',event.snapshot);
      core._web_coop_crowns(...event.crowns);
      coopRecorder = event.playerCount === 2 ? new Por2Script.Recorder({chapter:event.chapter,section:event.section,level:event.level,map:event.map,state:event.snapshot}) : null;
      prefs.chapter = event.chapter || (event.playerCount === 2 ? 2 : 1); $('chapter').value = String(prefs.chapter); save();
      started = true; remoteCursor = null; clearInput();
      net.send({type:'ready'}); closeMenu();
      message(t('房间已连接，可在联机菜单中选择操作席或观战席。'));
    } else if (event.type === 'owners') {
      if (observedRole !== net.role) clearInput();
      observedRole = net.role; core._web_coop_select(Math.max(0,net.role));
      core._web_coop_crowns(...event.crowns);
    } else if (event.type === 'crowns') {
      core._web_coop_crowns(...event.crowns); dirty = true;
    } else if (event.type === 'status') {
      if (observedRole !== net.role) clearInput();
      observedRole = net.role;
      remoteCursors = []; remoteCursor = null; chatBubbles = [];
      core._web_coop_select(Math.max(0,net.role));
      core._web_coop_crowns(...event.crowns);
      $('coop-room').textContent = t`房间码：${net.code} · 你是 P${net.player+1}${event.waiting ? t(' · 等待队友') : ''}`;
      if (!seatRequest) $('seat-status').textContent = net.paused ? t('正在同步关卡…') : net.role < 0 ? t('已进入观战席。') : t('已进入操作席。');
    } else if (event.type === 'seat_result') {
      if (seatRequest && event.requestId === seatRequest.requestId) {
        const operate = seatRequest.seat === 'operate';
        finishSeatRequest(event.ok === false ? (event.message || '席位切换失败，请重试。') : (operate ? '已进入操作席。' : '已进入观战席。'),event.ok !== false);
        if (event.ok !== false) closeMenu();
      }
    } else if (event.type === 'sync_progress') {
      $('seat-status').textContent = t`正在同步关卡 · 还差 ${event.remaining} 帧`;
    } else if (event.type === 'frame') {
      if(event.players.length === 2) tickCoop(event.players[0].flags,event.players[1].flags,event.players.flatMap((p,player)=>p.shots.map(s=>({...s,player}))));
      else {
        const before = readState(), flags = event.players[0].flags;
        for(const shot of event.players[0].shots) core._web_shot(shot.portal,shot.x,shot.y);
        core._web_tick(flags); reportCheckpoint(before,flags);
      }
      // Display cursors arrive separately; ordered physics frames must not clear
      // them between the independently paced cursor snapshots.
    } else if (event.type === 'cursors') {
      remoteCursors=event.cursors.filter(p=>p.player!==net.player && p.cursor);
      remoteCursor=remoteCursors[0]?.cursor || null;
    } else if (event.type === 'emote') {
      showEmote(event);
    } else if (event.type === 'ended') {
      finishSeatRequest(event.reason); observedRole = -1;
      remoteCursors=[];emotes=[];
      stopRecording(); coopRecorder = null;
      resetChat();
      core._web_coop_stop(); remoteCursor = null; clearInput(); openMenu();
      $('coop-room').textContent = t(event.reason); message(event.reason);
    } else if (event.type === 'chat') {
      chatBubbles = chatBubbles.filter(b => b.player !== event.player);
      chatBubbles.push({player:event.player,text:event.text,born:performance.now()});
      const line = document.createElement('p');
      line.textContent = `P${event.player+1}${event.player === net.player ? t('（你）') : ''}：${event.text}`;
      const log = $('chat-log'); log.append(line);
      while (log.children.length > 100) log.firstElementChild.remove();
      log.scrollTop = log.scrollHeight;
      $('chat-notice').textContent = '';
      if (!chat.open) { unreadChat++; updateChatLabels(); }
    } else if (event.type === 'error') { message(event.message); $('chat-notice').textContent = t(event.message); }
    dirty = true;
    // Replay and cursor traffic can arrive in bursts. Refresh the UI once per paint.
    if(['status','owners','ended'].includes(event.type)) renderMembers();
    if (event.type !== 'frame' && event.type !== 'cursors') sync();
  }
  let clearJumpPending = false;
  let pendingPresses = 0;
  const inputBits = {left:1,right:2,jump:4,exit:16,down:128};
  function latchPress(control) {
    const action = inputBits[control] ? control : Object.keys(prefs.bindings).find(a => prefs.bindings[a] === control);
    pendingPresses |= inputBits[action] || 0;
  }
  function inputFlags() {
    const clear = clearJumpPending ? 256 : 0; clearJumpPending = false;
    const flags = pendingPresses | Number(active('left')) | 2*Number(active('right')) | 4*Number(active('jump')) | 16*Number(active('exit')) | 128*Number(active('down'));
    pendingPresses = 0; return clear | flags;
  }
  function shoot(portal,x,y) {
    if(!canAim())return;
    if(state.tutorial >= 0 && ((!state.tutorialPractice && state.tutorial!==11) || tutorialPaused))return;
    if (net.connected) {
      if (net.role < 0 || !running() || networkShots.length >= 16) return;
      networkShots.push({portal,x,y});
    }
    else if (state.coop) {
      if(localShots.length>=16)return;
      localShots.push({player:state.localPlayer,portal,x,y});
    }
    else core._web_shot(portal,x,y);
    shotAudio.play(portal);
  }
  function switchPlayer() {
    if (!running()) return;
    if (net.connected) {
      if(net.role>=0 && net.owners.includes(-1)) { clearInput(); net.send({type:'switch'}); }
      return;
    }
    if (!state.coop) return;
    clearInput(); core._web_coop_select(1-state.localPlayer); sync();
  }
  function restartLevel() {
    if (net.connected) net.send({type:'restart'});
    else if(state.coop){clearInput();tickCoop(8,0,[]);}
    else core._web_restart();
    clearInput(); dirty = true;
  }
  let checkpointFeedbackTimer;
  function checkpointFeedback(text) {
    message(text);
    const element = $('checkpoint-feedback');
    element.textContent = t(text); element.hidden = false;
    clearTimeout(checkpointFeedbackTimer);
    checkpointFeedbackTimer = setTimeout(() => { element.hidden = true; },4000);
  }
  const checkpointFailure = '检查点保存失败：所有角色须在传送门外连续静止 25 帧（正常速度 0.625 秒）。已有检查点未被覆盖。';
  function reportCheckpoint(before,flags) {
    if (flags & 64) checkpointFeedback(before.canCheckpoint && !(flags & 8)
      ? (before.hasCheckpoint ? '检查点已更新。' : '检查点已保存。') : checkpointFailure);
  }
  function saveCheckpoint() {
    const current = readState();
    if(current.tutorial >= 0 || current.replay || (net.connected && (net.role < 0 || net.paused))) return;
    if(current.finished) { checkpointFeedback('检查点保存失败：本关已结束。'); return; }
    if(!current.canCheckpoint) { checkpointFeedback(checkpointFailure); return; }
    clearInput();
    if(net.connected) net.send({type:'checkpoint'});
    else if(current.coop) tickCoop(64,0,[]);
    else { core._web_tick(64); checkpointFeedback(current.hasCheckpoint ? '检查点已更新。' : '检查点已保存。'); }
    dirty = true;
  }
  setInterval(() => {
    if (net.active && running()) {
      const edges = pendingPresses;
      net.send({type:'input',flags:inputFlags(),pressed:edges,shots:networkShots,cursor:aim}); networkShots = [];
    }
  },20);
  const pixels = ctx.createImageData(1000,600);
  const coarse = matchMedia('(pointer: coarse)');
  let tutorialDirections = true;
  let tutorialPreview = true;
  const previewEnabled = () => mobileControls() || (state?.tutorial === 11 ? tutorialPreview : prefs.preview);
  const wallDirectionsEnabled = () => state.tutorial === 11 ? tutorialDirections : prefs.wallDirections;
  const tutorialCopy = [
    ['移动与跳跃','观察角色左右移动和跳跃。先短按调整位置，再尝试连续移动。'],
    ['两种墙面','白色墙面可以放门，深色墙面阻挡射线。射线从角色头部发出。'],
    ['瞄准中间格','击中的格子是传送门的中间格。上下或左右必须有足够空间容纳完整的门。'],
    ['身体与门的朝向','观察四种头部朝向如何影响门的方向。朝向也决定能否匹配出口。'],
    ['亮暗端的对应','穿门时身体位置和速度一起转换，门的亮暗两端帮助判断对应关系。'],
    ['跨门时的锁定','身体占比较大的一侧暂时锁定，另一侧仍可移动。完全穿出后锁定解除。'],
    ['先走到出口','观察角色走近灰色出口、停下并通过。亲自试试：短按移动键微调，让身体与出口重合、头部朝向一致，再按交互键（默认 E）。'],
    ['放门并穿过','左键放蓝门，右键放橙门：瞄准侧墙靠近地面的中间格，看清预览再松手。默认 Q 开关放门预览，T 开关全局门方向，两者都只是提示。射线被中央障碍挡住时，换个站位或跳起再瞄准。两扇门都出现后再进入，穿出后对齐灰色出口并按交互键（默认 E）。'],
    ['转向与对齐','门已配好：向左进入侧墙蓝门，从地面橙门出来后向右穿过低通道。亮端对应亮端、暗端对应暗端，观察头部点如何转向。身体与灰色出口对齐后按交互键（默认 E）。'],
    ['落差与远跳','门已配好：下落进入地面蓝门，从左侧橙门飞出后向右移动。切换起步高度后先看起点，再点“继续”；其他操作尽量不变，比较穿出后的运动和落点。碰墙和落地会改变运动。'],
    ['只让头部先过去','向左短按，让头部点进入顶部窄缝后松开。蓝门金框表示它所在侧身体占比较大；从窄缝中的头部点瞄准右墙靠近顶部的中间格，右键移动橙门，再向左穿过。暂停只用于观察；完全穿出后重新判断锁定。'],
    ['四向门预览','黄色直箭头指向头部朝向（黑色描边用于区分身体）；两侧蓝、橙弧箭头示意两种门的朝向，随人物旋转，不是运动轨迹。四面白墙的方向提示（T）默认开启，可随时开关。比较同一墙段在转向前后的箭头；方向提示不保证射线能放门。可暂停观察。'],
    ['亮暗端的对应','两扇门始终亮端对应亮端、暗端对应暗端，方向相反时也不变。先看两扇门的渐变，再跟随头部点从蓝门进、橙门出。每个例子先停留，再自动穿门，最后展示穿出姿态。'],
    ['认识身体：大小、头与划分','一格 20 像素；身体长 58、宽 18，约三格长、一格宽。头部的深色小点是头部点，即射击起点，位于头端以内 9 像素。分色只为区分头、中段、脚，整个矩形都参与碰撞。先比较四种朝向，再看身体穿门后的两部分：锁定按两侧实际面积判断，与头部位置无关。']
  ];
  tutorialCopy.push(['头部留在门外换门','蓝门的金色边框表示它所在侧身体占比较大，已锁定、暂时不能移动（参见第一段）。橙门仍可从原侧的头部点移动，但新位置须容得下另一端身体。本段对比脚部先入门和头端先入门：头部点位于头端以内 9 像素，头端已入门不代表头部点也已穿门；头部点仍在原侧时照样可以放门。红圈标出头部点，即实际射击起点。']);
  const lessonOrder = [13,6,7,8,9,10,14,11,12];
  // Center the trimmed 500 x 340 lesson room without changing its puzzle coordinates.
  const lessonOffset = () => [8,10].includes(state?.tutorial) ? {x:10,y:30} : {x:0,y:0};
  const lessonChapters = {
    9:['低处起步','高处起步'],
    10:['移到门口','探头观察并换门','完成身体转移'],
    11:['头朝上','头朝右','头朝下','头朝左'],
    12:['两门同向 · 头朝上','两门同向 · 头朝下','两门反向','横放 · 头部先入','横放 · 脚部先入'],
    13:['头朝上','头朝右','头朝下','头朝左','跨门身体划分'],
    14:['脚部先入，头部留在门外','主体侧锁定，瞄准另一扇门','橙门已移动，头部点仍在原侧','继续穿出',
      '头端先入，观察红圈标出的头部点','头端已入门，头部点仍在原侧','放门成功：从原侧移动橙门','头端先入的例子：继续穿出']
  };
  function updateLessonPresentation(){
    const bodyLesson=state.tutorial===13,split=state.tutorialPhase===4;
    $('body-lesson-captions').hidden=!bodyLesson;
    if(bodyLesson){
      $('body-lesson-captions').classList.toggle('split-body',split);
      $('body-lesson-title').textContent=split?t('同一个身体，被门口分成两部分'):t('真实角色在中央；下方为 3 倍放大示意');
      const total=state.bodyAreas.reduce((a,b)=>a+b,0);
      $('body-lesson-size').textContent=split?(total?t`蓝门侧 ${Math.round(state.bodyAreas[0]/total*100)}% · 橙门侧 ${Math.round(state.bodyAreas[1]/total*100)}%`:t('观察身体逐渐进入门口')):(state.direction%2?t('横放：58 × 18 像素'):t('竖放：18 × 58 像素'));
      $('body-lesson-note').textContent=split?t('红色圆圈：头部点（射击起点）；金框：身体占比较大的一侧所在的门'):t('浅色头段 · 中段 · 深色脚段（分色仅为示意）');
    }
    // Practice is free-form; stage 10's automatic phase counter is not a practice checklist.
    const chapters=state.tutorialPractice&&state.tutorial===10?null:lessonChapters[state.tutorial];
    const badge=$('tutorial-subchapter'),note=$('tutorial-chapter-note');
    badge.hidden=note.hidden=!chapters;
    if(chapters){
      const progress=t`小节 ${state.tutorialPhase+1} / ${chapters.length} · ${t(chapters[state.tutorialPhase])}`;
      if(badge.textContent!==progress)badge.textContent=progress;
      note.textContent=t`${progress}。${state.tutorialPractice?t('用起步高度按钮切换对照。'):t('本段包含多个小节，会自动轮播，可暂停观察。')}“下一段”会离开整段演示。`;
    }
  }
  function drawBodyLesson() {
    ctx.save();
    if(state.tutorialPhase<4){
      ctx.save();ctx.translate(490,300);ctx.rotate(state.direction*Math.PI/2);
      ctx.strokeStyle='#727e78';ctx.lineWidth=1;ctx.setLineDash([3,3]);
      for(let x=-10;x<=10;x+=20){ctx.beginPath();ctx.moveTo(x,-30);ctx.lineTo(x,30);ctx.stroke();}
      for(let y=-30;y<=30;y+=20){ctx.beginPath();ctx.moveTo(-10,y);ctx.lineTo(10,y);ctx.stroke();}
      ctx.restore();
      ctx.save();ctx.translate(490,445);ctx.rotate(state.direction*Math.PI/2);ctx.scale(3,3);
      for(const [i,color] of ['#8ad5bd','#51b495','#298267'].entries()){ctx.fillStyle=color;ctx.fillRect(-9,-29+i*58/3,18,58/3);}
      ctx.fillStyle='#173c31';ctx.fillRect(-1,-21,2,2);
      ctx.strokeStyle='#172d25';ctx.lineWidth=.7;ctx.strokeRect(-9,-29,18,58);
      ctx.restore();
    }else{
      ctx.strokeStyle='#ff3030';ctx.lineWidth=3;ctx.beginPath();ctx.arc(state.headX,state.headY,9,0,Math.PI*2);ctx.stroke();
    }
    ctx.restore();
  }
  const shotReasons = ['', '瞄准位置无效，请重新瞄准。', '这扇门所在侧的身体占比较大，暂时锁定；试着移动另一扇门。',
    '射线没有命中可用墙面，请从头部点检查射击方向。', '射线先撞到了深色墙面；调整站位或瞄准方向。',
    '新门会与另一扇门重叠，请换一段墙。', '命中格周围放不下完整的三格门；瞄准连续白墙的中间格，并检查门前空间。',
    '换门后的身体或另一端身体会撞墙；调整门的位置或先移动身体。', '队友身体占比较大的一侧锁住了这扇门；请队友先调整位置。',
    '换门后会与队友或其周围墙面冲突；先腾出身体所需空间。'];
  let feedbackContext='',feedbackSequence=-1,feedbackTimer;
  function updateShotFeedback(){
    const context=[state.index,state.tutorial,state.coop,state.localPlayer].join(':');
    const node=$('shot-feedback');
    if(!prefs.shotFeedback){node.hidden=true;clearTimeout(feedbackTimer);feedbackContext=context;feedbackSequence=state.shotSequence;return;}
    if(context!==feedbackContext){node.hidden=true;clearTimeout(feedbackTimer);feedbackContext=context;feedbackSequence=state.shotSequence;return;}
    if(state.shotSequence===feedbackSequence)return;
    feedbackSequence=state.shotSequence;
    if(!state.shotFailure)return;
    node.textContent=t`放门失败：${t(shotReasons[state.shotFailure] || '请调整位置后重试。')} 原门保留。`;
    node.hidden=false;clearTimeout(feedbackTimer);feedbackTimer=setTimeout(()=>{node.hidden=true;},3000);
  }
  function lessonText() {
    if(state.finished)return t('已到达出口！可以重练本段，或切换下一段。');
    const base=t(tutorialCopy[state.tutorial]?.[1] || '');
    if(state.tutorial===14)return `${t(state.tutorialPhase<4?'例一：脚部先入门，头部留在原侧。':'例二：头端先入门，但红圈标出的头部点尚未穿门，仍能从原侧放门并移动橙门。')}${base}`;
    if(state.tutorial===13)return `${state.tutorialPhase<4?t`当前头朝${[t('上'),t('右'),t('下'),t('左')][state.tutorialPhase]}。`:state.tutorialHeadThrough?t('头部点已探到另一端，但身体占比较大的一侧仍留在原门；金框门不能移动。'):t('观察头部先进入门口，再比较两侧身体面积。')}${base}`;
    if(state.tutorial===11)return t`当前：头朝${[t('上'),t('右'),t('下'),t('左')][state.tutorialPhase]}。${base} 弧线箭头即当前姿态下墙面门的方向。可用鼠标左右键或放门键放门；切换姿态时清空已放的门。`;
    if(state.tutorial===12)return `${[t('例一：两门同向，头朝上进入。'),t('例二：两门同向，头朝下进入。'),t('例三：两门反向，头朝上进入、朝下穿出。'),t('例四：身体横放，头朝左、头部先进入。'),t('例五：身体横放，头朝右、脚部先进入。')][state.tutorialPhase]}${base}`;
    if(state.tutorial===8)return t`${base} 试着从门口不同位置进入，比较另一端身体的位置。A / D 始终对应屏幕左右；接近门口时短按观察。`;
    if(state.tutorial===9)return `${state.tutorialPhase===0?t('当前：低处起步。'):t('当前：高处起步。')}${tutorialPaused?t('已暂停，点击“继续”开始下落。'):''}${base}`;
    if(state.tutorial===10){
      const step=state.tutorialHeadThrough ? t('头部已穿门：以窄缝中的头部点为射击起点。') : state.tutorialPhase===2 ? t('另一扇门已移到右墙，继续穿出并对齐出口。') : t('先观察身体与头部，再短按移动。');
      return `${step}${base}`;
    }
    return base;
  }
  function drawTutorialDirections() {
    ctx.save();
    // The reference sketch points right; rotate the complete diagram with the actor.
    const horizontal=state.direction%2===1;
    ctx.translate(state.x+(horizontal?29:9),state.y+(horizontal?9:29));
    ctx.rotate((state.direction-1)*Math.PI/2);
    ctx.lineCap='round';ctx.lineJoin='round';
    const strokeArrow=(path,color,width=4)=>{
      ctx.strokeStyle='#080b0d';ctx.lineWidth=width+4;ctx.stroke(path);
      ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke(path);
    };
    if(wallDirectionsEnabled()){
      for(const side of [-1,1])for(const [offset,color] of [[0,'#39aaff'],[18,'#ff982e']]){
        const y=side*(60+offset);
        const arc=new Path2D();arc.moveTo(-65,y);
        arc.bezierCurveTo(-30,y+side*42,35,y+side*42,65,y);
        // The arrowhead follows the curve's tangent toward the headward end.
        const angle=Math.atan2(-side*42,30);
        for(const turn of [-0.5,0.5]){
          arc.moveTo(65-15*Math.cos(angle+turn),y-15*Math.sin(angle+turn));arc.lineTo(65,y);
        }
        strokeArrow(arc,color);
      }
    }
    const heading=new Path2D();heading.moveTo(-35,0);heading.lineTo(43,0);
    heading.moveTo(29,-12);heading.lineTo(43,0);heading.lineTo(29,12);
    strokeArrow(heading,'#ffe34d',5);
    ctx.restore();
  }
  function validKey(code) { return typeof code === 'string' && code !== 'KeyV' && /^(Key[A-Z]|Digit[0-9]|Arrow(Left|Right|Up|Down)|Space|ShiftLeft|ShiftRight|Comma|Period)$/.test(code); }
  function message(text) { $('notice').textContent = t(text); $('menu-notice').textContent = t(text); }
  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(prefs)); }
    catch (_) { message(t('浏览器存储已满或不可用。本次修改仍有效，请备份地图；设置可能无法保留。')); }
  }
  function isSecondHiddenIndex(index) { return secondHiddenIds.has(secondCatalog[index]); }
  function secondHiddenUnlocked() { return secondCatalog.length > 0 && secondCatalog.every(id => secondHiddenIds.has(id) || prefs.secondCompleted.includes(id)); }
  function levelLabel(index, second) { return second && isSecondHiddenIndex(index) ? 'level ？' : `Level ${catalogMaps(second ? 2 : prefs.chapter)[index]?.id ?? index}`; }
  function string(pointer) { return core.UTF8ToString(pointer); }
  function readState() {
    const s=JSON.parse(string(core._web_state()));
    if(s.coop&&recordingObserved&&coopRecorder){s.recording=1;s.recordedFrames=coopRecorder.frames;}
    return s;
  }
  function newCoopRecorder(){return new Por2Script.Recorder({chapter:readState().catalogChapter,section:readState().section,level:readState().level,map:string(core._web_level_json())||null});}
  function recordCompletion(before, after) {
    if (!before.catalogChapter || before.tutorial >= 0 || before.finished || before.replay ||
        (after.level === before.level && !after.finished)) return;
    const completed = before.coop ? prefs.secondCompleted : before.chapter === 3 ? prefs.thirdCompleted : prefs.firstCompleted;
    const id = before.level;
    const key = `${before.catalogChapter}/${before.section}/${before.level}`;
    if (!prefs.completedKeys.includes(key)) { prefs.completedKeys.push(key); catalogChapter = 0; save(); }
    if (before.section === 0 && !completed.includes(id)) { completed.push(id); catalogChapter = 0; save(); }
  }
  function tickCoop(first,second,shots=localShots.splice(0)){
    const before = readState();
    if(coopRecorder&&(net.connected||recordingObserved)&&!coopRecorder.capture([first,second],shots)&&recordingObserved){stopRecording();message(t('录制达到容量上限，已导出完整记录的帧。'));}
    for(const s of shots)core._web_coop_shot(s.player,s.portal,s.x,s.y);
    core._web_coop_tick(first,second);
    const after = readState();
    reportCheckpoint(before,first | second);
    recordCompletion(before, after);
  }
  function callText(method, text, ...args) {
    const bytes = new TextEncoder().encode(text), pointer = core._malloc(bytes.length + 1);
    if (!pointer) throw Error(t('内存不足，请减少导入文件大小。'));
    try {
      core.HEAPU8.set(bytes,pointer); core.HEAPU8[pointer + bytes.length] = 0;
      if (!core[method](pointer,...args)) throw Error(string(core._web_error()));
    } finally { core._free(pointer); }
  }
  function clearInput() {
    pendingPresses = 0;
    clearJumpPending = true;
    shotAudio.stop();
    emoteWheel=null;
    networkShots = []; localShots = [];
    if (net.active) net.send({type:'clear'});
    pressed.clear(); touches.clear(); armed.clear(); aimGesture = null; aim = null;
    document.querySelectorAll('.held').forEach(b => b.classList.remove('held'));
    if (ready) core._web_clear_input();
    accumulator = 0; dirty = true;
  }
  function running() { return ready && started && !paused && !menu.open && !chat.open && (!net.connected || (net.active && !net.paused)); }
  function closeMenu() {
    if (!ready || !started) return;
    if (document.hidden) { paused = true; clearInput(); return; }
    rebind = null; drawBindings(); clearInput(); menu.close(); paused = false;
    previousTime = performance.now(); canvas.focus({preventScroll:true}); dirty = true;
  }
  function showPanel(name) {
    if (name !== 'files') managingMaps = false;
    document.querySelectorAll('.panel').forEach(p => p.hidden = p.id !== `${name}-panel`);
    rebind = null; drawBindings();
    if (name === 'files') { refreshSavedMaps(); drawMaps(); loadServerMaps(); }
    if (name === 'levels') drawChapterSection();
    menu.scrollTop = 0;
  }
  function openMenu(panel = 'home') {
    paused = true; clearInput(); showPanel(panel);
    $('resume-button').hidden = !started;
    $('close-menu').disabled = !started;
    if (!menu.open) menu.showModal();
    sync();
  }
  function download(text, filename, type = 'text/plain;charset=utf-8') {
    const blob = new Blob([text],{type}), url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function stopRecording(exportFile = true) {
    if (!ready || !recordingObserved) return;
    recordingText = coopRecorder ? coopRecorder.text() : string(core._web_record_stop()); recordingObserved = false;
    if(!net.connected)coopRecorder=null;
    $('export-recording').disabled = !recordingText;
    if (recordingText && exportFile) download(recordingText,`Por2D-${new Date().toISOString().replace(/[:.]/g,'-')}.txt`);
    message(recordingText ? t('录制已停止并导出，也可以在“地图与回放”中再次导出。') : t('录制已停止；尚未产生逻辑帧。'));
  }
  function beginLevel(index) {
    const map = catalogMaps(prefs.chapter)[index];
    if (!map || !catalogUnlocked(map)) return;
    loadCatalogMap(map);
  }
  function beginMap(json, remember = true) {
    if (net.connected) return message(t('请先离开联机房间再本地试玩，或由房主在地图列表中选择地图。'));
    stopRecording(); coopRecorder=null; callText('_web_load_map',json,0); started = true;
    if (remember) {
      const name = string(core._web_level_name());
      prefs.maps = [{name,json}, ...prefs.maps.filter(m => m.json !== json)].slice(0,20); save();
    }
    closeMenu(); sync();
  }
  let managingMaps = false;
  function mapTile(map, remember = false) {
    const tile = document.createElement('button'), label = document.createElement('small'), name = document.createElement('span');
    let count = 1;
    try { count = JSON.parse(map.json).playerCount === 2 ? 2 : 1; } catch (_) {}
    label.textContent = t(count === 2 ? '双角色地图' : '单角色地图');
    name.textContent = map.name;
    tile.append(label, name);
    tile.disabled = net.connected && net.player !== 0;
    tile.onclick = () => {
      if (net.connected) return selectRoomMap(map);
      try { beginMap(map.json, remember); } catch(e) { message(t('地图加载失败：') + e.message); }
    };
    return tile;
  }
  function drawMaps() {
    $('custom-list').replaceChildren();
    if (!prefs.maps.length) managingMaps = false;
    $('manage-maps').textContent = t(managingMaps ? '完成管理' : '管理地图');
    $('manage-maps').disabled = !prefs.maps.length;
    $('manage-maps').setAttribute('aria-pressed', String(managingMaps));
    $('custom-list').classList.toggle('managing', managingMaps);
    prefs.maps.forEach(map => {
      const tile = mapTile(map);
      if (managingMaps) {
        tile.disabled = false;
        tile.querySelector('small').textContent = t('点击移除');
        tile.setAttribute('aria-label', t`移除地图 ${map.name}`);
        tile.onclick = () => { prefs.maps = prefs.maps.filter(m => m.json !== map.json); save(); drawMaps(); };
      }
      $('custom-list').append(tile);
    });
  }
  $('manage-maps').onclick = () => { managingMaps = !managingMaps; drawMaps(); };
  function selectRoomMap(map) {
    if (!net.connected || net.player !== 0) return;
    try {
      callText('_web_validate_coop_map',map.json);
      net.send({type:'map',map:JSON.stringify(JSON.parse(map.json))});
    } catch(e) { message(t('地图不能用于联机：')+e.message); }
  }
  function refreshSavedMaps() {
    try {const saved=JSON.parse(localStorage.getItem(storageKey)||'{}');if(Array.isArray(saved.maps))prefs.maps=saved.maps.filter(m=>typeof m?.name==='string'&&typeof m.json==='string'&&m.json.length<1048576).slice(0,20);}catch(_){}
  }
  window.addEventListener('storage',e=>{if(e.key===storageKey){refreshSavedMaps();if(ready)drawMaps();}});
  async function loadServerMaps() {
    const list=$('server-map-list');list.replaceChildren();
    try {
      const response=await fetch('/api/maps');if(!response.ok)return;
      const result=await response.json();if(!Array.isArray(result.maps))return;
      for(const map of result.maps.slice(0,20)){
        if(typeof map.name!=='string'||typeof map.json!=='string'||map.json.length>1048576)continue;
        list.append(mapTile(map,true));
      }
    }catch(_){} // Static hosting still supports browser-local imports.
  }
  function keyLabel(code) { return code.replace(/^Key/,'').replace(/^Digit/,'').replace('Arrow',t('方向')); }
  function drawBindings() {
    $('bindings').replaceChildren();
    for (const [action,label] of Object.entries(actionNames)) {
      const b = document.createElement('button'), name = document.createElement('span'), key = document.createElement('span');
      name.textContent = t(label); key.textContent = rebind === action ? t('请按新键…') : keyLabel(prefs.bindings[action]);
      b.append(name,key); b.classList.toggle('waiting',rebind === action); b.onclick = () => { rebind = action; drawBindings(); };
      $('bindings').append(b);
    }
    const hints = document.querySelector('.desktop-hints'); hints.replaceChildren();
    for (const [actions,label] of [[['left','right'],t('移动')],[['jump'],t('跳跃')],[['exit'],t('交互')],[['blue','orange'],t('放门')],[['preview'],t('预览')],[['checkpoint'],t('保存检查点')],[['restart'],t('返回／重试')]]) {
      const item = document.createElement('span');
      for (const action of actions) { const key = document.createElement('kbd'); key.textContent = keyLabel(prefs.bindings[action]); item.append(key); }
      item.append(document.createTextNode(' '+label)); hints.append(item);
    }
    const mouse = document.createElement('span'); mouse.textContent = t('鼠标左 / 右键 放门'); hints.append(mouse);
    const switching = document.createElement('span'); switching.textContent = t('Ctrl 切换角色（第二章单机）'); hints.append(switching);
    const emoteHint=document.createElement('span');emoteHint.textContent=t('按住 V 选择表情，松开发送');hints.append(emoteHint);

    labelControl('restart-button',t`返回检查点／重试（${keyLabel(prefs.bindings.restart)}）`);
    labelControl('checkpoint-button',t`${state?.hasCheckpoint ? t('更新检查点') : t('保存检查点')}（${keyLabel(prefs.bindings.checkpoint)}）：所有角色在传送门外静止 25 帧（正常速度 0.625 秒）`);
    canvas.setAttribute('aria-label',t`Por2D 游戏画面。${keyLabel(prefs.bindings.left)} / ${keyLabel(prefs.bindings.right)} 移动，${keyLabel(prefs.bindings.jump)} 跳跃，${keyLabel(prefs.bindings.exit)} 进入出口，鼠标左右键放置传送门。`);
  }
  function labelControl(id,label) {
    $(id).setAttribute('aria-label',label);
    $(id).title = label;
  }
  document.querySelectorAll('.icon-button,#touch-controls button').forEach(button => {
    button.addEventListener('contextmenu',event => event.preventDefault());
    button.addEventListener('selectstart',event => event.preventDefault());
  });
  let landscapeEnabled = false, orientationKey = '';
  function mobileControls() { return coarse.matches || prefs.touch === 'on'; }
  function updateOrientation() {
    const immersive = mobileControls() && landscapeEnabled;
    const rotated = immersive && innerHeight > innerWidth;
    const nextKey = `${immersive}/${rotated}`;
    document.body.classList.toggle('landscape-game',immersive);
    document.body.classList.toggle('force-landscape',rotated);
    if (nextKey !== orientationKey) {
      orientationKey = nextKey;
      if (immersive) {
        $('stage').append($('touch-controls'),$('fullscreen-button'),$('orientation-button'),$('restart-button'),$('checkpoint-button'));
      } else {
        document.querySelector('.game-shell').after($('touch-controls'));
        $('menu-button').before($('fullscreen-button'),$('orientation-button'));
        document.querySelector('.game-bottom').append($('checkpoint-button'),$('restart-button'));
      }
      clearInput();
    }
    labelControl('fullscreen-button',document.fullscreenElement ? t('退出全屏') : t('全屏'));
    $('fullscreen-button').setAttribute('aria-pressed',String(!!document.fullscreenElement));
    labelControl('orientation-button',landscapeEnabled ? t('退出横屏布局') : t('横屏布局'));
    $('orientation-button').textContent = landscapeEnabled ? t('退出横屏布局') : t('横屏布局');
    $('orientation-button').setAttribute('aria-pressed',String(landscapeEnabled));
    $('orientation-button').hidden = !mobileControls();
  }
  function applyTouch() {
    document.body.classList.toggle('touch',prefs.touch === 'on' || (prefs.touch === 'auto' && coarse.matches));
    $('preview').disabled = mobileControls();
    $('preview').checked = previewEnabled();
    updateOrientation();
  }
  window.addEventListener('resize',updateOrientation);
  function setPortal(id) {
    selectedPortal = id; dirty = true;
    document.querySelectorAll('[data-portal]').forEach(b => { const on = +b.dataset.portal === id; b.classList.toggle('active',on); b.setAttribute('aria-pressed',String(on)); });
  }
  let lastUiSync = -Infinity;
  function sync() {
    if (!ready) return;
    lastUiSync = performance.now();
    state = readState();
    $('checkpoint-button').disabled = !started || state.tutorial >= 0 || !!state.replay || (net.connected && (net.role < 0 || net.paused));
    labelControl('checkpoint-button',t`${state.hasCheckpoint ? t('更新检查点') : t('保存检查点')}（${keyLabel(prefs.bindings.checkpoint)}）：所有角色在传送门外静止 25 帧（正常速度 0.625 秒）`);
    $('menu-restart').textContent = state.hasCheckpoint ? t('返回检查点') : t('重试本关');
    const levelKey = state.coop ? 'secondLevel' : state.chapter === 3 ? 'thirdLevel' : 'lastLevel', reachedKey = state.coop ? 'secondReached' : state.chapter === 3 ? 'thirdReached' : 'reached';
    if (started && state.index >= 0 && state.tutorial < 0 && !state.replay && prefs[levelKey] !== state.index) {
      prefs[levelKey] = state.index; prefs.lastMapIds[state.coop ? 2 : state.chapter] = state.level; save();
    }
    if (started && state.index > prefs[reachedKey] && state.tutorial < 0 && !state.replay) { prefs[reachedKey] = state.index; save(); }
    if (state.crown && !prefs.unlocked) { prefs.unlocked = true; prefs.soloCrownUnlocked = true; save(); }
    const rawName = string(core._web_level_name());
    const name = state.index >= 0 ? t(rawName) : rawName;
    $('coop-bar').hidden = !net.connected;
    $('coop-status').textContent = t`房间 ${net.code || t('连接中')} · P${net.player+1} · ${!net.active ? t('等待队友') : net.paused ? t('正在同步关卡') : t`${net.members}/8 人 · ${net.role < 0 ? t('观战席') : t`操作席 · 角色 ${net.role+1}`} · ${String(net.speed)}×`}`;
    for (const id of ['coop-create','coop-join','coop-code','tutorial-intro','import-map','example-map']) $(id).disabled = net.connected;
    $('speed').value = net.connected ? net.speed : prefs.speed;
    $('coop-menu-leave').hidden = !net.connected;
    $('coop-seat').hidden = !net.connected;
    $('coop-seat').textContent = seatRequest ? t('正在切换…') : net.role<0 ? t('进入操作席') : t('进入观战席');
    $('coop-seat').disabled = !!seatRequest || !net.code || (net.role<0 && (!net.active || net.paused || !net.owners.includes(-1)));
    $('coop-role').hidden = !net.connected || net.role>=0;
    const nextRoleKey = `${prefs.language}/${net.owners.join(',')}`;
    if (nextRoleKey !== roleOptionsKey) {
      roleOptionsKey = nextRoleKey;
      const selectedRole = Number($('coop-role').value);
      $('coop-role').replaceChildren(...net.owners.flatMap((owner,role)=>{
        if(owner>=0)return [];
        const option=document.createElement('option'); option.value=String(role); option.textContent=t`角色 ${role+1}`;
        return [option];
      }));
      if(net.owners[selectedRole]===-1)$('coop-role').value=String(selectedRole);
    }
    $('coop-role').disabled = $('coop-seat').disabled;
    $('room-button').textContent = net.connected ? t('房间 / 席位') : t('联机房间');
    $('room-button').hidden = !started;
    $('room-menu-entry').textContent = net.connected ? t('当前房间 · 席位与成员') : t('多人联机 · 创建/加入房间');
    $('room-resume').disabled = !started || (net.connected && !net.active);
    $('room-resume').hidden = !started;
    $('chat-menu-open').hidden = !net.code;
    $('resume-button').disabled = $('close-menu').disabled = !started || (net.connected && !net.active);
    document.querySelectorAll('#level-list button').forEach(b => b.disabled = net.connected && net.player !== 0);
    $('chapter').disabled = net.connected && net.player !== 0;
    if (catalogChapter !== prefs.chapter) {
      catalogChapter = prefs.chapter;
      drawChapterSection();
    }
    $('switch-player').hidden = net.connected ? net.role<0 || !net.owners.includes(-1) : !state.coop;
    $('switch-player').disabled = net.connected && (net.role < 0 || net.paused || !net.owners.includes(-1));
    labelControl('switch-player',net.connected ? t('Ctrl · 切换空闲角色') : `Ctrl · P${state.localPlayer+1} → P${2-state.localPlayer}`);
    labelControl('spectator-button',state.spectator ? t('返回 V') : t('观察 V'));
    $('spectator-button').setAttribute('aria-pressed',String(!!state.spectator));
    $('menu-title').textContent = net.active ? t('联机菜单') : started ? t('游戏已暂停') : t('换个入口，找到出口。');
    $('menu-intro').textContent = net.active ? t`当前：${name}。游戏仍在运行，关闭菜单即可继续操作。` : started ? t`当前：${name}。继续游戏将回到暂停前的位置。` : t('在二维世界里，用一对传送门连接空间。保留动量、转变朝向，走出看似不可能的关卡。');
    $('resume-button').textContent = net.active ? t('返回游戏') : t('继续游戏');
    $('play-button').hidden = started;
    $('play-button').textContent = prefs.chapter > 3 ? `${chapterName(prefs.chapter)} · ${t('开始游戏')} ↗` : t`第${prefs.chapter === 2 ? t('二') : prefs.chapter === 3 ? t('三') : t('一')}章 · ${levelLabel(prefs.chapter === 2 ? prefs.secondLevel : prefs.chapter === 3 ? prefs.thirdLevel : prefs.lastLevel,prefs.chapter === 2)} 开始 ↗`;
    $('menu-restart').hidden = !started || state.tutorial >= 0 || !!state.replay;
    $('stage-menu-button').hidden = !started;
    $('level-label').textContent = state.tutorial >= 0 ? t('实时教学演示') : `${state.index >= 0 ? t`第${state.coop ? t('二') : state.chapter === 3 ? t('三') : t('一')}章 · ${levelLabel(state.index,state.coop)}` : state.catalogChapter ? `${chapterName(state.catalogChapter)} · 小节 ${state.section} · Level ${state.level}` : t('自定义地图')} · ${name}`;
    const lessonNumber = state.tutorial >= 6 ? lessonOrder.indexOf(state.tutorial)+1 : state.tutorial+1;
    const lessonCount = state.tutorial >= 6 ? lessonOrder.length : 6;
    $('mode-label').textContent = state.recording ? t`● 录制中 · ${state.recordedFrames} 帧` : state.tutorial >= 0 ? `${state.tutorialPractice ? t('自由练习') : t('演示')} ${lessonNumber} / ${lessonCount}` : state.replay ? t('回放模式') : `${String(prefs.speed)}×`;
    $('pause-badge').hidden = !paused && !(state.replay && state.replayPaused) && !(state.tutorial >= 0 && tutorialPaused);
    const commentary = string(core._web_level_commentary());
    $('game-status').textContent = state.tutorial >= 0 ? t`${t(tutorialCopy[state.tutorial][0])} · 操作说明见下方` : state.finished ? t('已完成！打开菜单选择关卡，或按重试重新开始。') : (state.index >= 0 ? t(commentary) : commentary) || t('移动到出口，并让头部朝向与出口一致。');
    if (state.coop && !net.connected) {
      $('mode-label').textContent = t`单机合作 · 操作 P${state.localPlayer+1} · ${String(prefs.speed)}×`;
      $('game-status').textContent = state.finished ? (state.index < 0 ? t('两人均已通过自定义地图！') : t('两人均已通过第二章！')) : t`绿色 P1 / 紫色 P2 · Ctrl 切换角色 · ${state.players[state.localPlayer]?.exited ? t('当前角色已通过，请切换角色') : t('共用两扇门，两人均通过后过关')}`;
    }
    if (net.connected) {
      $('mode-label').textContent = t`房间 ${net.members}/8 人 · P${net.player+1} · ${net.role < 0 ? t('观战席') : t`操作席 · 角色 ${net.role+1}`} · ${String(net.speed)}×`;
      $('pause-badge').hidden = true;
      $('game-status').textContent = state.finished ? t('两人均已通过全部关卡！') : state.players[net.role]?.exited ? t('你已通过，等待队友进入出口。') : (net.role < 0 ? t('正在观战，可在联机菜单中进入空闲操作席。') : t('可在联机菜单中进入观战席，释放当前角色。'));
    }
    if (state.coop && !state.finished) {
      $('game-status').textContent = (state.index >= 0 ? t(commentary) : commentary) || $('game-status').textContent;
    }
    if (state.spectator) {
      $('mode-label').textContent += t(' · 观察者');
      $('game-status').textContent = t('观察者：无碰撞、不可移动或放门。按 V 返回；若位置被占据，请等待队友移开或重试。');
    }
    if(state.tutorial < 0 && !state.replay && state.hasCheckpoint) $('game-status').textContent += t` · 检查点已保存，${keyLabel(prefs.bindings.restart)} 返回`;
    $('tutorial-bar').hidden = state.tutorial < 0;
    $('tutorial-direction-legend').hidden = state.tutorial !== 11;
    document.body.classList.toggle('teaching',state.tutorial >= 0);
    document.body.classList.toggle('body-lesson',state.tutorial === 13);
    updateLessonPresentation();
    if (state.tutorial >= 0) {
      $('tutorial-label').textContent = `${lessonNumber} / ${lessonCount} · ${t(tutorialCopy[state.tutorial][0])}`;
      $('tutorial-text').textContent = lessonText();
      $('tutorial-prev').disabled = state.tutorial === 0 || state.tutorial === lessonOrder[0];
      $('tutorial-next').disabled = state.tutorial === 5 || state.tutorial === lessonOrder.at(-1);
      $('tutorial-practice').textContent = state.tutorialPractice ? t('返回自动演示') : t('亲自试试');
      $('tutorial-practice').hidden = state.tutorial < 6 || state.tutorial >= 11;
      $('tutorial-reset').hidden = state.tutorial < 6;
      $('tutorial-height').hidden = state.tutorial !== 9;
      $('tutorial-height').textContent = state.tutorialPhase===0 ? t('改从高处起步') : t('改从低处起步');
    }
    $('tutorial-pause').textContent = tutorialPaused ? t('继续') : t('暂停');
    $('wallDirections').checked = wallDirectionsEnabled();
    $('preview').checked = previewEnabled();
    if(state.recording&&state.coop)$('mode-label').textContent+=t` · ● 录制 ${state.recordedFrames} 帧`;
    $('record-button').textContent = state.recording ? t('停止并导出录制') : net.connected ? t('录制本次联机') : t('从关卡起点录制');
    $('record-button').disabled = !started || state.tutorial >= 0 || (net.connected&&(!net.active||net.paused||!coopRecorder?.active));
    $('record-status').textContent = state.recording ? t`录制中：${state.recordedFrames} 个逻辑帧。切换关卡前会导出。` : net.connected ? (coopRecorder?.active?t('包含本次同步起点以来的双人操作，不重置游戏。联机菜单和失焦期间仍记录同步帧。'):t('等待房间加载；达到容量上限后需重新加载关卡。')) : state.coop ? t('从起点录制两名角色，可切换角色或重试。自定义地图随文件保存，请在回放播放器中打开。') : t('暂停时不录制。页面关闭前请停止并导出。');
    document.querySelectorAll('#level-list button').forEach((b,i) => b.classList.toggle('reached',i <= prefs[prefs.chapter === 2 ? 'secondReached' : prefs.chapter === 3 ? 'thirdReached' : 'reached']));
    if (recordingObserved && !state.recording) stopRecording();
  }
  function keyHeld(code) { return pressed.has(code) || [...touches.values()].includes(code); }
  function active(action) { return keyHeld(prefs.bindings[action]) || [...touches.values()].includes(action); }
  function pressKeyAction(code) {
    const action = Object.keys(prefs.bindings).find(a => prefs.bindings[a] === code);
    if (action === 'restart') restartLevel();
    if (action === 'checkpoint') saveCheckpoint();
    if (action === 'preview' && !mobileControls()) { if(state.tutorial===11)tutorialPreview=!tutorialPreview;else prefs.preview = !prefs.preview; $('preview').checked = previewEnabled(); save(); }
    if (action === 'wallDirections') { if(state.tutorial===11)tutorialDirections=!tutorialDirections;else prefs.wallDirections = !prefs.wallDirections; $('wallDirections').checked = wallDirectionsEnabled(); save(); }
    if (action === 'blue' || action === 'orange') { setPortal(action === 'orange' ? 1 : 0); armed.add(code); }
    dirty = true;
  }
  function releaseKeyAction(code, cancelled = false) {
    if (keyHeld(code)) return;
    if (armed.delete(code) && !cancelled && running() && aim) shoot(code === prefs.bindings.orange ? 1 : 0,aim.x,aim.y);
  }
  function frame(now) {
    if(emoteWheel || emotes.length || chatBubbles.length) {
      emotes=emotes.filter(e=>now-e.born<3600);dirty=true;
      chatBubbles=chatBubbles.filter(b=>now-b.born<5000);
    }
    const elapsed = Math.max(0,Math.min(120,now-previousTime)); previousTime = now;
    if (running() && !net.connected) {
      accumulator += elapsed * prefs.speed;
      let steps = 0;
      while (accumulator >= tickMilliseconds && steps++ < 6) {
        const flags = inputFlags();
        if (state.coop) tickCoop(state.localPlayer === 0 ? flags : flags & 256,state.localPlayer === 1 ? flags : flags & 256);
        else if (!(state.tutorial >= 0 && tutorialPaused)) {
          const before = readState();
          core._web_tick(flags);
          recordCompletion(before, readState());
        }
        accumulator -= tickMilliseconds; dirty = true;
      }
    } else accumulator = 0;
    if (ready && dirty) {
      // Physics/rendering stays responsive; menu DOM does not need rebuilding at frame rate.
      if (!running() || now-lastUiSync >= 100) sync(); else state = readState();
      updateShotFeedback();
      core._web_wall_directions(wallDirectionsEnabled());
      const pointer = core._web_render(prefs.debug,prefs.grid,canAim() && previewEnabled() && aim && running() ? (aimGesture?.portal ?? selectedPortal) : -1,aim?.x || 0,aim?.y || 0);
      // Copy from the current heap: its buffer can change after memory growth.
      pixels.data.set(core.HEAPU8.subarray(pointer,pointer+pixels.data.length));
      const offset=lessonOffset();
      if(offset.x||offset.y){ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);}
      ctx.putImageData(pixels,offset.x,offset.y);
      if(state.tutorial===11)drawTutorialDirections();
      if(state.tutorial===13)drawBodyLesson();
      if(state.tutorial===14){ctx.save();ctx.strokeStyle='#ff3030';ctx.lineWidth=3;ctx.beginPath();ctx.arc(state.headX,state.headY,9,0,Math.PI*2);ctx.stroke();ctx.restore();}
      dirty = false;
      if(net.connected && state.coop) {
        ctx.save();ctx.font='14px system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
        for(const b of chatBubbles) {
          const role=net.owners.indexOf(b.player);
          const player=state.players[role];
          if(!player || player.exited || player.spectator) continue;
          const age=now-b.born, fade=Math.min(1,(5000-age)/700), label=`P${b.player+1}: ${b.text}`;
          const maxWidth=280, words=[...label], lines=[];let line='';
          for(const char of words) { const next=line+char; if(line && ctx.measureText(next).width>maxWidth){lines.push(line);line=char;}else line=next; }
          if(line) lines.push(line);
          const width=Math.min(maxWidth,Math.max(72,...lines.map(text=>ctx.measureText(text).width)))+20;
          const height=lines.length*19+16, x=Math.max(width/2+6,Math.min(994-width/2,player.x+15));
          const y=Math.max(height/2+8,player.y-player.height/2-30-height/2);
          ctx.globalAlpha=fade;ctx.fillStyle='#f4f7f2';ctx.strokeStyle=role===0?'#77dbac':'#e8a5eb';ctx.lineWidth=2;
          ctx.beginPath();ctx.roundRect(x-width/2,y-height/2,width,height,9);ctx.fill();ctx.stroke();
          ctx.beginPath();ctx.moveTo(x-6,y+height/2-1);ctx.lineTo(x,y+height/2+8);ctx.lineTo(x+6,y+height/2-1);ctx.fill();ctx.stroke();
          ctx.fillStyle='#17211f';lines.forEach((text,i)=>ctx.fillText(text,x,y-(lines.length-1)*9.5+i*19));
        }
        ctx.restore();
      }
      for(const {player,cursor:{x,y}} of remoteCursors) {
        const role = net.owners.indexOf(player);
        ctx.strokeStyle = role<0 ? '#aeb8c5' : ['#77dbac','#e8a5eb'][role]; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x-8,y); ctx.lineTo(x+8,y); ctx.moveTo(x,y-8); ctx.lineTo(x,y+8); ctx.stroke();
        ctx.font = '14px sans-serif'; ctx.fillText(`P${player+1}`,Math.min(x+12,965),Math.max(16,y-10));
      }
      ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';
      for(const e of emotes) {
        ctx.globalAlpha=Math.min(1,Math.max(0,(3600-(now-e.born))/600));
        const x=Math.max(22,Math.min(978,e.x)),y=Math.max(28,Math.min(558,e.y));
        drawEmote(ctx,e.emote,x,y,32);ctx.fillStyle='#fff';
        ctx.font='12px sans-serif';ctx.fillText(`P${e.player+1}`,x,y+26);
      }
      ctx.globalAlpha=1;
      if(emoteWheel) {
        const {x,y,selected}=emoteWheel;
        for(let i=0;i<emoteChoices.length;i++) {
          const angle=-Math.PI/2+i*emoteStep;
          ctx.beginPath();ctx.arc(x,y,88,angle-emoteStep/2,angle+emoteStep/2);ctx.arc(x,y,24,angle+emoteStep/2,angle-emoteStep/2,true);ctx.closePath();
          ctx.fillStyle=i===selected?'#356b79':'#192231ee';ctx.fill();ctx.strokeStyle='#7791aa';ctx.lineWidth=1;ctx.stroke();
          drawEmote(ctx,emoteChoices[i],x+Math.cos(angle)*57,y+Math.sin(angle)*57,28);
        }
      }
      ctx.restore();
    }
    requestAnimationFrame(frame);
  }
  function point(event) {
    const r = canvas.getBoundingClientRect();
    const rotated = document.body.classList.contains('force-landscape');
    const x = rotated ? (event.clientY-r.top)*1000/r.height : (event.clientX-r.left)*1000/r.width;
    const y = rotated ? (r.right-event.clientX)*600/r.width : (event.clientY-r.top)*600/r.height;
    const offset=lessonOffset(),worldX=x-offset.x,worldY=y-offset.y;
    return x >= 0 && x < 1000 && y >= 0 && y < 600 && worldX>=0 && worldY>=0 && worldX<1000 && worldY<600 ? {x:worldX,y:worldY} : null;
  }
  canvas.addEventListener('contextmenu',e => e.preventDefault());
  canvas.addEventListener('pointerdown',e => {
    if(emoteWheel) { e.preventDefault();selectEmote(point(e));if(e.button===0)sendEmote();else {emoteWheel=null;dirty=true;}return; }
    if(!canAim())return;
    if (!running() || (state.tutorial >= 0 ? (!state.tutorialPractice && state.tutorial!==11) || tutorialPaused : state.replay) || aimGesture || ![0,2].includes(e.button)) return;
    e.preventDefault(); canvas.focus({preventScroll:true});
    aim = point(e); if (!aim) return;
    if (e.pointerType === 'mouse') setPortal(e.button === 2 ? 1 : 0);
    aimGesture = {id:e.pointerId,portal:selectedPortal}; canvas.setPointerCapture(e.pointerId); dirty = true;
  });
  canvas.addEventListener('pointermove',e => {
    if (aimGesture && aimGesture.id !== e.pointerId) return;
    aim = point(e); dirty = true;
    selectEmote(aim);
  });
  canvas.addEventListener('pointerup',e => {
    if (!aimGesture || e.pointerId !== aimGesture.id) return;
    const target = point(e), portal = aimGesture.portal; aimGesture = null;
    if (running() && target) shoot(portal,target.x,target.y);
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    dirty = true;
  });
  const cancelAim = e => { if(e.type === 'pointercancel') clearInput(); if(emoteWheel){emoteWheel=null;dirty=true;} if (aimGesture?.id === e.pointerId) { aimGesture = null; aim = null; dirty = true; } };
  canvas.addEventListener('pointercancel',cancelAim); canvas.addEventListener('lostpointercapture',cancelAim);
  canvas.addEventListener('pointerleave',() => { if (!aimGesture) { aim = null;selectEmote(null);dirty = true; } });
  document.querySelectorAll('[data-hold],[data-key]').forEach(button => {
    const control = button.dataset.key || button.dataset.hold;
    button.addEventListener('pointerdown',e => {
      if (!running() || (state.tutorial >= 0 ? !state.tutorialPractice || tutorialPaused : state.replay)) return;
      const alreadyHeld = button.dataset.key && keyHeld(control);
      e.preventDefault(); touches.set(e.pointerId,control); button.classList.add('held'); button.setPointerCapture(e.pointerId);
      if (!alreadyHeld) latchPress(control);
      if (button.dataset.key && !alreadyHeld) pressKeyAction(control);
    });
    const release = e => {
      const wasHeld = touches.delete(e.pointerId);
      if (wasHeld && e.type !== 'pointerup') clearInput();
      if (![...touches.values()].includes(control)) button.classList.remove('held');
      if (wasHeld && button.dataset.key) releaseKeyAction(control,e.type !== 'pointerup');
    };
    for (const type of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(type,release);
  });
  document.querySelectorAll('[data-portal]').forEach(b => b.onclick = () => setPortal(+b.dataset.portal));
  window.addEventListener('keydown',e => {
    if (!ready) return;
    if (chat.open) return;
    if (rebind) {
      e.preventDefault();
      if (e.code === 'Escape') { rebind = null; drawBindings(); return; }
      if (!validKey(e.code) || e.ctrlKey || e.metaKey || e.altKey) return message(t('请选择字母、数字、方向键、空格、Shift 或逗号/句号。系统快捷键保留。'));
      if (Object.entries(prefs.bindings).some(([a,k]) => a !== rebind && k === e.code)) return message(t('该键已绑定其他操作，请换一个键。'));
      prefs.bindings[rebind] = e.code; rebind = null; save(); drawBindings(); message(t('键位已保存。')); return;
    }
    if (e.code === 'Escape' && !menu.open) { e.preventDefault(); openMenu(); return; }
    if (['ControlLeft','ControlRight'].includes(e.code) && running() && state.coop && !menu.open && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault(); if (!e.repeat) switchPlayer(); return;
    }
    if (menu.open || !running() || e.ctrlKey || e.metaKey || e.altKey || ['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (e.code === 'KeyV') {
      e.preventDefault();
      if(!e.repeat && aim && !state.replay && state.tutorial<0) {
        const anchor={...aim};clearInput();aim=anchor;
        emoteWheel={origin:anchor,x:Math.max(90,Math.min(910,anchor.x)),y:Math.max(90,Math.min(510,anchor.y)),selected:-1};dirty=true;
      }
      return;
    }
    if(emoteWheel)return;
    if(state.tutorial===11 && [prefs.bindings.wallDirections,prefs.bindings.preview].includes(e.code)){
      e.preventDefault();if(!e.repeat)pressKeyAction(e.code);return;
    }
    if(state.tutorial >= 0 && (!state.tutorialPractice || tutorialPaused) &&
      !(state.tutorial===11 && !tutorialPaused && ['blue','orange','preview'].some(action=>prefs.bindings[action]===e.code)))return;
    if (state.tutorial < 0 && state.replay && ['Space','Period'].includes(e.code)) {
      e.preventDefault(); if (e.repeat) return;
      if (e.code === 'Space') core._web_replay_pause(!state.replayPaused); else core._web_replay_step();
      dirty = true; return;
    }
    const action = Object.keys(prefs.bindings).find(a => prefs.bindings[a] === e.code);
    if (!action) return;
    e.preventDefault(); if (e.repeat) return;
    const alreadyHeld = keyHeld(e.code); pressed.add(e.code);
    if (!alreadyHeld) { latchPress(e.code); pressKeyAction(e.code); }
  });
  window.addEventListener('keyup',e => {
    if(e.code==='KeyV'){sendEmote();return;}
    pressed.delete(e.code);
    releaseKeyAction(e.code);
  });
  function loseFocus() { clearInput(); }
  window.addEventListener('blur',loseFocus);
  document.addEventListener('visibilitychange',() => { if (document.hidden) loseFocus(); });
  window.addEventListener('beforeunload',e => { if (recordingObserved) { e.preventDefault(); e.returnValue = ''; } });
  menu.addEventListener('cancel',e => { e.preventDefault(); if (rebind) { rebind = null; drawBindings(); } else closeMenu(); });
  $('close-menu').onclick = closeMenu; $('resume-button').onclick = closeMenu;
  $('menu-button').onclick = () => openMenu(); $('help-button').onclick = () => openMenu('help');
  $('stage-menu-button').onclick = () => openMenu();
  $('menu-restart').onclick = () => { restartLevel(); closeMenu(); sync(); };
  function connectRoom(join) {
    stopRecording(); openMenu('coop');
    const json=string(core._web_level_json());
    if(!join && json){try{callText('_web_validate_coop_map',json);}catch(e){return message(t('地图不能用于联机：')+e.message);}}
    net.connect({... (join ? {type:'join'} : json ? {type:'create',map:json} : {type:'create',chapter:started && state.catalogChapter === prefs.chapter ? state.catalogChapter : prefs.chapter,section:started && state.catalogChapter === prefs.chapter ? state.section : 0,level:started && state.catalogChapter === prefs.chapter ? state.level : catalogMaps(prefs.chapter)[prefs.chapter === 2 ? prefs.secondLevel : prefs.chapter === 3 ? prefs.thirdLevel : prefs.lastLevel]?.id ?? 0}), code:$('coop-code').value.trim().toUpperCase(), crownUnlocked:prefs.unlocked, crownVisible:prefs.crown});
    $('coop-room').textContent = t('正在连接…'); sync();
  }
  $('coop-create').onclick = () => connectRoom(false);
  $('coop-join').onclick = () => connectRoom(true);
  $('coop-leave').onclick = $('coop-menu-leave').onclick = () => net.leave();
  document.querySelectorAll('[data-panel]').forEach(b => b.onclick = () => showPanel(b.dataset.panel));
  $('chapter').value = String(prefs.chapter);
  $('chapter').onchange = e => { prefs.chapter = +e.target.value; save(); sync(); };
  $('chapter-section').onchange = e => { chapterSections[prefs.chapter] = e.target.value; drawChapterSection(); sync(); };
  $('play-button').onclick = () => beginLevel(prefs.chapter === 2 ? prefs.secondLevel : prefs.chapter === 3 ? prefs.thirdLevel : prefs.lastLevel);
  $('switch-player').onclick = switchPlayer;
  $('spectator-button').hidden = true;
  $('restart-button').onclick = () => { if (ready) { restartLevel(); canvas.focus({preventScroll:true}); } };
  $('checkpoint-button').onclick = () => { if(ready) { saveCheckpoint(); canvas.focus({preventScroll:true}); } };
  $('fullscreen-button').onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else { landscapeEnabled = true; updateOrientation(); message(t('当前浏览器不支持页面全屏，已使用横屏布局。')); }
    } catch (_) { landscapeEnabled = true; updateOrientation(); message(t('浏览器未进入全屏，已使用横屏布局。')); }
  };
  $('orientation-button').onclick = () => { landscapeEnabled = !landscapeEnabled; updateOrientation(); };
  document.addEventListener('fullscreenchange',updateOrientation);
  $('speed').value = prefs.speed;
  $('shotFeedback').checked = prefs.shotFeedback;
  $('shotFeedback').onchange = e => {
    prefs.shotFeedback = e.target.checked;
    $('shot-feedback').hidden = true; clearTimeout(feedbackTimer);
    if(state) feedbackSequence = state.shotSequence;
    save();
  };
  $('language').value = prefs.language;
  $('language').onchange = e => {
    prefs.language = e.target.value; clearInput(); rebind = null;
    Por2I18n.setLanguage(prefs.language);
    catalogChapter = 0; drawBindings(); updateVolume(); updateOrientation();
    renderMembers(); updateChatLabels(); sync(); save(); dirty = true;
    if(net.code) $('coop-room').textContent = t`房间码：${net.code} · 你是 P${net.player+1}${!net.active ? t(' · 等待队友') : ''}`;
    $('shot-feedback').hidden = true; clearTimeout(feedbackTimer);
  };
  const updateVolume = () => {
    $('music-volume').value = Math.round(prefs.musicVolume * 100);
    $('music-volume-value').textContent = prefs.musicVolume ? `${Math.round(prefs.musicVolume * 100)}%` : t('静音');
    $('volume').value = Math.round(prefs.volume * 100);
    $('volume-value').textContent = prefs.volume ? `${Math.round(prefs.volume * 100)}%` : t('静音');
  };
  updateVolume();
  $('volume').oninput = e => {
    prefs.volume = Math.max(0,Math.min(100,+e.target.value)) / 100;
    shotAudio.setVolume(prefs.volume); updateVolume(); save();
  };
  $('sound-preview').onclick = () => shotAudio.play(selectedPortal);
  $('music-volume').oninput = e => {
    prefs.musicVolume = Math.max(0,Math.min(100,+e.target.value)) / 100;
    music.setVolume(prefs.musicVolume); updateVolume(); save();
  };
  $('speed').onchange = e => {
    if (net.connected) net.send({type:'speed',speed:+e.target.value});
    else { prefs.speed = +e.target.value; accumulator = 0; save(); dirty = true; }
  };
  for (const name of ['preview','wallDirections','debug','grid','crown']) {
    $(name).checked = prefs[name];
    $(name).onchange = e => { if(name==='wallDirections'&&state.tutorial===11)tutorialDirections=e.target.checked;else if(name==='preview'&&state.tutorial===11)tutorialPreview=e.target.checked;else prefs[name] = e.target.checked; core._web_crown(prefs.unlocked,prefs.crown); if (name === 'crown' && net.connected) net.send({type:'crown',visible:prefs.crown}); save(); dirty = true; };
  }
  $('touch-mode').value = prefs.touch;
  $('touch-mode').onchange = e => { prefs.touch = e.target.value; clearInput(); applyTouch(); save(); };
  if (coarse.addEventListener) coarse.addEventListener('change',applyTouch);
  $('reset-bindings').onclick = () => { prefs.bindings = {...defaultBindings}; rebind = null; drawBindings(); save(); };
  $('import-map').onclick = () => $('map-file').click();
  async function importFile(event) {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 1024*1024) throw Error(t('地图不能超过 1 MB'));
      const text = await file.text();
      beginMap(text);
      message(t`已载入 ${file.name}`);
    } catch (e) { message(t`导入失败：${e.message}`); }
    finally { event.target.value = ''; }
  }
  $('map-file').onchange = importFile;
  $('example-map').onclick = async () => {
    try { const response = await fetch('levels/example.json'); if (!response.ok) throw Error(t('示例地图读取失败')); beginMap(await response.text()); }
    catch(e) { message(e.message); }
  };
  $('record-button').onclick = () => {
    if (readState().recording) { stopRecording(); sync(); }
    else {
      if(state.coop){
        if(net.connected){if(!coopRecorder?.active)return message(t('请等待房间重新加载后开始录制。'));}
        else {const next=newCoopRecorder();clearInput();core._web_restart_level();coopRecorder=next;}
      }else{coopRecorder=null;core._web_record_start();}
      recordingObserved = true; closeMenu(); sync();
      message(net.connected?t('正在录制本次房间加载以来的双人操作，游戏继续运行。'):t('已从当前关卡起点开始录制。结束时在菜单中停止并导出。'));
    }
  };
  $('export-recording').onclick = () => download(recordingText,'Por2D-recording.txt');
  function selectLesson(stage) { clearInput(); core._web_tutorial(stage); tutorialDirections=true; tutorialPreview=true; tutorialPaused=false; dirty=true; sync(); canvas.focus({preventScroll:true}); }
  function startLessons(stage) { stopRecording(); selectLesson(stage); started=true; closeMenu(); sync(); }
  $('tutorial-intro').onclick = () => startLessons(lessonOrder[0]);
  $('tutorial-prev').onclick = () => selectLesson(state.tutorial>=6?lessonOrder[Math.max(0,lessonOrder.indexOf(state.tutorial)-1)]:Math.max(0,state.tutorial-1));
  $('tutorial-next').onclick = () => selectLesson(state.tutorial>=6?lessonOrder[Math.min(lessonOrder.length-1,lessonOrder.indexOf(state.tutorial)+1)]:Math.min(5,state.tutorial+1));
  $('tutorial-height').onclick = () => { clearInput();core._web_tutorial_height(state.tutorialPhase===0);tutorialPaused=true;dirty=true;sync();canvas.focus({preventScroll:true}); };
  $('tutorial-practice').onclick = () => { clearInput(); core._web_tutorial_practice(!state.tutorialPractice); tutorialPaused=false; dirty=true; sync(); canvas.focus({preventScroll:true}); };
  $('tutorial-reset').onclick = () => { clearInput(); core._web_restart(); dirty=true; canvas.focus({preventScroll:true}); };
  $('tutorial-pause').onclick = () => { clearInput(); tutorialPaused = !tutorialPaused; dirty = true; };
  $('tutorial-exit').onclick = () => { core._web_tutorial(-1); clearInput(); dirty = true; canvas.focus({preventScroll:true}); };
  applyTouch(); drawBindings();
  async function boot() {
    try {
      if (location.protocol === 'file:') throw Error(t('请通过 HTTP 打开：在 Por2D_web 目录运行 python serve.py，再访问 http://127.0.0.1:8000。'));
      if (typeof createPor2 !== 'function') throw Error(t('游戏核心加载失败。请确认已完整解压分享包，按 START-HERE.txt 启动后刷新页面。'));
      core = await createPor2(); ready = true;
      const catalogText = string(core._web_catalog_json());
      if (!catalogText) throw Error(string(core._web_error()));
      levelCatalog = JSON.parse(catalogText);
      const chapters = [...new Set(levelCatalog.sections.map(s => s.chapter))];
      if (!chapters.includes(prefs.chapter)) prefs.chapter = chapters[0];
      $('chapter').replaceChildren();
      for (const chapter of chapters) {
        const option = document.createElement('option'); option.value = String(chapter); option.textContent = chapterName(chapter); $('chapter').append(option);
      }
      $('chapter').value = String(prefs.chapter);
      // Frozen old menu order is used only to migrate saves written before stable IDs.
      const legacyFirst = [0,5,6,7,8,9,10,3,14,11,12,15,13,4,16];
      const legacySecond = [0,1,2,3,4,5,6,7,9,10,11,14,13,12,8];
      if (prefs.catalogIdVersion !== 2) {
        const migrate = (chapter,id) => chapter === 1 ? legacyFirst.indexOf(id) : chapter === 2 ? legacySecond.indexOf(id) : id;
        prefs.secondCompleted = prefs.secondCompleted.map(id => migrate(2,id)).filter(id=>id>=0);
        if (prefs.completedKeys) prefs.completedKeys = prefs.completedKeys.map(key => {
          const [chapter,section,id] = key.split('/').map(Number);
          return section === 0 ? `${chapter}/0/${migrate(chapter,id)}` : key;
        }).filter(key=>!key.endsWith('/-1'));
        if (prefs.lastMapIds) for (const chapter of [1,2]) {
          if (prefs.lastMapIds[chapter] !== undefined) prefs.lastMapIds[chapter] = migrate(chapter,prefs.lastMapIds[chapter]);
        }
        prefs.catalogIdVersion = 2;
      }
      if (!prefs.completedKeys) prefs.completedKeys = [
        ...prefs.firstCompleted.map(i => `1/0/${i}`),
        ...prefs.secondCompleted.map(id => `2/0/${id}`),
        ...prefs.thirdCompleted.map(id => `3/0/${id}`)
      ];
      prefs.lastMapIds ??= {};
      for (const [chapter,key] of [[1,'lastLevel'],[2,'secondLevel'],[3,'thirdLevel']]) {
        const maps = catalogMaps(chapter);
        const id = prefs.lastMapIds[chapter] ?? prefs[key];
        prefs[key] = Math.max(0,maps.findIndex(m => m.id === id));
        prefs.lastMapIds[chapter] = maps[prefs[key]]?.id;
      }
      save();
      secondCatalog = Array.from({length:core._web_second_catalog_count()},(_,i) => core._web_second_catalog_id(i));
      secondHiddenIds = new Set(secondCatalog.filter(id => core._web_second_is_hidden(id)));
      if (prefs.secondLevel >= secondCatalog.length || (isSecondHiddenIndex(prefs.secondLevel) && !secondHiddenUnlocked())) prefs.secondLevel = 0;
      if (prefs.secondReached >= secondCatalog.length) prefs.secondReached = 0;
      core._web_crown(prefs.unlocked,prefs.crown);
      for (const id of ['play-button','menu-button','help-button','restart-button']) $(id).disabled = false;
      $('loading').hidden = true; state = readState(); tickMilliseconds = state.tickMilliseconds; openMenu();
      if (storageWarning) message(storageWarning);
      previousTime = performance.now(); requestAnimationFrame(frame);
      // A read-only state snapshot is useful for repeatable browser smoke tests.
      window.por2Web = Object.freeze({state:() => ({...readState(),paused:net.active ? false : paused,menu:menu.open,held:pressed.size+touches.size,emoteWheel:emoteWheel ? {...emoteWheel} : null,emotes:emotes.map(e=>({...e,opacity:Math.min(1,Math.max(0,(3600-(performance.now()-e.born))/600))})),network:{active:net.active,paused:net.paused,speed:net.speed,code:net.code,player:net.player,role:net.role,members:net.members,sequence:net.sequence,remoteCursor,remoteCursors}}),ready:true});
    } catch (e) {
      $('load-status').textContent = t('加载失败：') + e.message;
      $('loading').querySelector('strong').textContent = t('暂时无法进入游戏');
      $('loading').querySelector('.spinner').hidden = true;
    }
  }
  boot();
})();

