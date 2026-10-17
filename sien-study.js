(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SienStudy=factory();})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const PREFIX='sien-study-device-',BASE='sien-study-base-';
  const clone=x=>JSON.parse(JSON.stringify(x));
  const logKey=e=>e?.[3]?.sienId?'event:'+e[3].sienId:JSON.stringify(e);
  const stamp=s=>Math.max(Number(s?.u)||0,Date.parse(s?.fsrs?.last_review)||0);
  const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
  function appearance(value){return {theme:['auto','white','paper','dark'].includes(value?.theme)?value.theme:'paper',light:value?.light==='white'?'white':'paper'};}
  function validAppearance(value){if(!object(value)||!['auto','white','paper','dark'].includes(value.theme)||!['white','paper'].includes(value.light))throw new Error('테마 설정 형식이 올바르지 않습니다.');}
  function validPayload(p){if(!p||p.version!==1||!Array.isArray(p.cards)||!Array.isArray(p.decks)||!object(p.state?.cards)||!Array.isArray(p.state.log))throw new Error('학습 데이터 형식을 확인할 수 없어 동기화를 중단했습니다.');return p;}
  function validateDoc(doc){
    if(doc?.schema!==1||!['base','journal'].includes(doc.kind))throw new Error('학습 변경 기록 형식이 올바르지 않습니다.');
    if(doc.kind==='base'){if(!object(doc.state?.cards)||!Array.isArray(doc.state?.log))throw new Error('기존 학습 기록 보호 사본이 손상되었습니다.');return doc;}
    if(!/^[a-z0-9-]{1,100}$/i.test(doc.deviceId||'')||!Number.isInteger(doc.sequence)||!Array.isArray(doc.events))throw new Error('기기 학습 변경 기록이 손상되었습니다.');
    for(const e of doc.events){if(!e||typeof e.id!=='string'||!Number.isFinite(e.at)||!object(e.change))throw new Error('학습 변경 항목이 손상되었습니다.');
      for(const name of ['cards','decks','deleted','deletedDecks','logs','removedLogs'])if(e.change[name]!==undefined&&!Array.isArray(e.change[name]))throw new Error('학습 변경 항목 목록이 손상되었습니다.');
      if(e.change.states!==undefined&&!object(e.change.states))throw new Error('복습 상태 변경 항목이 손상되었습니다.');
      if(e.change.appearance!==undefined)validAppearance(e.change.appearance);
    }return doc;
  }
  function merge(payload,documents=[],blocked=[]){
    const next=clone(validPayload(payload)),logs=new Map(next.state.log.map(e=>[logKey(e),e])),events=new Map();
    const cards=new Map(next.cards.map(c=>[c.id,c])),decks=new Map(next.decks.map(d=>[d.id,d])),deleted=new Set(blocked),deletedDecks=new Set();
    for(const doc of documents){validateDoc(doc);
      if(doc.kind==='base'){
        for(const [id,s]of Object.entries(doc.state.cards)){if(!next.state.cards[id]||stamp(s)>stamp(next.state.cards[id]))next.state.cards[id]=clone(s);}
        for(const e of doc.state.log)logs.set(logKey(e),e);
      }else for(const e of doc.events){if(events.has(e.id)&&JSON.stringify(events.get(e.id))!==JSON.stringify(e))throw new Error('같은 학습 기록 ID의 내용이 다릅니다.');events.set(e.id,e);}
    }
    const removed=new Set();
    for(const e of [...events.values()].sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id))){const c=e.change;
      if(c.appearance!==undefined)next.appearance=appearance(c.appearance);
      for(const id of c.deleted||[])deleted.add(id);
      for(const id of c.deletedDecks||[])deletedDecks.add(id);
      for(const card of c.cards||[])if(card?.id){const old=cards.get(card.id);if(!old||(card.updatedAt||0)>=(old.updatedAt||0))cards.set(card.id,clone(card));}
      for(const deck of c.decks||[])if(deck?.id)decks.set(deck.id,clone(deck));
      for(const [id,s]of Object.entries(c.states||{})){if(s===null)delete next.state.cards[id];else next.state.cards[id]=clone(s);}
      for(const entry of c.logs||[])logs.set(logKey(entry),entry);
      for(const key of c.removedLogs||[])removed.add(key);
    }
    // A deletion is durable; old cards and their review history remain recoverable in GitHub.
    next.cards=[...cards.values()].filter(c=>!deleted.has(c.id));next.decks=[...decks.values()].filter(d=>!deletedDecks.has(d.id));
    next.state.log=[...logs].filter(([k])=>!removed.has(k)).map(([,e])=>e).sort((a,b)=>Number(a[1])-Number(b[1])||logKey(a).localeCompare(logKey(b)));
    return {payload:next,deleted:[...deleted].sort(),clock:[...events.values()].reduce((latest,e)=>Math.max(latest,e.at),0)};
  }
  function cleanCard(c){const out={};for(const [key,value]of Object.entries(c)){if(!key.startsWith('_')&&!['q','a'].includes(key))out[key]=value;}return out;}
  function delta(before,after){
    validPayload(before);validPayload(after);const c={};
    if(JSON.stringify(appearance(before.appearance))!==JSON.stringify(appearance(after.appearance)))c.appearance=appearance(after.appearance);
    for(const [name,key]of [['cards','cards'],['decks','decks']]){
      const old=new Map(before[key].map(x=>[x.id,JSON.stringify(name==='cards'?cleanCard(x):x)]));
      const changed=after[key].map(x=>name==='cards'?cleanCard(x):x).filter(x=>old.get(x.id)!==JSON.stringify(x));if(changed.length)c[name]=changed;
    }
    const present=new Set(after.cards.map(x=>x.id)),deleted=before.cards.filter(x=>!present.has(x.id)).map(x=>x.id);if(deleted.length)c.deleted=deleted;
    const presentDecks=new Set(after.decks.map(x=>x.id)),deletedDecks=before.decks.filter(x=>!presentDecks.has(x.id)).map(x=>x.id);if(deletedDecks.length)c.deletedDecks=deletedDecks;
    const states={};for(const id of new Set([...Object.keys(before.state.cards),...Object.keys(after.state.cards)])){if(JSON.stringify(before.state.cards[id])!==JSON.stringify(after.state.cards[id]))states[id]=after.state.cards[id]??null;}if(Object.keys(states).length)c.states=states;
    const oldLog=new Map(before.state.log.map(x=>[logKey(x),x])),newLog=new Map(after.state.log.map(x=>[logKey(x),x]));
    const added=[...newLog].filter(([k])=>!oldLog.has(k)).map(([,v])=>v),removed=[...oldLog.keys()].filter(k=>!newLog.has(k));
    if(added.length)c.logs=added;if(removed.length)c.removedLogs=removed;return Object.keys(c).length?c:null;
  }
  function append(documents,deviceId,pending){
    const own=documents.filter(d=>d.kind==='journal'&&d.deviceId===deviceId).sort((a,b)=>a.sequence-b.sequence);own.forEach(validateDoc);
    const seen=new Map(own.flatMap(d=>d.events).map(e=>[e.id,JSON.stringify(e)])),missing=[];
    for(const e of pending){if(seen.has(e.id)){if(seen.get(e.id)!==JSON.stringify(e))throw new Error('재전송할 학습 기록의 내용이 달라졌습니다.');}else{seen.set(e.id,JSON.stringify(e));missing.push(e);}}
    const latest=own.filter(d=>!d.immutable).at(-1);
    const files={};let seq=latest?.sequence||0,events=[...(latest?.events||[])],dirty=false;
    const flush=()=>{if(dirty)files[PREFIX+deviceId+'-'+String(seq).padStart(5,'0')+'.json']={schema:1,kind:'journal',deviceId,sequence:seq,events};events=[];seq++;dirty=false;};
    for(const e of missing){if(new TextEncoder().encode(JSON.stringify(e)).length>7000000)throw new Error('한 번의 변경이 너무 큽니다. 작은 묶음으로 나눠 주세요.');if(events.length&&JSON.stringify(events).length+JSON.stringify(e).length>250000)flush();events.push(e);dirty=true;}flush();return files;
  }
  return {PREFIX,BASE,logKey,validPayload,validateDoc,merge,delta,append,cleanCard,appearance};
});
