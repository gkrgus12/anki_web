const {test}=require('node:test'),assert=require('node:assert/strict'),N=require('./sien-network');
const req=(status,body='{}',headers={},stage='write')=>N.request('https://example.invalid',{},stage,{fetcher:async()=>new Response(body,{status,headers})});
test('409 is retriable with a controlled message',async()=>{await assert.rejects(req(409,'{"message":"private-content"}'),e=>e.status===409&&e.retryable&&e.stage==='write'&&!e.message.includes('private-content'));});
test('server and transport failures retry; auth and data fail visibly',async()=>{for(const s of [408,425,500,502,503])await assert.rejects(req(s),e=>e.retryable);for(const s of [401,403,404,422])await assert.rejects(req(s),e=>!e.retryable);await assert.rejects(req(404,'{}',{},'file'),e=>e.retryable);await assert.rejects(req(200,'invalid'),e=>e.code==='DATA'&&!e.retryable);});
test('request limit respects reset and retry-after',async()=>{await assert.rejects(req(429,'{}',{'retry-after':'120'}),e=>e.retryAt>Date.now()+119000);await assert.rejects(req(403,'{"message":"API rate limit exceeded"}'),e=>e.code==='RATE_LIMIT'&&e.retryAt>Date.now()+59000);});
test('timeout covers body download, not only response headers',async()=>{await assert.rejects(N.request('https://example.invalid',{},'file',{timeoutMs:10,fetcher:async(_,o)=>({ok:true,text:()=>new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(Error('aborted'))))})}),e=>e.code==='TIMEOUT'&&e.retryable);});
test('backoff grows to a cap without shortening server cooldown',()=>{assert.deepEqual([1,2,3,4,5,6,7].map(i=>N.delay({},i,0)),[2000,5000,15000,60000,180000,300000,300000]);assert.equal(N.delay({retryAt:900000},2,1000),899000);});
test('diagnostics whitelist fields, cap history and survive unavailable storage',()=>{let data;const d=N.diagnostics({getItem:()=>data,setItem:(_,v)=>data=v});for(let i=0;i<45;i++)d.add({status:409,code:'HTTP',stage:'write',message:'private',token:'private',url:'private',pending:i});assert.equal(d.read().length,30);assert.equal(d.read()[0].pending,15);assert.equal(d.text().includes('private'),false);assert.doesNotThrow(()=>N.diagnostics({getItem(){throw Error();},setItem(){throw Error();}}).add({}));});


const now=1792213200000;
const request=(headers,message='API rate limit exceeded',status=403)=>N.request('https://example.invalid',{},'write',{now:()=>now,fetcher:async()=>new Response(JSON.stringify({message}),{status,headers})});
test('Primary deadline comes from server reset and accounts for device clock skew',async()=>{
 const server=now-120000,reset=server+2450000;
 await assert.rejects(request({'date':new Date(server).toUTCString(),'x-ratelimit-limit':'60','x-ratelimit-remaining':'0','x-ratelimit-used':'60','x-ratelimit-reset':String(reset/1000),'x-ratelimit-resource':'core'}),e=>e.retryAt===now+2450000&&e.rate.limit===60&&e.rate.kind==='primary'&&e.rate.resetAt===reset);
});
test('Secondary retry-after is respected even when main quota remains',async()=>{
 await assert.rejects(request({'retry-after':'2450','x-ratelimit-remaining':'4999'},'Secondary rate limit'),e=>e.retryAt===now+2450000&&e.rate.kind==='secondary'&&e.rate.remaining===4999);
});
test('A normal response reset is not a secondary cooldown with quota remaining',async()=>{
 await assert.rejects(request({'x-ratelimit-remaining':'4999','x-ratelimit-reset':String(now/1000+2450)},'Secondary rate limit'),e=>e.retryAt===now+60000);
});
test('Long waits use minutes and preserved server cooldown survives recreation and expiry',()=>{
 assert.match(N.waitMessage(now+2450000,5,now),/41분/);assert.match(N.waitMessage(now+2450000,5,now),/미전송 5건/);
 const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};
 const until=Date.now()+2450000,c=N.cooldown(storage,'fixture');
 c.save({code:'RATE_LIMIT',retryAt:until,stage:'write',rate:{limit:60,remaining:0,token:'secret',url:'secret'}});
 const restored=N.cooldown(storage,'fixture').read();assert.equal(restored.until,until);assert.equal(c.read(until+1),null);
 assert.equal(N.cooldown(storage,'other').read(),null);assert.equal(JSON.stringify(restored).includes('secret'),false);
});
test('Rate diagnostics whitelist data without raw messages, URLs, or credentials',()=>{
 let value;const d=N.diagnostics({getItem:()=>value,setItem:(_,v)=>value=v});
 d.add({code:'RATE_LIMIT',stage:'write',rate:{limit:5000,remaining:0,resource:'core',kind:'primary',retryAfterSeconds:2450,retryAt:now+2450000,token:'secret',message:'secret',url:'secret'}});
 assert.equal(d.read()[0].rate.retryAfterSeconds,2450);assert.equal(d.text().includes('secret'),false);
});
