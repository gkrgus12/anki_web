/* Transport errors and local, redacted diagnostics shared by the Gist UI. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SienNetwork=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION='20261017-9',KEY='sien-sync-errors-v1';
  const LABELS={metadata:'변경 목록 수신',file:'학습 파일 수신',write:'학습 기록 전송',verify:'전송 확인',local:'기기 저장'};
  class Failure extends Error{
    constructor(code,stage,options={}){super(options.message||message(code,stage,options.status));this.name='SyncFailure';this.code=code;this.stage=stage;this.status=options.status||0;this.retryable=!!options.retryable;this.retryAt=options.retryAt||0;this.durationMs=options.durationMs||0;}
  }
  function message(code,stage,status){
    const label=LABELS[stage]||'동기화';
    if(code==='HTTP'&&status===409)return label+' 중 GitHub 충돌 응답(HTTP 409)을 받았습니다. 기록을 보관하고 자동 재시도합니다.';
    if(code==='AUTH')return 'GitHub 토큰을 확인해 주세요. 미전송 기록은 이 기기에 보관 중입니다.';
    if(code==='RATE_LIMIT')return 'GitHub 요청 제한으로 잠시 기다린 뒤 자동으로 재시도합니다.';
    if(code==='TIMEOUT')return label+' 응답이 늦어 다시 시도합니다. 미전송 기록은 보관 중입니다.';
    if(code==='NETWORK')return label+' 중 연결이 끊겼습니다. 미전송 기록은 보관 중입니다.';
    if(code==='UNCONFIRMED')return '전송 완료를 확인하지 못했습니다. 같은 기록으로 다시 확인합니다.';
    if(code==='DATA')return label+' 데이터 형식을 확인할 수 없어 반영을 중단했습니다.';
    return label+' 실패'+(status?' (HTTP '+status+')':'')+'. 기존 기록은 유지합니다.';
  }
  function retryAt(headers,now){
    const after=headers.get('retry-after'),remaining=headers.get('x-ratelimit-remaining'),reset=Number(headers.get('x-ratelimit-reset'))*1000;
    const time=after?(Number.isFinite(Number(after))?now+Math.max(0,Number(after))*1000:Date.parse(after)):0;
    return Math.max(now+60000,Number.isFinite(time)?time:0,remaining==='0'&&Number.isFinite(reset)?reset:0);
  }
  async function request(url,options,stage,config={}){
    const fetcher=config.fetcher||fetch,now=config.now||Date.now,start=now(),controller=new AbortController();let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},config.timeoutMs||45000);
    try{
      const r=await fetcher(url,{...options,signal:controller.signal}),text=await r.text();
      if(!r.ok){
        let body;try{body=JSON.parse(text);}catch{}
        const rate=r.status===429||(r.status===403&&(r.headers.get('x-ratelimit-remaining')==='0'||/rate limit|secondary|abuse/i.test(body?.message||'')));
        const code=rate?'RATE_LIMIT':r.status===401?'AUTH':'HTTP';
        throw new Failure(code,stage,{status:r.status,retryable:rate||[408,409,425].includes(r.status)||r.status>=500||(stage==='file'&&r.status===404),retryAt:rate?retryAt(r.headers,now()):0});
      }
      try{return JSON.parse(text);}catch{throw new Failure('DATA',stage);}
    }catch(e){
      if(e instanceof Failure){e.durationMs=now()-start;throw e;}
      throw new Failure(timedOut?'TIMEOUT':'NETWORK',stage,{retryable:true,durationMs:now()-start});
    }finally{clearTimeout(timer);}
  }
  function delay(error,attempt,now=Date.now()){
    const waits=[2000,5000,15000,60000,180000,300000];
    return Math.max(error.retryAt?error.retryAt-now:0,waits[Math.min(Math.max(attempt-1,0),waits.length-1)]);
  }
  function clean(entry){
    return {at:typeof entry.at==='string'&&/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(entry.at)?entry.at:new Date().toISOString(),
      version:VERSION,outcome:['failure','recovered'].includes(entry.outcome)?entry.outcome:'failure',
      stage:Object.hasOwn(LABELS,entry.stage)?entry.stage:'local',
      code:['AUTH','RATE_LIMIT','TIMEOUT','NETWORK','UNCONFIRMED','DATA','HTTP','LOCAL'].includes(entry.code)?entry.code:'LOCAL',
      status:Number.isInteger(entry.status)&&entry.status>=100&&entry.status<=599?entry.status:0,
      durationMs:Math.max(0,Math.round(Number(entry.durationMs)||0)),
      pending:Math.max(0,Math.round(Number(entry.pending)||0)),hidden:!!entry.hidden};
  }
  function diagnostics(storage){
    const read=()=>{try{const list=JSON.parse(storage.getItem(KEY)||'[]');return Array.isArray(list)?list.slice(-30).map(clean):[];}catch{return[];}};
    return {read,add(entry){const list=[...read(),clean(entry)].slice(-30);try{storage.setItem(KEY,JSON.stringify(list));}catch{}return list;},text(){return JSON.stringify({version:VERSION,events:read()},null,2);}};
  }
  return {VERSION,LABELS,Failure,request,delay,diagnostics};
});
