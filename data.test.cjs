const test=require('node:test'),assert=require('node:assert/strict'),D=require('./sien-data'),S=require('./sien-study');
const base=()=>({version:1,cards:[],decks:[],state:{cards:{},log:[]}});
const journal=(device,events)=>({schema:1,kind:'journal',deviceId:device,sequence:0,events});
const event=(id,at,learning)=>({id,at,change:{learning}});
const op=(parts,value)=>({key:D.key(...parts),value});
test('session definitions, filters, queue and settings converge regardless of document order',()=>{
 const a=journal('pc',[event('a',10,[op(['session','s','name'],'단어'),op(['session','s','mode'],'manual'),op(['session','s','qOrder'],['a','b']),op(['queue','s','a'],true),op(['queue','s','b'],true)])]);
 const b=journal('phone',[event('b',11,[op(['session','s','how','newMax'],12),op(['setting','ivShow'],{v:true}),op(['queue','s','a'],null)])]);
 const x=S.merge(base(),[a,b]);assert.deepEqual(x,S.merge(base(),[b,a]));assert.deepEqual(D.sessions(x.payload.learning)[0].q,['b']);assert.equal(D.sessions(x.payload.learning)[0].how.newMax,12);
 assert.deepEqual(S.merge(x.payload,[a,b]),x);
});
test('independent session edits and additions survive concurrent changes',()=>{
 const a=event('a',10,[op(['session','s','name'],'이름'),op(['session','one','name'],'하나')]);
 const b=event('b',11,[op(['session','s','how','order'],'doc'),op(['session','two','name'],'둘')]);
 const r=S.merge(base(),[journal('pc',[a]),journal('phone',[b])]);assert.equal(D.sessions(r.payload.learning).length,3);assert.equal(D.sessions(r.payload.learning).find(s=>s.id==='s').name,'이름');
});
test('deleted sessions stay deleted after late old-device migration, explicit undo restores',()=>{
 const events=[event('create',2,[op(['session','s','name'],'세션')]),event('delete',20,[op(['deleted','s'],true)])];
 let r=S.merge(base(),[journal('pc',events)]);r=S.merge(r.payload,[journal('late',[event('old',1,[op(['session','s','name'],'옛이름'),op(['deleted','s'],false)])])]);assert.equal(D.sessions(r.payload.learning).length,0);
 r=S.merge(r.payload,[journal('undo',[event('restore',21,[op(['deleted','s'],false)])])]);assert.equal(D.sessions(r.payload.learning)[0].name,'세션');
});
test('manual queue of 5000 cards sends one removal, not a queue copy after an answer',()=>{
 const sx={id:'s',mode:'manual',name:'5000장',how:{},scope:{},q:Array.from({length:5000},(_,i)=>'card-'+i)},a=D.empty();D.putSession(a,sx,D.empty());
 const b=D.empty();D.putSession(b,{...sx,q:sx.q.slice(1)},a);const changes=D.delta(a,b);
 assert.equal(changes.length,1);assert.equal(changes[0].key,D.key('queue','s','card-0'));assert.ok(JSON.stringify(changes).length<100);
});
test('automatic/deck queues and render counters are derived without metadata churn',()=>{
 const a=D.empty(),b=D.empty(),s={id:'s',mode:'auto',name:'전체 복습',how:{status:['due']},scope:{},q:['a'],done:2,lastAt:10,day:'x'};
 D.putSession(a,s,D.empty());D.putSession(b,{...s,q:['b','c'],done:3,lastAt:20,day:'y'},a);assert.deepEqual(D.delta(a,b),[]);
});
test('reordering manual cards is shared while independent removals still survive',()=>{
 const a=D.empty(),s={id:'s',mode:'manual',q:['a','b','c']};D.putSession(a,s,D.empty());
 const p=D.empty();D.putSession(p,{...s,q:['c','b','a']},a);const q=D.empty();D.putSession(q,{...s,q:['a','c']},a);
 const dp=D.delta(a,p),dq=D.delta(a,q);let x=D.apply(a,dp,{id:'p',at:10});x=D.apply(x,dq,{id:'q',at:11});assert.deepEqual(D.sessions(x)[0].q,['c','a']);
});
test('metadata changes do not rewrite cards, logs or schedules; no-op creates no delta',()=>{
 const b=base(),a=structuredClone(b);a.learning=D.apply(null,[op(['setting','kbdOn'],false)],{id:'a',at:1});
 const d=S.delta(b,a);assert.deepEqual(Object.keys(d),['learning']);assert.equal(S.delta(a,structuredClone(a)),null);assert.deepEqual(S.merge(b,[journal('pc',[event('a',1,d.learning)])]).payload.state,b.state);
});
test('malformed shared data is rejected rather than clearing local learning state',()=>{
 assert.throws(()=>D.validate({}));assert.throws(()=>D.validate([op(['unknown','x'],true)]));assert.throws(()=>S.validPayload({...base(),learning:{v:2}}));
});
