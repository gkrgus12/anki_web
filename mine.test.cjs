const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const M=require('./sien-mine'),Day=require('./sien-day');

test('limit inputs: empty keeps, negative is 0, fractions floor, oversized caps',()=>{
 assert.equal(M.clampLimit('',40,M.MAX.newLimit),40);assert.equal(M.clampLimit(null,40,M.MAX.newLimit),40);assert.equal(M.clampLimit('abc',40,M.MAX.newLimit),40);
 assert.equal(M.clampLimit(-5,40,M.MAX.newLimit),0);assert.equal(M.clampLimit('0',40,M.MAX.newLimit),0);assert.equal(M.clampLimit('12.9',40,M.MAX.newLimit),12);
 assert.equal(M.clampLimit(1e9,40,M.MAX.newLimit),9999);assert.equal(M.clampLimit('123456',400,M.MAX.reviewLimit),99999);
});
test('today-only boost adds to the base, is capped, and an empty boost is nothing',()=>{
 const base={newLimit:40,reviewLimit:400,isCustom:true};
 assert.deepEqual(M.effective(base,null),{...base,boost:null});
 const b=M.normalizeBoost({day:'2026-10-19',new:50,review:0},'2026-10-19');
 assert.deepEqual(b,{day:'2026-10-19',new:50,review:0});
 assert.deepEqual(M.effective(base,b),{...base,newLimit:90,reviewLimit:400,boost:{new:50,review:0}});
 assert.equal(M.effective({newLimit:9990,reviewLimit:1},{new:50,review:99999}).newLimit,9999);
 assert.equal(M.normalizeBoost({day:'2026-10-19',new:0,review:0},'2026-10-19'),null);
 assert.equal(M.normalizeBoost({day:'2026-10-19',new:-3,review:'x'},'2026-10-19'),null);
 assert.equal(M.normalizeBoost(null,'2026-10-19'),null);assert.equal(M.normalizeBoost('bad','2026-10-19'),null);
});
test('a boost saved before 04:00 Seoul applies until 03:59 and is gone at 04:00',()=>{
 const saved={day:Day.key('2026-10-18T18:30:00Z'),new:20,review:100};
 assert.equal(saved.day,'2026-10-18'); // study day 10-18 runs 04:00 KST 10-18 to 03:59 KST 10-19
 assert.ok(M.normalizeBoost(saved,Day.key('2026-10-18T18:59:59Z')));
 assert.equal(M.normalizeBoost(saved,Day.key('2026-10-18T19:00:00Z')),null);
 assert.equal(M.normalizeBoost(saved,Day.key('2026-10-19T10:00:00Z')),null);
});
test('summary line names the source and today boost',()=>{
 const d={name:'언어::불어'},defaults={newLimit:40,reviewLimit:400};
 assert.equal(M.summary({newLimit:150,reviewLimit:9999,isCustom:true,boost:{new:50,review:0}},d,defaults),"신규 150 · 복습 9999 — 덱 '불어' 설정, 오늘 신규 +50");
 assert.equal(M.summary({newLimit:40,reviewLimit:400,isDefault:true,boost:null},d,defaults),'신규 40 · 복습 400 — 기본값 40/400');
 assert.equal(M.summary({newLimit:60,reviewLimit:500,isInherited:true,inheritedFrom:'언어',boost:{new:20,review:100}},d,defaults),"신규 60 · 복습 500 — 상위 '언어' 설정 상속, 오늘 신규 +20 · 복습 +100");
});

// The real upstream deckDailyPlan/getDeckOptions from index.html run against stub data,
// so a change in their shape upstream shows up here.
function upstream(){
 const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
 const fn=name=>{const i=html.indexOf('\nfunction '+name+'(');assert.ok(i>0,name+' missing in index.html');return html.slice(i+1,html.indexOf('\n}\n',i)+2);};
 const c=html.indexOf('const DEFAULT_DECK_OPTS');const consts=html.slice(c,html.indexOf('};',c)+2);
 const ctx={console,Number,Math,Set,Array,Object,Date,JSON,SienDay:Day,
  SienSM2:{learning:()=>false,dayNumber:()=>0},retired:()=>false,offed:()=>false,buried:()=>false,
  isDue:c=>!!ctx.state.cards[c.id]?.due,isNew:c=>!ctx.state.cards[c.id],todayRatings:()=>({}),todayKey:()=>Day.key(Date.now()),
  state:{cards:{},log:[]},DATA:[],DECKS:[]};
 vm.createContext(ctx);
 vm.runInContext([consts,fn('getDeckCards'),fn('getDeckOptions'),fn('getTodayStudiedCounts'),fn('deckDailyPlan')].join('\n'),ctx);
 return ctx;
}
test('boost applies only to the deck being planned; parent and child limits stay separate',()=>{
 const ctx=upstream(),boosts=new Map();
 const w=M.wrapPlanning({plan:ctx.deckDailyPlan,options:ctx.getDeckOptions,boost:id=>M.normalizeBoost(boosts.get(id),'D')});
 ctx.deckDailyPlan=w.deckDailyPlan;ctx.getDeckOptions=w.getDeckOptions;
 ctx.DECKS=[{id:'p',name:'불어',opts:{newLimit:2,reviewLimit:100,retention:.9}},{id:'c',name:'불어::동사'}];
 ctx.DATA=[...Array.from({length:5},(_,i)=>({id:'pc'+i,deckId:'p',subj:'불어'})),...Array.from({length:5},(_,i)=>({id:'cc'+i,deckId:'c',subj:'불어::동사'}))];
 const p=()=>ctx.deckDailyPlan(ctx.DECKS[0]).stats,c=()=>ctx.deckDailyPlan(ctx.DECKS[1]).stats;
 assert.equal(p().new,2);assert.equal(c().new,2);assert.equal(c().opts.isInherited,true);
 boosts.set('p',{day:'D',new:2,review:0});
 assert.equal(p().new,4);assert.equal(p().opts.boost.new,2);assert.equal(c().new,2,'parent boost must not leak into the child row');
 boosts.set('c',{day:'D',new:3,review:0});
 assert.equal(c().new,5);assert.equal(c().opts.newLimit,5);assert.equal(p().new,4,'child boost must not leak into the parent plan');
 assert.equal(ctx.getDeckOptions(ctx.DECKS[0]).newLimit,2,'outside planning the stored base is returned');
 assert.equal(ctx.getDeckOptions(ctx.DECKS[1]).boost,undefined);
 boosts.set('p',{day:'YESTERDAY',new:2,review:0});assert.equal(p().new,2,'an old boost expires');
 assert.equal(ctx.deckDailyPlan(ctx.DECKS[0],false).stats.total,5,'includeChildren is forwarded');
});
test('today boost counts against cards already studied, like the base limit',()=>{
 const ctx=upstream(),boosts=new Map([['p',{day:Day.key(Date.now()),new:1,review:0}]]);
 const w=M.wrapPlanning({plan:ctx.deckDailyPlan,options:ctx.getDeckOptions,boost:id=>M.normalizeBoost(boosts.get(id),Day.key(Date.now()))});
 ctx.deckDailyPlan=w.deckDailyPlan;ctx.getDeckOptions=w.getDeckOptions;
 ctx.DECKS=[{id:'p',name:'불어',opts:{newLimit:1,reviewLimit:100,retention:.9}}];
 ctx.DATA=Array.from({length:4},(_,i)=>({id:'n'+i,deckId:'p',subj:'불어'}));
 ctx.state.cards.n0={fsrs:{state:2,due:'2099-01-01T00:00:00Z'}};
 ctx.state.log=[['n0',Math.floor(Date.now()/1000),3,{previousPhase:0}]];
 assert.equal(ctx.deckDailyPlan(ctx.DECKS[0]).stats.new,1,'1 base + 1 boost - 1 studied today');
});
test('a deck session re-mixes only when its remaining queue gained cards',()=>{
 assert.equal(M.queueGrew(['a','b','c'],['a','b']),false);
 assert.equal(M.queueGrew(['a','b'],['b','a']),false);
 assert.equal(M.queueGrew(['a','b'],['a','b','n']),true);
 assert.equal(M.queueGrew([],['n']),true);assert.equal(M.queueGrew(undefined,[]),false);
});
test('Anki sound markers are hidden from notes; other text survives',()=>{
 assert.equal(M.stripSound('[sound:fr_0001.mp3]'),'');
 assert.equal(M.stripSound('청크: bonjour [sound:a.mp3] 상황: 인사'),'청크: bonjour 상황: 인사');
 assert.equal(M.stripSound('[SOUND:x.ogg] [sound:y.mp3]'),'');
 assert.equal(M.stripSound('보충 설명'),'보충 설명');assert.equal(M.stripSound(null),'');
});
test('plain cards are French on the front; plugin cards keep their own language',()=>{
 assert.equal(M.frontLang({front:'bonjour'}),'fr');assert.equal(M.frontLang({sien:{v:1}}),null);assert.equal(M.frontLang(null),'fr');
});
test('standalone detection matches upstream: navigator flag or display-mode query',()=>{
 assert.equal(M.standalone({standalone:true},()=>({matches:false})),true);
 assert.equal(M.standalone({},q=>({matches:q==='(display-mode: standalone)'})),true);
 assert.equal(M.standalone({},()=>({matches:false})),false);assert.equal(M.standalone(undefined,undefined),false);
});
test('diagnostic line prints every measurement, marks unknowns, and omits absent extras',()=>{
 assert.equal(M.diag({vw:402,vh:874,sw:402,sh:874,docH:874,saTop:59,saBottom:34,standalone:true,os:'iOS 26.6.1',version:'20261019-34'}),
  '뷰포트 402×874 · 화면 402×874 · 문서 874 · 안전영역 위 59 아래 34 · 홈 화면 앱 · iOS 26.6.1 · v20261019-34');
 assert.equal(M.diag({vw:1280,vh:999.6,sw:1280,sh:1000,docH:1000,saTop:NaN,saBottom:undefined,standalone:false,os:'',version:undefined}),
  '뷰포트 1280×1000 · 화면 1280×1000 · 문서 1000 · 안전영역 위 ? 아래 ? · 브라우저');
});
