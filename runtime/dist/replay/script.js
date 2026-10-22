'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.Por2Script=factory();})(globalThis,()=>{
  const MAX_BYTES=8*1024*1024,MAX_FRAMES=1000000,MAX_ACTIONS=50000;
  // Keep in sync with por2::ReplayRulesVersion; bump for simulation rule changes.
  const RULES_VERSION=1;
  function parse(text) {
    if(typeof text!=='string'||text.length>MAX_BYTES||new TextEncoder().encode(text).length>MAX_BYTES)throw Error('脚本不能超过 8 MB');
    if(text.includes('\0'))throw Error('脚本不能包含空字符');
    let version=0,rulesVersion=0,chapter=null,section=null,level=null,map=null,state=null,totalFrames=0;const actions=[];
    const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/);
    for(let i=0;i<lines.length;i++){
      const raw=lines[i].trim();
      if(/^state\s/.test(raw)){
        if(version!==3||chapter===null||section===null||(level===null&&map===null)||state!==null||actions.length)throw Error(`第 ${i+1} 行：状态头位置无效`);
        state=raw.slice(6).trim();if(state.length>65536||!state.startsWith('por2-state-1 1 '))throw Error('无效的状态快照');continue;
      }
      if(/^map\s/.test(raw)){
        if(version!==3||chapter!==0||section!==0||level!==null||map!==null||actions.length)throw Error(`第 ${i+1} 行：地图头位置无效`);
        const json=raw.slice(4).trim();if(new TextEncoder().encode(json).length>1024*1024)throw Error('地图不能超过 1 MB');
        const value=JSON.parse(json);if(!value||typeof value!=='object'||Array.isArray(value)||value.playerCount!==2)throw Error('双角色回放需要双角色地图');map=json;continue;
      }
      const source=raw.split('#')[0].trim();if(!source)continue;
      const tokens=source.split(/\s+/),op=tokens.shift();
      const fail=()=>{throw Error(`第 ${i+1} 行：命令或参数无效`);};
      const integer=(v,max)=>{if(!/^\d+$/.test(v??''))return fail();const n=Number(v);if(!Number.isSafeInteger(n)||n>max)return fail();return n;};
      if(op==='rules'){
        if(rulesVersion||actions.length||tokens.length!==1)fail();
        rulesVersion=integer(tokens[0],2147483647);if(!rulesVersion)fail();
        if(rulesVersion!==RULES_VERSION)throw Error('Replay rules version mismatch / 录像规则版本不匹配，请使用录制时的游戏版本。');
        continue;
      }
      if(op==='por2-script'){if(version||chapter!==null||level!==null||actions.length||tokens.length!==1||tokens[0]!=='3')fail();version=Number(tokens[0]);continue;}
      if(op==='chapter'){if(!version||chapter!==null||level!==null||actions.length||tokens.length!==1)fail();chapter=integer(tokens[0],999999);continue;}
      if(op==='section'){if(chapter===null||section!==null||level!==null||map!==null||actions.length||tokens.length!==1)fail();section=integer(tokens[0],999999);continue;}
      if(op==='level'){if(!chapter||section===null||level!==null||map!==null||actions.length||tokens.length!==1)fail();level=integer(tokens[0],999999);continue;}
      if(version!==3||!rulesVersion||chapter===null||section===null||(level===null&&map===null))fail();
      let frames=1;const flags=[0,0],shots=[];
      const shot=(p,c,x,y)=>{
        const player=integer(p,1),portal=integer(c,1);
        if(![x,y].every(v=>typeof v==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v)))fail();
        x=Number(x);y=Number(y);if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>=1000||y<0||y>=600)fail();
        shots.push(Object.freeze({player,portal,x,y}));
      };
      if(op==='f'){
        if(tokens.length<4)fail();frames=integer(tokens[0],MAX_FRAMES);flags[0]=integer(tokens[1],511);flags[1]=integer(tokens[2],511);
        const count=integer(tokens[3],32);if(tokens.length!==4+count*4)fail();
        for(let j=0;j<count;j++)shot(...tokens.slice(4+j*4,8+j*4));
        if([0,1].some(p=>shots.filter(s=>s.player===p).length>16))fail();
      }else{
        const player=integer(op,1),command=tokens.shift();
        if(command==='s'){if(tokens.length!==3)fail();shot(op,...tokens);}
        else {
          if(!['a','d','w','aw','dw','z','e','r','c'].includes(command)||tokens.length!==1||(command==='c'&&version!==3))fail();
          frames=integer(tokens[0],MAX_FRAMES);
          flags[player]=(command.includes('a')?1:0)|(command.includes('d')?2:0)|(command.includes('w')?4:0)|(command==='e'?16:0)|(command==='r'?8:0)|(command==='c'?64:0);
        }
      }
      if(frames<1||totalFrames+frames>MAX_FRAMES||actions.length>=MAX_ACTIONS)fail();
      actions.push(Object.freeze({frames,flags:Object.freeze(flags),shots:Object.freeze(shots),start:totalFrames,line:i+1,text:source}));totalFrames+=frames;
    }
    if(!actions.length)throw Error('脚本没有操作');
    return Object.freeze({version,rulesVersion,chapter,section,level,map,state,totalFrames,actions:Object.freeze(actions)});
  }
  // Store only authoritative executed frames; identical adjacent inputs share a row.
  class Recorder {
    constructor({level,chapter=2,section=0,map=null,state=null}){
      const header=`por2-script 3\nrules ${RULES_VERSION}\nchapter ${map?0:chapter}\nsection ${map?0:section}\n${map?`map ${JSON.stringify(JSON.parse(map))}`:`level ${level}`}\n${state?`state ${state}\n`:''}`;
      parse(header+'f 1 0 0 0');this.header=header;this.rows=[];this.frames=0;this.bytes=new TextEncoder().encode(header).length;this.active=true;this.reason='';
    }
    capture(flags,shots=[]){
      if(!this.active)return false;
      if(!Array.isArray(flags)||flags.length!==2||flags.some(f=>!Number.isInteger(f)||f<0||f>511)||!Array.isArray(shots)||shots.length>32)throw Error('无效的双人帧');
      const counts=[0,0];for(const s of shots){if(!s||![0,1].includes(s.player)||![0,1].includes(s.portal)||!Number.isFinite(s.x)||!Number.isFinite(s.y)||s.x<0||s.x>=1000||s.y<0||s.y>=600||++counts[s.player]>16)throw Error('无效的射门');}
      const text=[...flags,shots.length,...shots.flatMap(s=>[s.player,s.portal,s.x,s.y])].join(' '),last=this.rows[this.rows.length-1],same=last?.text===text;
      if(this.frames>=MAX_FRAMES||(!same&&(this.rows.length>=MAX_ACTIONS||this.bytes+text.length+11>MAX_BYTES))){this.active=false;this.reason='达到录制容量上限';return false;}
      if(same)last.frames++;else{this.rows.push({frames:1,text});this.bytes+=text.length+11;}this.frames++;return true;
    }
    text(){return this.frames?this.header+this.rows.map(r=>`f ${r.frames} ${r.text}\n`).join(''):'';}
  }
  function start(core,script){
    let ok, statePtr=0;
    if(!script.map){
      const catalog=JSON.parse(core.UTF8ToString(core._web_catalog_json()));
      if(!catalog.maps.some(m=>m.chapter===script.chapter&&m.section===script.section&&m.id===script.level&&m.players===2))throw Error('双角色目录地图不存在');
    }
    if(script.state){const bytes=new TextEncoder().encode(script.state);statePtr=core._malloc(bytes.length+1);if(!statePtr)throw Error('内存不足');core.HEAPU8.set(bytes,statePtr);core.HEAPU8[statePtr+bytes.length]=0;}
    try {
    if(script.map){const bytes=new TextEncoder().encode(script.map),ptr=core._malloc(bytes.length+1);if(!ptr)throw Error('内存不足');
      try{core.HEAPU8.set(bytes,ptr);core.HEAPU8[ptr+bytes.length]=0;ok=core._web_load_map(ptr,0,statePtr);}finally{core._free(ptr);}
    }else ok=core._web_load_catalog(script.chapter,script.section,script.level,0,statePtr);
    } finally {if(statePtr)core._free(statePtr);}
    if(!ok)throw Error(core.UTF8ToString(core._web_error()));
  }
  class Player {
    constructor(core){this.core=core;this.script=null;this.frame=0;this.action=0;this.within=0;}
    load(text,options){const script=parse(text,options);start(this.core,script);this.script=script;this.frame=this.action=this.within=0;return this.status();}
    reset(){if(!this.script)return this.status();start(this.core,this.script);this.frame=this.action=this.within=0;return this.status();}
    step(count=1){if(!Number.isInteger(count)||count<0||count>MAX_FRAMES)throw Error('无效的帧数');
      while(count--&&this.script&&this.frame<this.script.totalFrames){const a=this.script.actions[this.action];for(const s of a.shots)this.core._web_coop_shot(s.player,s.portal,s.x,s.y);this.core._web_coop_tick(...a.flags);this.frame++;if(++this.within===a.frames){this.action++;this.within=0;}}
      return this.status();
    }
    status(){return {frame:this.frame,totalFrames:this.script?.totalFrames??0,completed:!!this.script&&this.frame===this.script.totalFrames,action:this.script?.actions[this.action]??null,state:JSON.parse(this.core.UTF8ToString(this.core._web_state()))};}
  }
  return Object.freeze({parse,Player,Recorder,MAX_BYTES,MAX_FRAMES,RULES_VERSION});
});
