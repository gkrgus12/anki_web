(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SienDay=factory();})(globalThis,function(){
  'use strict';
  const DAY=86400000,OFFSET=5*3600000; // Asia/Seoul, study day starts at 04:00.
  const millis=value=>typeof value==='number'?value:+new Date(value);
  const number=value=>Math.floor((millis(value)+OFFSET)/DAY);
  const key=value=>new Date(number(value)*DAY).toISOString().slice(0,10);
  const due=(now,days)=>new Date((number(now)+days)*DAY-OFFSET).toISOString();
  const logMs=e=>typeof e[1]==='number'?(e[1]<1e12?e[1]*1000:e[1]):Date.parse(e[1]);
  const empty=()=>({n:0,nw:0,cards:0,ms:0,msN:0,re:0,r:[0,0,0,0,0],review:0,learning:0});
  function stats(log,cardSet){
    const by={},firstSeen=new Set(),seenDays=new Map(),reviewDays=new Map(),learnDays=new Map();
    const ordered=log.every((e,i)=>i===0||logMs(log[i-1])<=logMs(e))?log:[...log].sort((a,b)=>logMs(a)-logMs(b));
    for(const e of ordered){
      if(cardSet&&!cardSet.has(e[0]))continue;
      const ms=logMs(e);if(!Number.isFinite(ms))continue;
      const day=key(ms),d=by[day]||(by[day]=empty()),x=e[3]||{};d.n++;
      if(x.re){d.re++;continue;}
      const seen=seenDays.get(day)||new Set(),reviews=reviewDays.get(day)||new Set(),learn=learnDays.get(day)||new Set();
      seenDays.set(day,seen);reviewDays.set(day,reviews);learnDays.set(day,learn);
      const introduced=x.previousPhase===0||(x.previousPhase===undefined&&x.ankiType===0&&!firstSeen.has(e[0]))||
        (x.previousPhase===undefined&&x.ankiType===undefined&&!firstSeen.has(e[0]));
      if(introduced&&!seen.has(e[0]))d.nw++;
      if(!seen.has(e[0]))d.cards++;seen.add(e[0]);firstSeen.add(e[0]);
      if(x.previousPhase===2||(x.previousPhase===undefined&&(x.ankiType===1||(x.ankiType===undefined&&!introduced))))reviews.add(e[0]);
      else if(!introduced)learn.add(e[0]);
      d.review=reviews.size;d.learning=learn.size;d.r[e[2]]=(d.r[e[2]]||0)+1;
      if(typeof x.ms==='number'){d.ms+=x.ms;d.msN++;}
    }
    return by;
  }
  function counts(log,ids,day=key(Date.now())){const d=stats(log,ids)[day]||empty();return {studiedNew:d.nw,studiedReview:d.review};}
  return {number,key,due,logMs,stats,counts,empty};
});
