'use strict';
// One read-only playback interface; each format retains its authoritative parser.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./script.js'));else root.Por2Replay=factory(root.Por2Script);})(globalThis,Script=>{
  class Player {
    constructor(core){this.core=core;this.delegate=null;this.script=null;this.frame=0;this.within=0;this.cleared=false;}
    read(){return JSON.parse(this.core.UTF8ToString(this.core._web_state()));}
    nativeLoad(text){
      const bytes=new TextEncoder().encode(text),ptr=this.core._malloc(bytes.length+1);
      if(!ptr)throw Error('内存不足');
      try{this.core.HEAPU8.set(bytes,ptr);this.core.HEAPU8[ptr+bytes.length]=0;
        if(!this.core._web_load_replay(ptr))throw Error(this.core.UTF8ToString(this.core._web_error()));
        this.core._web_replay_pause(1);
      }finally{this.core._free(ptr);}
    }
    load(text,options={}){
      if(typeof text!=='string'||new TextEncoder().encode(text).length>Script.MAX_BYTES)throw Error('脚本不能超过 8 MB');
      if(text.includes('\0'))throw Error('脚本不能包含空字符');
      const clean=text.replace(/^\uFEFF/,'').split(/\r?\n/).map(s=>s.split('#')[0].trim()).filter(Boolean);
      const coop=clean.some(s=>/^por2-script\s/.test(s));
      if(coop){const next=new Script.Player(this.core);next.load(text,options);this.delegate=next;this.script={...next.script,chapter:next.script.chapter};}
      else{
        // Require an explicit level/map for solo scripts so replay never inherits the viewer's previous scene.
        if(!clean.some(s=>/^(level|map)\s/.test(s)))throw Error('第一章回放需要 level 或 map 头，请先注明关卡。');
        this.nativeLoad(text);this.delegate=null;const state=this.read();
        const actions=[];let line=0;
        for(const raw of text.replace(/^\uFEFF/,'').split(/\r?\n/)){line++;const row=raw.split('#')[0].trim();if(!row||/^(rules|version|chapter|section|level|map)\s/.test(row))continue;
          const tokens=row.split(/\s+/);actions.push({line,text:row,frames:tokens[0]==='s'?1:Number(tokens[1])});}
        const rules=clean.find(s=>/^rules\s/.test(s));
        this.script={rulesVersion:rules?Number(rules.split(/\s+/)[1]):0,chapter:state.catalogChapter,section:state.section,level:state.level,map:state.catalogChapter===0,totalFrames:state.replayTotal,actions};
      }
      this.text=text;this.options=options;this.frame=this.within=this.action=0;this.cleared=false;this.initialLevel=this.read().level;return this.status();
    }
    reset(){return this.script?this.load(this.text,this.options):this.status();}
    step(count=1){
      if(!Number.isInteger(count)||count<0||count>Script.MAX_FRAMES)throw Error('无效的帧数');
      while(count--&&this.script&&!this.status().completed){
        if(this.delegate)this.delegate.step();else this.core._web_replay_step();
        const s=this.read();this.frame=this.delegate?this.delegate.frame:s.replayFrame;
        if(++this.within===this.script.actions[this.action].frames){this.action++;this.within=0;}
        this.cleared ||= s.level!==this.initialLevel||!!s.finished||!!s.replayCleared;
      }
      return this.status();
    }
    status(){
      const state=this.read(),action=this.script?.actions[this.action]??null;
      const completed=!!this.script&&(this.cleared||this.frame>=this.script.totalFrames||(!this.delegate&&!!state.replayCompleted));
      return {frame:this.frame,totalFrames:this.script?.totalFrames??0,completed,cleared:this.cleared,action:completed?null:action,state};
    }
  }
  return Object.freeze({Player});
});
