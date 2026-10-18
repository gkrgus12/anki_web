/* Learning state shared through the existing Gist journal, never a second transport. */
(function(){
  'use strict';
  const D=SienData,copy=x=>JSON.parse(JSON.stringify(x));let shared=D.empty(),receiving=false,memo=new WeakMap();
  const DEFAULT='sien-session-all-review-v1';
  function canonicalize(){
    for(const s of sessions){
      if(s.mode!=='auto'||s.name!=='전체 복습'||s.temp||!stOnly(s.how?.status,'due'))continue;
      if(Object.values(s.scope||{}).some(v=>Array.isArray(v)&&v.length)||Object.values(s.scope?.ex||{}).some(v=>v?.length))continue;
      const old=s.id;s.id=DEFAULT;s.createdAt=0;
      if(lastPlaySid===old)lastPlaySid=DEFAULT;
    }
    sessions=sessions.filter((s,i,a)=>a.findIndex(x=>x.id===s.id)===i);
  }
  function snapshot(){
    canonicalize();const out=D.empty(),set=(parts,value)=>{out.values[D.key(...parts)]=copy(value);};out.stamps=copy(shared.stamps);
    set(['initialized','learning'],true);
    for(const s of sessions){
      D.putSession(out,s,shared);
      set(['session',s.id,'legacyDone'],D.get(shared,'session',s.id,'legacyDone')??(s.done||0));
      if(s.temp)set(['session',s.id,'expiresDay'],s.expiresDay||s.day||todayKey());
      set(['deleted',s.id],false);
    }
    for(const t of sessTomb)if(!sessions.some(s=>s.id===t.id))set(['deleted',t.id],true);
    for(const [k,v]of Object.entries(shared.values))if(JSON.parse(k)[0]==='deleted'&&!Object.hasOwn(out.values,k))out.values[k]=v;
    for(const [name,value]of Object.entries({intake,rest,ivShow,reshow,fsrsCfg,kbdOn,zoneTapOn,keyboard:SienKeys.settings()}))set(['setting',name],value);
    for(const name of ['hoedok','read','fc'])for(const [k,v]of Object.entries(state[name]||{}))set(['record',name,k],v);
    // Only real navigation/answers update resume; redraws and idle timers do not.
    const previous=D.get(shared,'resume','last');
    const resume=curSess&&$('scrSolve')?.classList.contains('on')?{sid:curSess.id,card:cur()?.id||null,day:todayKey()}:previous;
    if(resume)set(['resume','last'],resume);
    return out;
  }
  function receive(data){
    shared=copy(D.valid(data||D.empty()));receiving=true;
    try{
      if(!D.get(shared,'initialized','learning'))return;
      const oldCur=curSess?.id,oldView=viewSess?.id;
      const prior=new Map(sessions.map(s=>[s.id,s]));
      sessions=D.sessions(shared).map(s=>{
        const old=prior.get(s.id);return Object.assign(old||{},s,{day:s.expiresDay||todayKey(),lastAt:0,done:s.legacyDone||0});
      });
      sessTomb=Object.entries(shared.values).filter(([k,v])=>JSON.parse(k)[0]==='deleted'&&v===true).map(([k])=>({id:JSON.parse(k)[1],del:1}));
      normalizeSessions();
      for(const name of ['hoedok','read','fc']){
        state[name]={};for(const [k,v]of Object.entries(shared.values)){const p=JSON.parse(k);if(p[0]==='record'&&p[1]===name&&v!==null)state[name][p[2]]=copy(v);}
      }
      const setting=name=>D.get(shared,'setting',name);
      if(setting('intake'))intake=copy(setting('intake'));
      if(setting('rest')){rest=copy(setting('rest'));restReset();}
      if(setting('ivShow')){ivShow=copy(setting('ivShow'));applyIv();}
      if(setting('reshow'))setReshow(setting('reshow').v,setting('reshow').at,true);
      if(setting('fsrsCfg'))fsrsCfg=copy(setting('fsrsCfg'));
      if(typeof setting('kbdOn')==='boolean')kbdOn=setting('kbdOn');
      if(typeof setting('zoneTapOn')==='boolean')zoneTapOn=setting('zoneTapOn');
      if(setting('keyboard'))SienKeys.receive(setting('keyboard'));
      const resume=D.get(shared,'resume','last');
      if(resume){lastPlaySid=resume.sid;const s=sessions.find(s=>s.id===resume.sid);if(s)s.lastAt=shared.stamps[D.key('resume','last')]?.[0]||0;}
      curSess=sessions.find(s=>s.id===oldCur)||null;viewSess=sessions.find(s=>s.id===oldView)||null;
      if(curSess)curPreset=asPreset(curSess);
      // Session counters come from the same answer events on every device.
      const byId=new Map(sessions.map(s=>[s.id,s])),seen=new Map();
      for(const e of state.log){const s=byId.get(e[3]?.sessionId);if(!s)continue;s.done++;
        if(dayKey(logDate(e))===todayKey()){if(!seen.has(s.id))seen.set(s.id,new Set());seen.get(s.id).add(e[0]);}}
      for(const s of sessions)s.pg={day:todayKey(),n:seen.get(s.id)?.size||0};
      for(const s of sessions)if(s.sienDeckId){s.q=(s.sienOrder||[]).slice();refreshDeckResume(s);}else if(!isFixed(s))refillSess(s);
      lsSet(K_SESS,JSON.stringify(sessFile()));lsSet(K_INTAKE,JSON.stringify(intake));lsSet(K_REST,JSON.stringify(rest));
      lsSet(K_IVSHOW,JSON.stringify(ivShow));lsSet(K_KBD,kbdOn?'1':'0');lsSet(K_ZTAP,zoneTapOn?'1':'0');
    }finally{receiving=false;}
  }
  function initialize(){
    canonicalize();
    if(!sessions.length&&!sessTomb.some(t=>t.id===DEFAULT)){
      const s=newSessObj('전체 복습',HOW_TPL[0].how,{},'auto');s.id=DEFAULT;s.createdAt=0;sessions.push(s);
    }
    return snapshot();
  }
  // Automatic sessions are a view of shared schedules/conditions, not a saved
  // browser-local empty queue. Manual selections retain their shared membership.
  function plan(s){
    const deck=s?.sienDeckId&&DECKS.find(d=>d.id===s.sienDeckId);if(deck)return deckDailyPlan(deck).cards;
    if(isFixed(s))return newCap(s,gateIn(sessCards(s),null,s.pick));
    if(isRestDay(todayKey()))return [];
    const signature=JSON.stringify([s.how,s.scope,s.qDel,Math.floor(Date.now()/1000),state.log.length]),cached=memo.get(s);
    if(cached?.data===DATA&&cached.states===state.cards&&cached.signature===signature)return cached.cards;
    const p=asPreset(s),pool=buildQueue(p,s.how.status).filter(c=>!delTodayOf(s,c.id)),cards=newCap(s,pool);
    memo.set(s,{data:DATA,states:state.cards,signature,cards});return cards;
  }
  sessRemain=function(s){return plan(s).length;};
  const oldRefill=refillSess;refillSess=function(s){if(isFixed(s))return oldRefill(s);s.q=plan(s).map(c=>c.id);s.day=todayKey();};
  const oldPlay=playSess;playSess=function(s){if(!isFixed(s))refillSess(s);const r=oldPlay(s);window.SienApp?.capture();return r;};
  const oldPushLog=pushLog;pushLog=function(e){e[3]||={};e[3].sessionId=curSess?.id||lastPlaySid||null;return oldPushLog(e);};
  const oldSave=saveSessions;saveSessions=function(){if(receiving)return;oldSave();};
  const oldLsSet=lsSet;lsSet=function(k,v){const r=oldLsSet(k,v);if(!receiving&&[K_KBD,K_ZTAP].includes(k))queueMicrotask(()=>window.SienApp?.capture());return r;};
  const oldDirty=setDirty;setDirty=function(v){if(v)memo=new WeakMap();return oldDirty(v);};
  window.SienSessions={snapshot,receive,initialize,plan,commit(value,ops,e){shared=D.apply(copy(value),ops,e);return shared;},get shared(){return shared;}};
})();
