/* Transport errors and local, redacted diagnostics shared by the Gist UI. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SienNetwork=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION='20261017-19',KEY='sien-sync-errors-v1';
  const LABELS={metadata:'변경 목록 수신',file:'학습 파일 수신',write:'학습 기록 전송',verify:'전송 확인',local:'기기 저장'};
  class Failure extends Error{
    constructor(code,stage,options={}){super(options.message||message(code,stage,options.status));this.name='SyncFailure';this.code=code;this.stage=stage;this.status=options.status||0;this.retryable=!!options.retryable;this.retryAt=options.retryAt||0;this.durationMs=options.durationMs||0;this.rate=cleanRate(options.rate);}
  }
  function message(code,stage,status){
    const label=LABELS[stage]||'동기화';
    if(code==='HTTP'&&status===409)return label+' 중 GitHub 충돌 응답(HTTP 409)을 받았습니다. 기록을 보관하고 자동 재시도합니다.';
    if(code==='AUTH')return 'GitHub 토큰을 확인해 주세요. 미전송 기록은 이 기기에 보관 중입니다.';
    if(code==='RATE_LIMIT')return 'GitHub가 '+label+'을 제한했습니다. 기록을 보관하고 제한 해제 후 자동 재시도합니다.';
    if(code==='TIMEOUT')return label+' 응답이 늦어 다시 시도합니다. 미전송 기록은 보관 중입니다.';
    if(code==='NETWORK')return label+' 중 연결이 끊겼습니다. 미전송 기록은 보관 중입니다.';
    if(code==='UNCONFIRMED')return '전송 완료를 확인하지 못했습니다. 같은 기록으로 다시 확인합니다.';
    if(code==='DATA')return label+' 데이터 형식을 확인할 수 없어 반영을 중단했습니다.';
    return label+' 실패'+(status?' (HTTP '+status+')':'')+'. 기존 기록은 유지합니다.';
  }
  function cleanRate(rate){
    if(!rate||typeof rate!=='object')return undefined;
    const out={};
    for(const k of ['limit','remaining','used','resetAt','retryAfterSeconds','retryAt']){
      const v=rate[k];if(typeof v==='number'&&Number.isFinite(v)&&v>=0)out[k]=Math.round(v);
    }
    if(typeof rate.resource==='string'&&/^[a-z][a-z0-9_]{0,39}$/.test(rate.resource))out.resource=rate.resource;
    if(['primary','secondary','unspecified'].includes(rate.kind))out.kind=rate.kind;
    return out;
  }
  function rateInfo(headers,now,body){
    const number=k=>{const v=headers.get(k);return v!==null&&v.trim()!==''&&Number.isFinite(Number(v))?Number(v):undefined;};
    const server=Date.parse(headers.get('date')),base=Number.isFinite(server)?server:now;
    const after=headers.get('retry-after'),seconds=after?(Number.isFinite(Number(after))?Math.max(0,Number(after)):(Date.parse(after)-base)/1000):undefined;
    const remaining=number('x-ratelimit-remaining'),reset=number('x-ratelimit-reset');
    const retryAt=Math.max(now+60000,Number.isFinite(seconds)?now+seconds*1000:0,remaining===0&&reset!==undefined?now+Math.max(0,reset*1000-base):0);
    return cleanRate({limit:number('x-ratelimit-limit'),remaining,used:number('x-ratelimit-used'),resetAt:reset===undefined?undefined:reset*1000,
      retryAfterSeconds:seconds,retryAt,resource:headers.get('x-ratelimit-resource'),
      kind:remaining===0?'primary':/secondary|abuse/i.test(body?.message||'')?'secondary':'unspecified'});
  }
  function waitMessage(until,pending=0,now=Date.now()){
    const seconds=Math.max(1,Math.ceil((until-now)/1000));
    const span=seconds>=60?Math.ceil(seconds/60)+'분':seconds+'초';
    const time=new Date(until).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
    return 'GitHub 요청 제한 · 약 '+span+' 후 자동 재시도합니다 ('+time+'). 미전송 '+pending+'건은 이 기기에 보관 중입니다.';
  }
  function cooldown(storage,id){
    const key='sien-github-cooldown-v1:'+id;
    return {
      read(now=Date.now()){try{const v=JSON.parse(storage.getItem(key)||'null');return v&&Number.isFinite(v.until)&&v.until>now?{until:v.until,stage:Object.hasOwn(LABELS,v.stage)?v.stage:'write',rate:cleanRate(v.rate)}:null;}catch{return null;}},
      save(error){if(error.code!=='RATE_LIMIT'||!Number.isFinite(error.retryAt)||error.retryAt<=Date.now())return;
        try{const old=this.read(),until=Math.max(old?.until||0,error.retryAt);storage.setItem(key,JSON.stringify({until,stage:error.stage,rate:cleanRate(error.rate)}));}catch{}}
    };
  }
  async function request(url,options,stage,config={}){
    const fetcher=config.fetcher||fetch,now=config.now||Date.now,start=now(),controller=new AbortController();let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},config.timeoutMs||45000);
    try{
      const r=await fetcher(url,{...options,signal:controller.signal}),text=await r.text();
      if(r.status===304&&config.cached!==undefined){config.onResponse?.(r);return config.cached;}
      if(!r.ok){
        let body;try{body=JSON.parse(text);}catch{}
        const rate=r.status===429||(r.status===403&&(r.headers.get('x-ratelimit-remaining')==='0'||/rate limit|secondary|abuse/i.test(body?.message||'')));
        const code=rate?'RATE_LIMIT':r.status===401?'AUTH':'HTTP';
        throw new Failure(code,stage,{status:r.status,retryable:rate||[408,409,425].includes(r.status)||r.status>=500||(stage==='file'&&r.status===404),retryAt:rate?rateInfo(r.headers,now(),body).retryAt:0,rate:rate?rateInfo(r.headers,now(),body):undefined});
      }
      config.onResponse?.(r);
      if(config.discardResponse)return null;
      try{return JSON.parse(text);}catch{throw new Failure('DATA',stage);}
    }catch(e){
      if(e instanceof Failure){e.durationMs=now()-start;throw e;}
      throw new Failure(timedOut?'TIMEOUT':'NETWORK',stage,{retryable:true,durationMs:now()-start});
    }finally{clearTimeout(timer);}
  }
  function delay(error,attempt,now=Date.now()){
    const waits=[2000,5000,15000,60000,180000,300000];
    return Math.max(error.retryAt?error.retryAt-now:0,error.code==='RATE_LIMIT'?Math.min(900000,60000*2**Math.min(Math.max(attempt-1,0),4)):0,waits[Math.min(Math.max(attempt-1,0),waits.length-1)]);
  }
  function pacing(storage,id){
    const key='sien-github-pacing-v1:'+id;
    const read=()=>{try{const v=JSON.parse(storage.getItem(key)||'{}');return {readUntil:Number(v.readUntil)||0,writeUntil:Number(v.writeUntil)||0};}catch{return {readUntil:0,writeUntil:0};}};
    const save=(name,until)=>{const v=read();v[name]=Math.max(v[name],until);storage.setItem(key,JSON.stringify(v));return v[name];};
    return {read,markRead:()=>save('readUntil',Date.now()+1500),markWrite:()=>save('writeUntil',Date.now()+10000),deferWrite:until=>save('writeUntil',until)};
  }
  function clean(entry){
    return {at:typeof entry.at==='string'&&/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(entry.at)?entry.at:new Date().toISOString(),
      version:VERSION,outcome:['failure','recovered'].includes(entry.outcome)?entry.outcome:'failure',
      stage:Object.hasOwn(LABELS,entry.stage)?entry.stage:'local',
      code:['AUTH','RATE_LIMIT','TIMEOUT','NETWORK','UNCONFIRMED','DATA','HTTP','LOCAL'].includes(entry.code)?entry.code:'LOCAL',
      status:Number.isInteger(entry.status)&&entry.status>=100&&entry.status<=599?entry.status:0,
      durationMs:Math.max(0,Math.round(Number(entry.durationMs)||0)),
      pending:Math.max(0,Math.round(Number(entry.pending)||0)),hidden:!!entry.hidden,...(cleanRate(entry.rate)?{rate:cleanRate(entry.rate)}:{})};
  }
  function diagnostics(storage){
    const read=()=>{try{const list=JSON.parse(storage.getItem(KEY)||'[]');return Array.isArray(list)?list.slice(-30).map(clean):[];}catch{return[];}};
    return {read,add(entry){const list=[...read(),clean(entry)].slice(-30);try{storage.setItem(KEY,JSON.stringify(list));}catch{}return list;},text(){return JSON.stringify({version:VERSION,events:read()},null,2);}};
  }
  return {VERSION,LABELS,Failure,request,delay,diagnostics,waitMessage,cooldown,pacing};
});
