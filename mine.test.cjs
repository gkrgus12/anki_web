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
 assert.equal(M.diag({vw:402,vh:874,sw:402,sh:874,docH:874,gap:0,saTop:59,saBottom:34,standalone:true,os:'iOS 26.6.1',version:'20261019-34'}),
  '뷰포트 402×874 · 화면 402×874 · 문서 874 · 간격 0 · 안전영역 위 59 아래 34 · 홈 화면 앱 · iOS 26.6.1 · v20261019-34');
 assert.equal(M.diag({vw:1280,vh:999.6,sw:1280,sh:1000,docH:1000,gap:NaN,saTop:NaN,saBottom:undefined,standalone:false,os:'',version:undefined}),
  '뷰포트 1280×1000 · 화면 1280×1000 · 문서 1000 · 간격 ? · 안전영역 위 ? 아래 ? · 브라우저');
});
test('cloze: a basic blank hides on the front and fills on the back',()=>{
 const t='Je {{c1::suis}} là.';
 assert.deepEqual(M.clozeNumbers(t),[1]);
 assert.deepEqual(M.renderCloze(t,1,'f'),[{s:'Je ',k:'text'},{s:'[...]',k:'blank'},{s:' là.',k:'text'}]);
 assert.deepEqual(M.renderCloze(t,1,'b'),[{s:'Je ',k:'text'},{s:'suis',k:'answer'},{s:' là.',k:'text'}]);
 assert.deepEqual(M.clozeAnswers(t,1),['suis']);assert.equal(M.stripCloze(t),'Je suis là.');
});
test('cloze: a hint shows inside the brackets',()=>{
 assert.deepEqual(M.renderCloze('{{c1::toi::대명사}} aussi',1,'f'),[{s:'[대명사]',k:'blank'},{s:' aussi',k:'text'}]);
 assert.deepEqual(M.renderCloze('{{c1::toi::대명사}} aussi',1,'b'),[{s:'toi',k:'answer'},{s:' aussi',k:'text'}]);
});
test('cloze: c1 and c2 in one note blank only the current number, on both sides',()=>{
 const t='{{c1::Je}} {{c2::te}} vois, {{c1::je}} sais.';
 assert.deepEqual(M.clozeNumbers(t),[1,2]);
 assert.equal(M.renderCloze(t,1,'f').map(s=>s.s).join(''),'[...] te vois, [...] sais.');
 assert.equal(M.renderCloze(t,2,'f').map(s=>s.s).join(''),'Je [...] vois, je sais.');
 assert.deepEqual(M.renderCloze(t,2,'b').filter(s=>s.k!=='text'),[{s:'te',k:'answer'}]);
 assert.deepEqual(M.clozeAnswers(t,1),['Je','je']);
});
test('cloze: special characters inside the blank survive; only the first :: separates the hint',()=>{
 assert.deepEqual(M.renderCloze("{{c1::qu'est-ce que (c'est) ? à::hint::more}}",1,'b'),[{s:"qu'est-ce que (c'est) ? à",k:'answer'}]);
 assert.deepEqual(M.renderCloze("{{c1::qu'est-ce que (c'est) ? à::hint::more}}",1,'f'),[{s:'[hint::more]',k:'blank'}]);
 assert.equal(M.stripCloze('{{c3::Où}} est {{c3::la gare}} ?'),'Où est la gare ?');
});
test('cloze: plain cards pass through untouched',()=>{
 assert.deepEqual(M.clozeNumbers('bonjour {c1::x} {{not::cloze}}'),[]);
 assert.deepEqual(M.renderCloze('bonjour',1,'f'),[{s:'bonjour',k:'text'}]);
 assert.equal(M.stripCloze('bonjour'),'bonjour');assert.equal(M.clozeOrdinal({front:'bonjour'},[]),null);
});
test('cloze: the card number comes from the text, or from the rank among sibling cards in Anki id order',()=>{
 assert.equal(M.clozeOrdinal({id:'anki_5',front:'{{c2::a}}',deckId:'d'},[]),2);
 const front='{{c1::Je}} {{c2::te}} {{c3::vois}}';
 const cards=[{id:'anki_1700000000002',front,deckId:'d'},{id:'anki_1700000000001',front,deckId:'d'},{id:'anki_1700000000003',front,deckId:'d'},{id:'anki_9',front,deckId:'other'},{id:'anki_8',front:'x',deckId:'d'}];
 assert.equal(M.clozeOrdinal(cards[1],cards),1);assert.equal(M.clozeOrdinal(cards[0],cards),2);assert.equal(M.clozeOrdinal(cards[2],cards),3);
 assert.equal(M.clozeOrdinal(cards[3],cards),1,'a lone sibling in another deck is its first number');
 assert.equal(M.clozeOrdinal({id:'anki_1700000000009',front,deckId:'d'},cards),1,'a card missing from the list falls back to its first number');
});
test('bulk selection: Shift range follows result order either way, invert flips, unknown anchors degrade',()=>{
 const ids=['a','b','c','d','e'];
 assert.deepEqual(M.rangeIds(ids,'b','d'),['b','c','d']);assert.deepEqual(M.rangeIds(ids,'d','b'),['b','c','d']);
 assert.deepEqual(M.rangeIds(ids,'c','c'),['c']);assert.deepEqual(M.rangeIds(ids,'zz','d'),['d']);assert.deepEqual(M.rangeIds(ids,'b','zz'),[]);
 assert.deepEqual(M.invertIds(ids,new Set(['a','c'])),['b','d','e']);assert.deepEqual(M.invertIds([],new Set(['a'])),[]);
 assert.deepEqual(M.invertIds(ids,new Set(ids)),[]);
});
test('quick off/restore targets: none, one, hundreds, and a result where some cards are already off',()=>{
 const off=new Set(['c2','c5']),isOff=c=>off.has(c.id);
 assert.deepEqual(M.quickTargets([],'retire',isOff),[]);assert.deepEqual(M.quickTargets([],'restore',isOff),[]);
 assert.deepEqual(M.quickTargets([{id:'c1'}],'retire',isOff).map(c=>c.id),['c1']);assert.deepEqual(M.quickTargets([{id:'c1'}],'restore',isOff),[]);
 const many=Array.from({length:312},(_,i)=>({id:'m'+i}));
 assert.equal(M.quickTargets(many,'retire',isOff).length,312);assert.equal(M.quickTargets(many,'restore',isOff).length,0);
 const mixed=['c1','c2','c3','c4','c5'].map(id=>({id}));
 assert.deepEqual(M.quickTargets(mixed,'retire',isOff).map(c=>c.id),['c1','c3','c4']);
 assert.deepEqual(M.quickTargets(mixed,'restore',isOff).map(c=>c.id),['c2','c5']);
});
