/* Personal Gist transport. Each browser owns its journal; no whole-collection PUT. */
(function(){
  'use strict';
  const S=SienStudy,WEB='anki_fsrs_sync_data.json',PENDING='sien-pending-v1:',CACHE='sien-view-v1';
  let baseline=null,clock=0,applying=false,ready=false,chain=Promise.resolve(),timer=null;
  let custom='[]',deleted=new Set(),fileCache=new Map(),deviceId='';
  const explicitUndo=new Set();
  const copy=x=>JSON.parse(JSON.stringify(x));
  const empty=()=>({version:1,cards:[],decks:[],state:{cards:{},log:[]}});
  const N=SienNetwork,diagnostics=N.diagnostics(localStorage);
  let failures=0,nextRetryAt=0,rateUntil=0,autoBlocked=false,lastExitPayload='',lastConfig=null,exitSync=null;
  const htmlText=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  function pendingCount(){try{return pending().length;}catch{return 0;}}
  function logFailure(e){diagnostics.add({outcome:'failure',code:e.code,stage:e.stage,status:e.status,durationMs:e.durationMs,rate:e.rate,pending:pendingCount(),hidden:document.visibilityState==='hidden'});}
  function error(e){logFailure(e);setSyncStatusUI('error',e.message);showBanner(htmlText(e.message||'학습 기록을 저장하지 못했습니다. 이 창을 닫지 말고 다시 동기화해 주세요.'),false,'gist');}
  function failed(e,manual){
    logFailure(e);failures++;
    const cfg=getGistConfig();if(cfg?.gistId)N.cooldown(localStorage,cfg.gistId).save(e);
    if(e.retryable){
      rateUntil=Math.max(rateUntil,e.retryAt||0);nextRetryAt=Date.now()+N.delay(e,failures)+Math.floor(Math.random()*1000);
      setSyncStatusUI('pending');
      if(document.visibilityState!=='hidden'&&(manual||failures>=3||e.code==='RATE_LIMIT'))showBanner(htmlText(e.code==='RATE_LIMIT'?N.waitMessage(rateUntil,pendingCount()):e.message),false,'gist');
      scheduleGistAutoSync();
    }else{autoBlocked=true;setSyncStatusUI('error',e.message);showBanner(htmlText(e.message||'동기화 데이터를 확인하지 못했습니다.'),false,'gist');}
    if(manual)toast(e.message);
  }
  function installDiagnostics(){
    const host=$('gistConnectedView');if(!host||$('sienSyncLog'))return;
    const details=document.createElement('details');details.id='sienSyncLog';details.style.marginTop='14px';
    const summary=document.createElement('summary');summary.textContent='동기화 오류 내역';details.append(summary);
    const note=document.createElement('p');note.className='desc';note.textContent='이 기기의 최근 오류와 복구 기록입니다. 토큰과 학습 내용은 포함하지 않습니다.';details.append(note);
    const pre=document.createElement('pre');Object.assign(pre.style,{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:'220px',overflow:'auto',fontSize:'12px'});details.append(pre);
    const button=document.createElement('button');button.className='btn-ghost';button.textContent='오류 내역 복사';
    button.onclick=async()=>{try{await navigator.clipboard.writeText(diagnostics.text());toast('오류 내역을 복사했습니다');}catch{toast('아래 오류 내역을 선택하여 복사해 주세요');}};
    details.append(button);details.ontoggle=()=>{if(details.open)pre.textContent=diagnostics.read().length?diagnostics.text():'아직 기록된 오류가 없습니다.';};host.append(details);
  }
  async function put(key,value){const db=await idbOpen();try{await new Promise((resolve,reject)=>{const tx=db.transaction('kv','readwrite');tx.objectStore('kv').put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('로컬 저장이 취소되었습니다.'));});}finally{db.close();}}
  function pending(){const out=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(PENDING)){const value=JSON.parse(localStorage.getItem(k));out.push(value);}}return out;}
  function payload(){return {version:1,cards:DATA.map(S.cleanCard),decks:copy(DECKS),state:{cards:copy(state.cards),log:copy(state.log)}};}
  function capture(){
    if(!ready||applying)return;
    const now=payload(),change=baseline&&S.delta(baseline,now);
    if(change?.removedLogs){change.removedLogs=change.removedLogs.filter(k=>explicitUndo.has(k));if(!change.removedLogs.length)delete change.removedLogs;}
    if(!change||!Object.keys(change).length){baseline=now;return;}
    const e={id:crypto.randomUUID(),at:Math.max(Date.now(),clock+1),change};
    // Synchronous outbox before acknowledging the local mutation. Card caches live in IDB.
    try{localStorage.setItem(PENDING+e.id,JSON.stringify(e));}catch{throw new Error('학습 기록을 기기에 저장하지 못했습니다. 이 창을 닫지 말고 저장 공간을 확보해 주세요.');}
    for(const k of change.removedLogs||[])explicitUndo.delete(k);
    clock=e.at;baseline=now;scheduleGistAutoSync();
    chain=chain.then(()=>put(CACHE,now)).catch(error);
  }
  function apply(p,blocked=[]){
    const displayed=$('scrSolve')?.classList.contains('on')?cur()?.id:null;
    S.validPayload(p);applying=true;
    try{
      deleted=new Set(blocked);DATA=p.cards.filter(c=>!deleted.has(c.id)).map(c=>copy(c));BYID={};
      DATA.forEach((c,i)=>{c._i=i;normalizeCard(c);BYID[c.id]=c;});
      DECKS=copy(p.decks);custom=JSON.stringify(p.cards);state.cards=copy(p.state.cards);state.log=copy(p.state.log);
      logWeeks={};for(const entry of state.log){const wk=weekKeyOf(logDate(entry));(logWeeks[wk]||=[]).push(entry);}
      ALLTAGS=[...new Set(DATA.flatMap(c=>c.tags||[]))];ALLTYPS=[...new Set(DATA.map(c=>c.typ).filter(Boolean))];SUBJECTS=[...new Set(DATA.map(c=>c.subj).filter(Boolean))];
      TREE=null;_prMemo=null;lastRevIdx=null;firstRevIdx=null;
      // Keep the current queue position; remove deleted entries without replaying answered cards.
      if(Array.isArray(queue)){const before=queue.slice(0,qPos).filter(c=>!deleted.has(c.id));const rest=queue.slice(qPos).filter(c=>!deleted.has(c.id)).map(c=>Object.assign(c,BYID[c.id]||{}));queue=[...before,...rest];qPos=before.length;}
      baseline=payload();syncDeckDropdowns();renderDeckHub();renderHome();renderList();renderStats();
    }finally{applying=false;}
    if(displayed&&$('scrSolve').classList.contains('on')){
      if(cur()?.id!==displayed||!SienLearning.ready(cur()))showCard();
      else if(revealed)intervalsPreview(cur());
    }
  }
  async function api(cfg,method='GET',files){
    const opts={method,headers:gistHeaders(cfg.token),cache:'no-store'};
    if(files){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify({files:Object.fromEntries(Object.entries(files).map(([k,v])=>[k,{content:JSON.stringify(v)}]))});}
    const g=await N.request('https://api.github.com/gists/'+cfg.gistId,opts,method==='PATCH'?'write':'metadata');if(g.public||g.truncated||g.owner?.login?.toLowerCase()!==cfg.username?.toLowerCase())throw new Error('Gist 소유자 또는 전체 파일 목록을 확인할 수 없습니다.');return g;
  }
  async function readFile(f,name){
    const cached=fileCache.get(name);if(f.raw_url&&cached?.url===f.raw_url)return cached.value;
    let value;
    if(f.truncated){const u=new URL(f.raw_url);if(u.protocol!=='https:'||u.hostname!=='gist.githubusercontent.com')throw new Error('원격 파일 주소가 올바르지 않습니다.');value=await N.request(u.href,{cache:'no-store'},'file');}
    else try{value=JSON.parse(f.content);}catch{throw new N.Failure('DATA','file');}
    fileCache.set(name,{url:f.raw_url,value});return value;
  }

  async function read(g){
    if(!g.files?.[WEB])throw new Error('기존 카드 파일을 찾지 못했습니다.');
    const p=S.validPayload(await readFile(g.files[WEB],WEB)),docs=[],blocked=[];let vaultId='';
    for(const [name,f]of Object.entries(g.files)){
      if(name.startsWith(S.PREFIX)||name.startsWith(S.BASE))docs.push(S.validateDoc(await readFile(f,name)));
      if(name.startsWith('sien-obsidian-lifecycle-')){const d=await readFile(f,name);if(d.schema!==1||!Array.isArray(d.blocked))throw new Error('삭제 보호 기록이 손상되었습니다.');blocked.push(...d.blocked);}
      if(name==='sien-obsidian-base-v2.json')vaultId=(await readFile(f,name)).vaultId;
    }
    return {p,docs,blocked,vaultId};
  }
  let activeSync=null;
  function sync(manual=false){
    if(exitSync)return exitSync.then(()=>sync(manual));
    if(activeSync)return activeSync.then(ok=>ok&&(manual||pending().length)?sync(manual):ok);
    activeSync=runSync(manual).finally(()=>{activeSync=null;});return activeSync;
  }
  async function runSync(manual=false){
    const cfg=getGistConfig();if(!cfg?.token||!cfg.gistId)return false;
    if(lastConfig&&(lastConfig.token!==cfg.token||lastConfig.gistId!==cfg.gistId)){autoBlocked=false;nextRetryAt=0;rateUntil=0;failures=0;fileCache.clear();}
    lastConfig={token:cfg.token,gistId:cfg.gistId};
    rateUntil=Math.max(rateUntil,N.cooldown(localStorage,cfg.gistId).read()?.until||0);
    const wait=Math.max(rateUntil,manual?0:nextRetryAt)-Date.now();
    if(wait>0){scheduleGistAutoSync();if(Date.now()<rateUntil){const message=N.waitMessage(rateUntil,pendingCount());setSyncStatusUI('pending');showBanner(htmlText(message),false,'gist');if(manual)toast(message);}else if(manual)toast('잠시 후 자동으로 다시 확인합니다.');return false;}
    if(autoBlocked&&!manual)return false;
    if(document.visibilityState==='hidden'&&!manual)return false;
    if(manual){autoBlocked=false;nextRetryAt=0;}
    if(isGistSyncing)return false;isGistSyncing=true;setSyncStatusUI('syncing');
    try{
      if(!navigator.locks)throw new Error('이 브라우저는 안전한 다중 탭 저장을 지원하지 않습니다. 최신 Chrome 또는 Edge로 열어 주세요.');
      return await navigator.locks.request('sien-gist-'+cfg.gistId,async()=>{
        capture();await chain;
        const ownId=await idbGet('sien-device-v1');deviceId=ownId||crypto.randomUUID();if(!ownId)await put('sien-device-v1',deviceId);
        let remote=await read(await api(cfg)),outbox=pending();
        const files=S.append(remote.docs,deviceId,outbox);
        if(!remote.docs.some(d=>d.kind==='base'))files[S.BASE+crypto.randomUUID()+'.json']={schema:1,kind:'base',state:copy(remote.p.state)};
        const allDeleted=[...new Set(outbox.flatMap(e=>e.change.deleted||[]))];
        // Older 2.0.3 Obsidian clients also understand these durable exclusions.
        if(allDeleted.length&&remote.vaultId){
          const name='sien-obsidian-lifecycle-web-'+deviceId+'.json';
          files[name]={schema:1,vaultId:remote.vaultId,deviceId:'web-'+deviceId,published:[],blocked:[...new Set([...remote.blocked,...allDeleted])]};
        }
        if(Object.keys(files).length){await api(cfg,'PATCH',files);remote=await read(await api(cfg));
          const stored=new Set(remote.docs.filter(d=>d.kind==='journal').flatMap(d=>d.events.map(e=>e.id)));
          if(outbox.some(e=>!stored.has(e.id)))throw new N.Failure('UNCONFIRMED','verify',{retryable:true});
        }
        // A grade may arrive during either network request. Capture it before applying remote state.
        capture();const currentPending=pending();
        let merged=S.merge(remote.p,[...remote.docs,{schema:1,kind:'journal',deviceId,sequence:0,events:currentPending}],remote.blocked);
        await put(CACHE,merged.payload);
        capture();merged=S.merge(remote.p,[...remote.docs,{schema:1,kind:'journal',deviceId,sequence:0,events:pending()}],remote.blocked);
        clock=Math.max(clock,merged.clock);apply(merged.payload,merged.deleted);
        for(const e of outbox)localStorage.removeItem(PENDING+e.id);
        dirtyFiles.clear();dirtyLogs.clear();saveDirtyLogs();setDirty(pending().length>0);lastPushAt=Date.now();ratedSincePush=0;
        cfg.lastSyncAt=Date.now();saveGistConfig(cfg);setSyncStatusUI('synced');
        if(failures)diagnostics.add({outcome:'recovered',stage:'verify',code:'LOCAL',pending:pendingCount(),hidden:document.visibilityState==='hidden'});
        failures=0;nextRetryAt=0;rateUntil=0;autoBlocked=false;hideBanner('gist');
        if(manual)toast('동기화가 완료되었습니다');if(pending().length)scheduleGistAutoSync();return true;
      });
    }catch(e){failed(e,manual);return false;}finally{isGistSyncing=false;lastGistPullTime=Date.now();}
  }
  const oldGet=lsGet,oldSet=lsSet;
  lsGet=function(k){return k===getUserStorageKey('custom_cards')?custom:oldGet(k);};
  lsSet=function(k,v){if(k===getUserStorageKey('custom_cards')){custom=v;return true;}return oldSet(k,v);};
  restoreUserCards=function(){const list=JSON.parse(custom);const map=new Map(DATA.filter(c=>!deleted.has(c.id)).map(c=>[c.id,c]));for(const c of list)if(!deleted.has(c.id))map.set(c.id,c);DATA=[...map.values()];BYID={};DATA.forEach((c,i)=>{normalizeCard(c);c._i=i;BYID[c.id]=c;});};
  buildLocalSyncPayload=payload;executeGistSync=sync;
  applyMergedGistData=p=>apply(p);
  scheduleGistAutoSync=function(delay=0){
    if(timer)clearTimeout(timer);timer=null;
    if(autoBlocked||document.visibilityState==='hidden')return;
    const wait=Math.max(delay,nextRetryAt-Date.now(),rateUntil-Date.now(),0);
    timer=setTimeout(()=>{timer=null;if(document.visibilityState!=='hidden')sync(false);},wait);
  };
  // All legacy collection/repository writers are routed through the one journal transport.
  push=async(force=false)=>sync(!!force);refreshRemote=async()=>{lastRefreshAt=Date.now();return sync(false);};loadAll=async()=>{};loadData=async()=>{};loadWeeks=async()=>false;
  const oldPushLog=pushLog;pushLog=function(entry){entry[3]={...(entry[3]||{}),sienId:crypto.randomUUID()};return oldPushLog(entry);};
  const oldDropLog=dropLogEntry;dropLogEntry=function(entry){if(entry)explicitUndo.add(S.logKey(entry));return oldDropLog(entry);};
  const originalRate=rate;rate=function(...args){const r=originalRate(...args);try{capture();}catch(e){error(e);}return r;};
  const originalUndo=doUndo;doUndo=function(...args){const r=originalUndo(...args);try{capture();}catch(e){error(e);}return r;};
  const originalDirty=setDirty;setDirty=function(v){const r=originalDirty(v);if(v&&!applying)queueMicrotask(()=>{try{capture();}catch(e){error(e);}});return r;};
  const originalDelete=deleteCard;deleteCard=function(id){const r=originalDelete(id);try{capture();}catch(e){error(e);}return r;};
  const originalDecks=saveUserDecks;saveUserDecks=function(...args){const r=originalDecks(...args);queueMicrotask(()=>{try{capture();}catch(e){error(e);}});return r;};
  const originalSave=$('btnDoSaveCard')?.onclick;if(originalSave)$('btnDoSaveCard').onclick=function(...args){const r=originalSave.apply(this,args);try{capture();}catch(e){error(e);}return r;};
  window.SienApp={capture,sync,diagnostics:()=>diagnostics.read(),async boot(){
    installDiagnostics();
    try{
      buildEngine();
      const cached=await idbGet(CACHE)||empty();
      const local=S.merge(cached,[{schema:1,kind:'journal',deviceId:'local',sequence:0,events:pending()}]);clock=local.clock;apply(local.payload,local.deleted);ready=true;
      if(getGistConfig()?.token)await sync(false);
    }catch(e){error(e);}
  }};
  window.addEventListener('online',()=>{nextRetryAt=0;scheduleGistAutoSync(0);});
  function leave(){
    try{
      capture();clearTimeout(timer);timer=null;
      const cfg=getGistConfig();if(!cfg?.token||!cfg.gistId||!deviceId||autoBlocked)return;
      rateUntil=Math.max(rateUntil,N.cooldown(localStorage,cfg.gistId).read()?.until||0);
      // An in-flight normal save already owns this outbox. A second exit PATCH
      // caused 409s and consumed write quota. Keep the durable outbox on abort.
      if(activeSync||isGistSyncing||exitSync||Date.now()<rateUntil||!navigator.locks)return;
      const files={};
      for(const event of pending()){
        const name=S.PREFIX+deviceId+'-exit-'+event.id+'.json';
        files[name]={content:JSON.stringify({schema:1,kind:'journal',deviceId,sequence:-1,immutable:true,events:[event]})};
        if(new TextEncoder().encode(JSON.stringify({files})).length>55000){delete files[name];break;}
      }
      if(!Object.keys(files).length)return;
      const body=JSON.stringify({files});if(body===lastExitPayload)return;
      // The same Web Lock also protects other tabs. Do not queue an exit write
      // behind a busy tab: next entry reconciles event IDs from the local outbox.
      exitSync=navigator.locks.request('sien-gist-'+cfg.gistId,{ifAvailable:true},async lock=>{
        if(!lock||activeSync||isGistSyncing||Date.now()<Math.max(rateUntil,N.cooldown(localStorage,cfg.gistId).read()?.until||0))return;
        lastExitPayload=body;
        try{await N.request('https://api.github.com/gists/'+cfg.gistId,{method:'PATCH',headers:{...gistHeaders(cfg.token),'Content-Type':'application/json'},body,keepalive:true},'write',{discardResponse:true});}
        catch(e){lastExitPayload='';failed(e,false);}
      }).catch(()=>{lastExitPayload='';}).finally(()=>{exitSync=null;});
    }catch(e){console.warn('[동기화] 종료 시 미전송 기록은 다음 접속에서 다시 보냅니다.');}
  }
  window.addEventListener('pagehide',leave);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')leave();else scheduleGistAutoSync(0);});
  window.addEventListener('pageshow',e=>{if(e.persisted)scheduleGistAutoSync(0);});
})();
