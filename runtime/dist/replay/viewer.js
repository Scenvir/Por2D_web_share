'use strict';
(async()=>{
  const $=id=>document.getElementById(id),ctx=$('game').getContext('2d'),pixels=ctx.createImageData(1000,600);
  let core,player,playing=false,busy=false,generation=0,loadGeneration=0,last=null,accumulator=0;
  const notice=text=>$('notice').textContent=text;
  function draw(){if(!player)return;const s=player.status(),ptr=core._web_render(1,Number($('grid').checked),-1,0,0);pixels.data.set(core.HEAPU8.subarray(ptr,ptr+pixels.data.length));ctx.putImageData(pixels,0,0);
    $('progress').textContent=`${s.frame} / ${s.totalFrames} 帧 · ${(s.frame*.025).toFixed(2)} 秒`;$('timeline').max=s.totalFrames;$('timeline').value=s.frame;
    $('play').textContent=playing?'暂停':'播放';$('play').disabled=!player.script||busy||s.completed;$('step').disabled=!player.script||busy||s.completed;$('reset').disabled=!player.script;$('timeline').disabled=!player.script;
    $('action').textContent=s.action?`第 ${s.action.line} 行 · ${s.action.text}\n本段 ${player.within} / ${s.action.frames} 帧`:s.completed?(s.cleared?'已通关：所有可操作角色均已通过':'脚本结束：尚未通关'):'尚未载入脚本';
    const actors=s.state.coop?s.state.players:[s.state];
    $('players').textContent=`章节 ${s.state.catalogChapter} / 小节 ${s.state.section} / 地图 ${s.state.level}\n`+actors.map((p,i)=>`P${i+1}  (${p.x.toFixed(2)}, ${p.y.toFixed(2)})  ${['朝上','朝右','朝下','朝左'][p.direction]}${p.exited?' · 已进入出口':''}`).join('\n');
  }
  function pause(){playing=false;accumulator=0;draw();}
  function load(text,options){player.load(text,options);generation++;busy=false;playing=false;accumulator=0;notice(`已载入${player.script.map?'自定义地图':`第${player.script.chapter===3?'三':player.script.chapter===1?'一':'二'}章 Level ${player.script.level}`} · ${player.script.actions.length} 段操作`);draw();return player.status();}
  async function seek(frame){if(!player.script||!Number.isInteger(frame)||frame<0||frame>player.script.totalFrames)throw Error('无效的目标帧');pause();const ticket=++generation;busy=true;
    if(frame<player.frame)player.reset();draw();
    while(player.frame<frame&&!player.status().completed){if(ticket!==generation)return;player.step(Math.min(500,frame-player.frame));draw();await new Promise(requestAnimationFrame);}
    if(ticket===generation){busy=false;draw();}return player.status();
  }
  function play(){if(playing||!player.script||busy||player.status().completed)return;playing=true;last=null;accumulator=0;draw();}
  try{core=await createPor2();player=new Por2Replay.Player(core);$('file').disabled=false;notice('打开第一章或第二章回放；可暂停、逐帧和拖动进度。');draw();
    window.por2ScriptViewer=Object.freeze({ready:true,load:(text,options)=>{loadGeneration++;return load(text,options);},play,pause,step:(n=1)=>{generation++;busy=false;pause();const s=player.step(n);draw();return s;},seek,state:()=>({...player.status(),playing,busy})});
  }catch(e){notice(`加载失败：${e.message}`);return;}
  $('file').onchange=async()=>{const file=$('file').files[0];if(!file)return;const ticket=++loadGeneration;pause();try{if(file.size>Por2Script.MAX_BYTES)throw Error('脚本不能超过 8 MB');const text=await file.text();if(ticket===loadGeneration)load(text);}catch(e){notice(e.message);}finally{$('file').value='';}};
  $('play').onclick=()=>playing?pause():play();$('step').onclick=()=>window.por2ScriptViewer.step();$('reset').onclick=()=>{generation++;busy=false;pause();player.reset();draw();};
  $('timeline').oninput=()=>seek(Number($('timeline').value)).catch(e=>notice(e.message));$('grid').onchange=draw;
  window.addEventListener('blur',pause);document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
  document.addEventListener('keydown',e=>{if(e.target.matches('input,select,button')||e.repeat)return;if(e.code==='Space'){e.preventDefault();playing?pause():play();}else if(e.code==='Period'){e.preventDefault();window.por2ScriptViewer.step();}});
  function loop(now){
    if(playing&&!busy){
      // Start/resume from an animation timestamp, not the later button-event clock.
      // A stale callback must never turn into a negative step count and kill the loop.
      const elapsed=last===null?0:Math.max(0,Math.min(100,now-last));
      accumulator+=elapsed*Number($('speed').value);
      const count=Math.floor(accumulator/25);
      if(count>0){accumulator-=count*25;player.step(count);if(player.status().completed)playing=false;draw();}
    }
    last=now;requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
