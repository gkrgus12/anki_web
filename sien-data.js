/* Shared learning metadata. Each field has a logical clock; queues use small membership deltas. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SienData=factory();})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const copy=x=>JSON.parse(JSON.stringify(x));
  const key=(...parts)=>JSON.stringify(parts);
  const empty=()=>({v:1,values:{},stamps:{}});
  function valid(x){
    if(!x||x.v!==1||!x.values||Array.isArray(x.values)||!x.stamps||Array.isArray(x.stamps))throw new Error('공유 학습 설정을 확인할 수 없습니다.');
    return x;
  }
  function validate(ops){
    if(!Array.isArray(ops))throw new Error('공유 학습 변경 기록이 손상되었습니다.');
    for(const o of ops){if(!o||typeof o.key!=='string'||!Object.hasOwn(o,'value'))throw new Error('공유 학습 변경 항목이 손상되었습니다.');
      const p=JSON.parse(o.key);if(!Array.isArray(p)||p.length<2||!p.every(s=>typeof s==='string')||!['session','queue','setting','record','deleted','resume','initialized'].includes(p[0]))throw new Error('지원하지 않는 공유 학습 항목입니다.');
    }
  }
  function delta(a,b){
    a=valid(a||empty());b=valid(b||empty());const ops=[];
    for(const k of new Set([...Object.keys(a.values),...Object.keys(b.values)])){
      const av=a.values[k]??null,bv=b.values[k]??null;
      if(JSON.stringify(av)!==JSON.stringify(bv))ops.push({key:k,value:copy(bv)});
    }return ops;
  }
  function apply(input,ops,event){
    const out=valid(input||empty());validate(ops);
    for(const o of ops){const old=out.stamps[o.key];if(old&&(old[0]>event.at||(old[0]===event.at&&old[1]>=event.id)))continue;
      out.values[o.key]=copy(o.value);out.stamps[o.key]=[event.at,event.id];
    }return out;
  }
  function values(data){return valid(data||empty()).values;}
  function get(data,...parts){return values(data)[key(...parts)];}
  function sessions(data){
    const result=new Map(),queues=new Map();
    for(const [k,v]of Object.entries(values(data))){const p=JSON.parse(k);if(p[0]!=='session'||v===null)continue;
      const s=result.get(p[1])||{id:p[1],how:{},scope:{}};result.set(p[1],s);
      if(p.length===4)(s[p[2]]||={})[p[3]]=copy(v);else s[p[2]]=copy(v);
    }
    for(const [k,v]of Object.entries(values(data))){const p=JSON.parse(k);if(p[0]==='queue'&&v===true){if(!queues.has(p[1]))queues.set(p[1],new Set());queues.get(p[1]).add(p[2]);}}
    return [...result.values()].filter(s=>!get(data,'deleted',s.id)).map(s=>{
      const have=queues.get(s.id)||new Set();s.q=[...(s.qOrder||[]).filter(id=>have.delete(id)),...have];delete s.qOrder;
      return s;
    }).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)||a.id.localeCompare(b.id));
  }
  function putSession(out,s,previous){
    const skip=new Set(['id','q','lastAt','done','pg','day','fillAt','basis','rq','qAt','scAt','exAt','sienMixVersion','sienMixDay']);
    for(const [f,v]of Object.entries(s)){
      if(skip.has(f)||v===undefined)continue;
      if(['how','scope'].includes(f)){for(const [k,x]of Object.entries(v||{}))out.values[key('session',s.id,f,k)]=copy(x);}
      else out.values[key('session',s.id,f)]=copy(v);
    }
    // Queue removals (including each answer) transmit only removed IDs. Preserve
    // the old order array when it is merely a subsequence, avoiding O(queue) writes per answer.
    if(s.mode!=='manual'||s.sienDeckId)return;
    const q=[...new Set(s.q||[])],have=new Set(q),old=get(previous,'session',s.id,'qOrder')||[];
    const projected=old.filter(id=>have.has(id)),known=new Set(projected),existing=q.filter(id=>known.has(id));
    const order=JSON.stringify(projected)===JSON.stringify(existing)?[...old,...q.filter(id=>!old.includes(id))]:[...q,...old.filter(id=>!have.has(id))];
    out.values[key('session',s.id,'qOrder')]=order;
    for(const id of q)out.values[key('queue',s.id,id)]=true;
  }
  return {empty,key,valid,validate,delta,apply,get,values,sessions,putSession};
});
