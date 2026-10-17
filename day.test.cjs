const test=require('node:test'),assert=require('node:assert/strict'),D=require('./sien-day'),M=require('./sien-sm2');
const entry=(id,time,phase,extra={})=>[id,Date.parse(time)/1000,3,{previousPhase:phase,...extra}];
test('all calendars use the 04:00 Seoul boundary, including month/year rollover',()=>{
 assert.equal(D.key('2026-10-17T18:59:59Z'),'2026-10-17');assert.equal(D.key('2026-10-17T19:00:00Z'),'2026-10-18');
 assert.equal(D.key('2026-12-31T19:00:00Z'),'2027-01-01');assert.equal(D.due('2026-10-17T20:00:00Z',1),'2026-10-18T19:00:00.000Z');
});
test('new introduction, learning repeats, reviews and relearning consume the right quotas',()=>{
 const t='2026-10-18T01:00:00Z',log=[entry('n',t,0),entry('n',t,1),entry('l',t,1),entry('r',t,2),entry('r',t,3),entry('re',t,3)];
 assert.deepEqual(D.counts(log,null,'2026-10-18'),{studiedNew:1,studiedReview:1});
 const s=D.stats(log)['2026-10-18'];assert.equal(s.n,6);assert.equal(s.cards,4);assert.equal(s.nw,1);
});
test('Anki learning carried from yesterday does not use a new slot today',()=>{
 const log=[['n',Date.parse('2026-10-17T01:00Z')/1000,1,{ankiType:0}],['n',Date.parse('2026-10-18T01:00Z')/1000,3,{ankiType:0}],['r',Date.parse('2026-10-18T01:00Z')/1000,3,{ankiType:1}]];
 assert.deepEqual(D.counts(log,null,'2026-10-18'),{studiedNew:0,studiedReview:1});assert.equal(D.stats(log)['2026-10-18'].nw,0);
});
test('unsorted device logs produce the same statistics and source entries stay untouched',()=>{
 const log=[entry('a','2026-10-17T01:00Z',0),entry('a','2026-10-18T01:00Z',2),entry('b','2026-10-18T01:01Z',0)];
 const copy=JSON.stringify(log);assert.deepEqual(D.stats([...log].reverse()),D.stats(log));assert.equal(JSON.stringify(log),copy);
 assert.deepEqual(D.counts(log,new Set(['a']),'2026-10-18'),{studiedNew:0,studiedReview:1});
});
test('legacy repeats count as answers but never as another card or daily quota use',()=>{
 const t='2026-10-18T01:00Z',log=[entry('a',t,0),entry('a',t,2,{re:1})],s=D.stats(log)['2026-10-18'];
 assert.equal(s.n,2);assert.equal(s.cards,1);assert.equal(s.nw,1);assert.equal(s.re,1);assert.equal(s.review,0);
});
test('scheduler and home use the same day on both sides of the boundary',()=>{
 const old=process.env.TZ;
 try{for(const tz of ['Asia/Seoul','America/New_York','Pacific/Honolulu']){process.env.TZ=tz;assert.equal(M.dayNumber('2026-10-17T19:00:00Z'),D.number('2026-10-17T19:00:00Z'));assert.equal(M.next({},4,new Date('2026-10-17T20:00:00Z'),'card').fsrs.due,'2026-10-21T19:00:00.000Z');}}
 finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
});
