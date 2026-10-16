const test=require('node:test'),assert=require('node:assert/strict'),S=require('./sien-study');
const fixture=()=>({version:1,cards:[{id:'a',front:'old',updatedAt:1},{id:'b'}],decks:[{id:'d',name:'words'}],state:{cards:{a:{fsrs:{reps:9,lapses:2,last_review:'2026-10-01T00:00:00Z'}}},log:[['a',1,3]]}});
const j=(id,events)=>({schema:1,kind:'journal',deviceId:id,sequence:0,events}),e=(id,at,change)=>({id,at,change});
test('two devices writing independent files retain both reviews and identical merged view',()=>{
 const a=j('pc',[e('a',10,{logs:[['a',2,3,{sienId:'a'}]],states:{a:{fsrs:{reps:10}}}})]),b=j('phone',[e('b',11,{logs:[['b',2,4,{sienId:'b'}]],states:{b:{fsrs:{reps:1}}}})]);
 assert.deepEqual(S.merge(fixture(),[a,b]),S.merge(fixture(),[b,a]));assert.equal(S.merge(fixture(),[a,b]).payload.state.log.length,3);
 const writesA=S.append([],'pc',a.events),writesB=S.append([],'phone',b.events);assert.equal(Object.keys({...writesA,...writesB}).length,2);
});
test('same-second same-card answers keep independent event IDs and deterministic current schedule',()=>{
 const docs=[j('a',[e('a',1,{logs:[['a',3,3,{sienId:'1'}]],states:{a:{fsrs:{reps:10}}}})]),j('b',[e('b',2,{logs:[['a',3,3,{sienId:'2'}]],states:{a:{fsrs:{reps:10,last_review:'latest'}}}})])];
 const r=S.merge(fixture(),docs);assert.equal(r.payload.state.log.length,3);assert.equal(r.payload.state.cards.a.fsrs.last_review,'latest');
});
test('delete survives stale device, plugin content update, refresh and repeat merge',()=>{
 const doc=j('phone',[e('delete',10,{deleted:['a']})]),p=fixture();p.cards[0].updatedAt=100;
 const r=S.merge(p,[doc]);assert.deepEqual(r.payload.cards.map(c=>c.id),['b']);assert.equal(r.payload.state.log.length,1);assert.equal(r.payload.state.cards.a.fsrs.reps,9);assert.deepEqual(S.merge(r.payload,[doc]),r);
});
test('undo removes only the named review while keeping simultaneous review on another device',()=>{
 const one=['a',2,3,{sienId:'1'}],two=['a',2,3,{sienId:'2'}];
 const r=S.merge(fixture(),[j('a',[e('one',10,{logs:[one]}),e('undo',12,{removedLogs:[S.logKey(one)]})]),j('b',[e('two',11,{logs:[two]})])]);
 assert.equal(r.payload.state.log.length,2);assert.deepEqual(r.payload.state.log[1],two);
});
test('uncertain upload retry neither duplicates nor drops events',()=>{
 const events=[e('one',1,{logs:[['a',2,3]]})],first=S.append([],'pc',events),docs=Object.values(first);
 assert.deepEqual(S.append(docs,'pc',events),{});assert.equal(S.merge(fixture(),[...docs,...docs]).payload.state.log.length,2);
 assert.throws(()=>S.append(docs,'pc',[e('one',1,{deleted:['a']})]));
});
test('baseline preserves imported history even if an old shared-file writer drops it',()=>{
 const p=fixture(),base={schema:1,kind:'base',state:structuredClone(p.state)};p.state={cards:{},log:[]};
 assert.deepEqual(S.merge(p,[base]).payload.state,fixture().state);
});
test('unchanged card UI properties do not create content journals',()=>{
 const p=fixture(),after=structuredClone(p);after.cards[0]._i=9;after.cards[0].q='old';assert.equal(S.delta(p,after),null);
});
test('local delete and review undo have explicit durable operations',()=>{
 const p=fixture(),after=structuredClone(p);after.cards.shift();after.state.log=[];
 const d=S.delta(p,after);assert.deepEqual(d.deleted,['a']);assert.deepEqual(d.removedLogs,[S.logKey(p.state.log[0])]);
});
test('malformed data stops instead of overwriting records',()=>{
 assert.throws(()=>S.merge({...fixture(),state:{}},[]));assert.throws(()=>S.merge(fixture(),[{schema:1,kind:'journal',deviceId:'pc',sequence:0,events:[{}]}]));
});
test('journal rollover leaves older segments immutable',()=>{
 const event=e('one',1,{cards:[{id:'big',front:'a'.repeat(260000)}]}),files=S.append([],'pc',[event,e('two',2,{deleted:['a']})]);assert.equal(Object.keys(files).length,2);
 const next=S.append(Object.values(files),'pc',[e('three',3,{deleted:['b']})]);assert.equal(Object.keys(next).length,1);assert.ok(Object.keys(next)[0].endsWith('00001.json'));
});
test('exit delivery is deduplicated and never replaces the normal journal',()=>{
 const first=e('normal',1,{logs:[['a',1,3,{sienId:'normal'}]]}),exit=e('exit',2,{logs:[['b',2,2,{sienId:'exit'}]]});
 const normal={schema:1,kind:'journal',deviceId:'pc',sequence:0,events:[first]};
 const immutable={schema:1,kind:'journal',deviceId:'pc',sequence:-1,immutable:true,events:[exit]};
 const next=e('next',3,{logs:[['a',3,4,{sienId:'next'}]]});
 const files=S.append([normal,immutable],'pc',[exit,next]);
 assert.deepEqual(Object.values(files)[0].events.map(e=>e.id),['normal','next']);
 const merged=S.merge(fixture(),[...Object.values(files),immutable]);
 assert.equal(merged.payload.state.log.filter(e=>e[3]?.sienId==='exit').length,1);
 assert.equal(S.append([immutable],'pc',[next])[S.PREFIX+'pc-00000.json'].sequence,0);
});
test('deleted default and child decks stay deleted across stale snapshots and devices',()=>{
 const before=fixture();before.decks.unshift({id:'deck_default',name:'기본 덱'},{id:'child',name:'기본 덱::하위'});
 const after=structuredClone(before);after.decks=after.decks.filter(d=>d.id==='d');
 const change=S.delta(before,after);assert.deepEqual(change.deletedDecks,['deck_default','child']);
 const deletion=j('pc',[e('remove-decks',10,change)]),stale=j('phone',[e('stale-decks',20,{decks:before.decks})]);
 const merged=S.merge(before,[deletion,stale]);assert.deepEqual(merged.payload.decks,after.decks);
 assert.deepEqual(merged.payload.state,before.state);assert.deepEqual(merged.payload.cards,before.cards);
 assert.deepEqual(S.merge(merged.payload,[stale,deletion]),merged);
 // Old plugin clients may retain a deck in the shared collection; the web tombstone still wins.
 assert.deepEqual(S.merge({...merged.payload,decks:before.decks},[deletion]).payload.decks,after.decks);
});
test('last deck can remain deleted and a new deck with the same name has a new identity',()=>{
 const p=fixture(),after=structuredClone(p);after.cards=[];after.decks=[];
 const deletion=j('pc',[e('delete-all',10,S.delta(p,after))]);
 const empty=S.merge(p,[deletion]);assert.deepEqual(empty.payload.decks,[]);assert.deepEqual(empty.payload.cards,[]);assert.deepEqual(empty.payload.state,p.state);
 const fresh=j('phone',[e('create-new',20,{decks:[{id:'new-d',name:'words'}]})]);
 assert.deepEqual(S.merge(p,[deletion,fresh]).payload.decks,[{id:'new-d',name:'words'}]);
 assert.throws(()=>S.merge(p,[j('bad',[e('bad',30,{deletedDecks:'d'})])]));
});
