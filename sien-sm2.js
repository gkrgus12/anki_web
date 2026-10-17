(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SienSM2=factory();})(globalThis,function(){
  'use strict';
  // Anki-style SM-2. The fsrs field is retained only as the existing sync wire format.
  const DAY=86400000,MAX=36500,copy=x=>JSON.parse(JSON.stringify(x));
  const StudyDay=typeof module==='object'&&module.exports?require('./sien-day'):globalThis.SienDay||{
    // Cached pre-update HTML does not load sien-day.js yet. Keep its scheduler
    // functional until that page is refreshed, using the same Seoul boundary.
    number:value=>Math.floor((+new Date(value)+5*3600000)/DAY),
    due:(now,days)=>new Date((Math.floor((+new Date(now)+5*3600000)/DAY)+days)*DAY-5*3600000).toISOString()
  };
  function dayNumber(value){return StudyDay.number(value);}
  function dayDue(now,days){return StudyDay.due(now,days);}
  function jitter(key){let h=2166136261;for(const c of key){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return(h>>>0)/4294967296;}
  function interval(value,min=1,factor=null){
    min=Math.min(MAX,Math.max(1,min));value=Math.max(min,Math.min(MAX,value));
    if(factor===null)return Math.min(MAX,Math.max(min,Math.round(value)));
    const delta=value<2.5?0:1+.15*Math.max(0,Math.min(value,7)-2.5)+.1*Math.max(0,Math.min(value,20)-7)+.05*Math.max(0,value-20);
    const lo=Math.max(min,Math.round(value-delta));let hi=Math.min(MAX,Math.round(value+delta));
    if(hi===lo&&hi>2&&hi<MAX)hi++;
    return lo+Math.floor(factor*(hi-lo+1));
  }
  function seed(s,imported={}){
    const f=s?.fsrs;
    // The original migration encoded factor as 11 - factor/300 in the immutable
    // base. Current difficulty may have changed under FSRS and must not be used.
    const base=s?.base?.fsrs,d=base?.difficulty;
    const originalEase=[2,3].includes(base?.state)&&Number.isFinite(d)&&d>1&&d<=11-1300/300?Math.round((11-d)*300)/1000:null;
    const originEase=Math.max(1.3,imported.ease||originalEase||2.5);
    if(s?.sm2?.v===1&&f){
      const m=copy(s.sm2);
      // Upgrade the first SM-2 release's default seed using the saved answer grades.
      // Only ease is recovered; current due dates, counts and history stay untouched.
      if(m.originEase==null&&imported.grades?.length){
        m.ease=originEase;
        for(const e of imported.grades)if(e.phase===2)m.ease=Math.round(Math.max(1.3,m.ease+({1:-.2,2:-.15,3:0,4:.15}[e.grade]||0))*1000)/1000;
        m.originEase=originEase;
      }
      return m;
    }
    return {v:1,ease:originEase,originEase,step:f?.state===1?(imported.step??f.learning_steps??0):0,interval:Math.max(1,f?.scheduled_days||1)};
  }
  function next(s,grade,now,id='',imported={},fuzz=true){
    if(![1,2,3,4].includes(grade))throw new Error('Invalid grade');
    now=new Date(now);if(!Number.isFinite(+now))throw new Error('Invalid review time');
    const old=s?.fsrs||{},phase=old.state||0,m=seed(s,imported);
    let state=phase,days=0,seconds=0,lapses=old.lapses||0;
    const elapsed=old.last_review?Math.max(0,dayNumber(now)-dayNumber(old.last_review)):0;
    const random=fuzz?jitter(id+':'+(old.reps||0)):null;
    if(phase===2){
      const iv=Math.max(1,old.scheduled_days||m.interval),late=elapsed-iv;
      if(grade===1){state=3;m.step=0;m.interval=1;m.ease-=.2;lapses++;seconds=600;}
      else{
        let hard,good,easy;
        if(late<0){hard=interval(Math.max(elapsed*1.2,iv*.6));good=interval(Math.max(elapsed*m.ease,iv));easy=interval(Math.max(elapsed*m.ease,iv)*1.15);}
        else{hard=interval(iv*1.2,iv+1,random);good=interval((iv+late/2)*m.ease,hard+1,random);easy=interval((iv+late)*m.ease*1.3,good+1,random);}
        days=[0,0,hard,good,easy][grade];if(grade===2)m.ease-=.15;if(grade===4)m.ease+=.15;
      }
    }else if(phase===3){
      if(grade<=2){seconds=grade===1?600:900;state=3;m.step=0;}
      else{days=Math.max(1,m.interval)+(grade===4?1:0);state=2;m.step=0;}
    }else{
      state=1;m.step=Math.min(1,Math.max(0,m.step));
      if(grade===1){m.step=0;seconds=60;}
      if(grade===2)seconds=m.step===0?330:600;
      if(grade===3){if(m.step===0){m.step=1;seconds=600;}else{state=2;days=1;m.step=0;}}
      if(grade===4){state=2;days=4;m.step=0;}
    }
    m.ease=Math.round(Math.max(1.3,m.ease)*1000)/1000;
    if(state===2)m.interval=days;
    const due=seconds?new Date(+now+seconds*1000).toISOString():dayDue(now,days);
    const f={...old,due,stability:Math.max(.1,state===2?days:m.interval),difficulty:Math.max(1,Math.min(10,11-m.ease*1000/300)),elapsed_days:elapsed,scheduled_days:state===2?days:state===3?m.interval:0,learning_steps:m.step,reps:(old.reps||0)+1,lapses,state,last_review:now.toISOString()};
    return {fsrs:f,sm2:m,previousPhase:phase,seconds,days};
  }
  function learning(s){return [1,3].includes(s?.fsrs?.state);}
  function due(s,now=Date.now()){const f=s?.fsrs;if(!f||s.retired)return false;return learning(s)?Date.parse(f.due)<=+now:dayNumber(f.due)<=dayNumber(now);}
  function label(result){if(result.seconds){const m=Math.floor(result.seconds/60),s=result.seconds%60;return (m?m+'분':'')+(s?' '+s+'초':'')+' 후';}return result.days<30?result.days+'일 후':result.days<365?(result.days/30.4).toFixed(1)+'개월 후':(result.days/365.25).toFixed(1)+'년 후';}
  return {next,seed,learning,due,label,interval,dayNumber};
});
