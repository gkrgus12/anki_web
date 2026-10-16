const test=require('node:test'),assert=require('node:assert/strict'),M=require('./sien-sm2');
const now=new Date('2026-10-16T12:00:00Z'),later=s=>new Date(+now+s*1000),state=r=>({fsrs:r.fsrs,sm2:r.sm2});
test('new card: Again 1m, Hard 5m30s, Good 10m, Easy 4d',()=>{
 const r=[1,2,3,4].map(g=>M.next({},g,now));assert.deepEqual(r.map(x=>x.seconds),[60,330,600,0]);assert.equal(r[3].days,4);assert.equal(r[2].sm2.step,1);
});
test('same-day steps progress, repeat, reset and graduate without losing reps',()=>{
 const first=state(M.next({},3,now));const good=M.next(first,3,later(600));assert.equal(good.days,1);assert.equal(good.fsrs.state,2);assert.equal(good.fsrs.reps,2);
 assert.equal(M.next(first,2,later(600)).seconds,600);const again=state(M.next(first,1,later(600)));assert.equal(again.sm2.step,0);assert.equal(M.next(again,3,later(660)).seconds,600);
});
const review={fsrs:{state:2,scheduled_days:10,reps:20,lapses:1,last_review:'2026-10-06T12:00:00Z',due:'2026-10-16T00:00:00Z'},sm2:{v:1,ease:2.5,interval:10,step:0}};
test('SM-2 review intervals and ease use the original Anki defaults',()=>{
 const r=[1,2,3,4].map(g=>M.next(review,g,now,'test',{},false));assert.deepEqual(r.map(x=>x.days),[0,12,25,33]);assert.deepEqual(r.map(x=>x.sm2.ease),[2.3,2.35,2.5,2.65]);assert.equal(r[0].seconds,600);assert.equal(r[0].fsrs.lapses,2);
});
test('overdue and early reviews follow separate interval rules',()=>{
 const late={...review,fsrs:{...review.fsrs,last_review:'2026-10-02T12:00:00Z'}};
 assert.deepEqual([2,3,4].map(g=>M.next(late,g,now,'',{},false).days),[12,30,46]);
 const early={...review,fsrs:{...review.fsrs,last_review:'2026-10-15T12:00:00Z'}};
 assert.deepEqual([2,3,4].map(g=>M.next(early,g,now,'',{},false).days),[6,10,12]);
});
test('relearning failure does not repeatedly reduce ease or count lapses',()=>{
 const r=state(M.next(review,1,now)),again=M.next(r,1,later(600));assert.equal(again.seconds,600);assert.equal(again.sm2.ease,2.3);assert.equal(again.fsrs.lapses,2);
 assert.equal(M.next(r,2,later(600)).seconds,900);assert.equal(M.next(r,3,later(600)).days,1);assert.equal(M.next(r,4,later(600)).days,2);
});
test('existing ease is imported from Anki and then persisted independently of FSRS difficulty',()=>{
 const old={fsrs:{...review.fsrs,difficulty:1}},snapshot=JSON.stringify(old);
 const next=M.next(old,3,now,'',{ease:1.85},false);assert.equal(next.sm2.ease,1.85);assert.equal(next.days,19);assert.equal(JSON.stringify(old),snapshot);
 assert.equal(M.next(state(next),2,new Date('2026-11-04T12:00:00Z'),'',{ease:2.5},false).sm2.ease,1.7);
});
test('fuzz is stable between preview and answer and respects Anki ranges and cap',()=>{
 assert.deepEqual([0,.5,.99].map(f=>M.interval(7,1,f)),[5,7,9]);
 assert.deepEqual([0,.5,.99].map(f=>M.interval(37,1,f)),[33,37,41]);
 for(let i=0;i<100;i++){const r=[2,3,4].map(g=>M.next(review,g,now,'card'+i));assert.ok(r[0].days>=11&&r[1].days>r[0].days&&r[2].days>r[1].days);assert.deepEqual(M.next(review,3,now,'card'+i),r[1]);}
 assert.equal(M.interval(999999,999999,.99),36500);
});
test('short-term due uses seconds, long-term due uses the 4am day boundary',()=>{
 const a=state(M.next({},1,now));assert.equal(M.due(a,later(59)),false);assert.equal(M.due(a,later(60)),true);
 const d=state(M.next({},4,now));assert.equal(M.due(d,new Date(d.fsrs.due).getTime()-1),false);assert.equal(M.due(d,Date.parse(d.fsrs.due)),true);
 assert.equal(M.learning(a),true);assert.equal(M.learning(d),false);assert.equal(M.label(M.next({},2,now)),'5분 30초 후');
});
