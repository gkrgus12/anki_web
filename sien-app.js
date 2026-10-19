/* Personal Gist transport. Each browser owns its journal; no whole-collection PUT. */
(function(){
  'use strict';
  if(!window.SienSessions){const url=new URL(location.href);if(url.searchParams.get('v')!=='20261019-23'){url.searchParams.set('v','20261019-23');location.replace(url.href);}else showBanner('학습 화면을 다시 불러와 주세요. 미전송 기록은 이 기기에 보관되어 있습니다.',false);return;}
  const S=SienStudy,WEB='anki_fsrs_sync_data.json',PENDING='sien-pending-v1:',CACHE='sien-view-v1';
  let baseline=null,clock=0,applying=false,ready=false,chain=Promise.resolve(),timer=null;
  let sharedAppearance=S.appearance();
  let custom='[]',deleted=new Set(),fileCache=new Map(),deviceId='';
  let fileScope='',filesDirty=false;
  const explicitUndo=new Set();
  const copy=x=>JSON.parse(JSON.stringify(x));
  const empty=()=>({version:1,cards:[],decks:[],state:{cards:{},log:[]}});
  const N=SienNetwork,diagnostics=N.diagnostics(localStorage);
  let failures=0,nextRetryAt=0,rateUntil=0,autoBlocked=false,lastExitPayload='',lastConfig=null,exitSync=null,metadataCache=null,remoteWriteUntil=0;
  const htmlText=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const LIVE_INTERVAL=15000;let nextLiveAt=0;
  function pendingCount(){try{return pending().length;}catch{return 0;}}
  function logFailure(e){diagnostics.add({outcome:'failure',code:e.code,stage:e.stage,status:e.status,durationMs:e.durationMs,rate:e.rate,pending:pendingCount(),hidden:document.visibilityState==='hidden'});}
  function error(e){logFailure(e);setSyncStatusUI('error',e.message);showBanner(htmlText(e.message||'학습 기록을 저장하지 못했습니다. 이 창을 닫지 말고 다시 동기화해 주세요.'),false,'gist');}
  function failed(e,manual){
    failures++;
    if(e.code==='RATE_LIMIT')e.retryAt=Math.max(e.retryAt||0,Date.now()+N.delay(e,failures));
    logFailure(e);
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
  function payload(){return {version:1,appearance:copy(sharedAppearance),learning:SienSessions.snapshot(),cards:DATA.map(S.cleanCard),decks:copy(DECKS),state:{cards:copy(state.cards),log:copy(state.log)}};}
  function capture(){
    if(!ready||applying)return;
    const now=payload(),change=baseline&&S.delta(baseline,now);
    if(change?.removedLogs){change.removedLogs=change.removedLogs.filter(k=>explicitUndo.has(k));if(!change.removedLogs.length)delete change.removedLogs;}
    if(!change||!Object.keys(change).length){baseline=now;return;}
    const e={id:crypto.randomUUID(),at:Math.max(Date.now(),clock+1),change};
    // Synchronous outbox before acknowledging the local mutation. Card caches live in IDB.
    try{localStorage.setItem(PENDING+e.id,JSON.stringify(e));}catch{throw new Error('학습 기록을 기기에 저장하지 못했습니다. 이 창을 닫지 말고 저장 공간을 확보해 주세요.');}
    if(change.learning)now.learning=SienSessions.commit(now.learning,change.learning,e);
    for(const k of change.removedLogs||[])explicitUndo.delete(k);
    clock=e.at;baseline=now;scheduleGistAutoSync();
    chain=chain.then(()=>put(CACHE,now)).catch(error);
  }
  function apply(p,blocked=[]){
    const displayed=$('scrSolve')?.classList.contains('on')?cur()?.id:null;
    const displayedContent=displayed?JSON.stringify(S.cleanCard(cur())):'';
    S.validPayload(p);applying=true;
    try{
      deleted=new Set(blocked);DATA=p.cards.filter(c=>!deleted.has(c.id)).map(c=>copy(c));BYID={};
      DATA.forEach((c,i)=>{c._i=i;normalizeCard(c);BYID[c.id]=c;});
      DECKS=copy(p.decks);custom=JSON.stringify(p.cards);state.cards=copy(p.state.cards);state.log=copy(p.state.log);
      SienSessions.receive(p.learning);
      logWeeks={};for(const entry of state.log){const wk=weekKeyOf(logDate(entry));(logWeeks[wk]||=[]).push(entry);}
      ALLTAGS=[...new Set(DATA.flatMap(c=>c.tags||[]))];ALLTYPS=[...new Set(DATA.map(c=>c.typ).filter(Boolean))];SUBJECTS=[...new Set(DATA.map(c=>c.subj).filter(Boolean))];
      TREE=null;_prMemo=null;lastRevIdx=null;firstRevIdx=null;
      // Keep the current queue position; remove deleted entries without replaying answered cards.
      if(Array.isArray(queue)){
        const allowed=curSess?new Set(SienSessions.plan(curSess).map(c=>c.id)):null;
        const before=queue.slice(0,qPos).filter(c=>!deleted.has(c.id));
        const rest=queue.slice(qPos).filter(c=>!deleted.has(c.id)&&(!allowed||allowed.has(c.id))).map(c=>BYID[c.id]?{...BYID[c.id],...Object.fromEntries(Object.entries(c).filter(([k])=>k.startsWith('_')&&k!=='_i'))}:c);
        queue=[...before,...rest];qPos=before.length;
      }
      sharedAppearance=S.appearance(p.appearance);receiveAppearance(sharedAppearance);_dueParts=null;
      baseline=payload();coalesceDeckSessions();syncDeckDropdowns();renderDeckHub();renderHome();renderList();renderStats();
    }finally{applying=false;}
    if(displayed&&$('scrSolve').classList.contains('on')){
      if(cur()?.id!==displayed||!SienLearning.ready(cur()))showCard();
      else {
        const c=cur();
        if(displayedContent!==JSON.stringify(S.cleanCard(c))){SienRender.render($('cFront'),c,'f');fillBack(c);}
        if(revealed)intervalsPreview(c);
      }
    }
  }
  function waitForRequest(cfg,includeWrite=false){
    rateUntil=Math.max(rateUntil,N.cooldown(localStorage,cfg.gistId).read()?.until||0);
    const pace=N.pacing(localStorage,cfg.gistId).read();
    return Math.max(rateUntil,nextRetryAt,pace.readUntil,includeWrite?pace.writeUntil:0);
  }
  function defer(until,manual=false){
    setSyncStatusUI('pending');scheduleGistAutoSync(Math.max(0,until-Date.now()));
    if(Date.now()<rateUntil){const message=N.waitMessage(rateUntil,pendingCount());showBanner(htmlText(message),false,'gist');if(manual)toast(message);}
    else if(manual)toast('변경 기록을 보관했습니다. 잠시 후 자동으로 동기화합니다.');
    return false;
  }
  async function api(cfg,method='GET',files){
    const opts={method,headers:gistHeaders(cfg.token),cache:'no-store'},pace=N.pacing(localStorage,cfg.gistId);
    if(method==='GET'&&metadataCache?.etag)opts.headers['If-None-Match']=metadataCache.etag;
    if(files){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify({files:Object.fromEntries(Object.entries(files).map(([k,v])=>[k,{content:JSON.stringify(v)}]))});}
    let etag='',serverNow=Date.now(),notModified=false;
    if(method==='GET'){pace.markRead();nextLiveAt=Date.now()+LIVE_INTERVAL;}else {pace.markWrite();metadataCache=null;}
    const g=await N.request('https://api.github.com/gists/'+cfg.gistId,opts,method==='PATCH'?'write':'metadata',{
      cached:method==='GET'?metadataCache?.value:undefined,
      onResponse:r=>{notModified=r.status===304;etag=r.headers.get('etag')||'';serverNow=Date.parse(r.headers.get('date'))||Date.now();}
    });
    if(g.public||g.truncated||g.owner?.login?.toLowerCase()!==cfg.username?.toLowerCase())throw new Error('Gist 소유자 또는 전체 파일 목록을 확인할 수 없습니다.');
    if(method==='GET')metadataCache={value:g,etag:etag||(notModified?metadataCache?.etag:'')};
    remoteWriteUntil=Date.now()+Math.max(0,Math.min(10000,(Date.parse(g.updated_at)||0)+10000-serverNow));
    return g;
  }
  async function loadFiles(cfg){
    const scope=cfg.username.toLowerCase()+':'+cfg.gistId;
    if(fileScope===scope)return;
    fileScope=scope;fileCache.clear();filesDirty=false;
    const saved=await idbGet('sien-remote-files-v1:'+scope);
    if(saved?.schema===1&&Array.isArray(saved.entries))for(const row of saved.entries){
      if(Array.isArray(row)&&typeof row[0]==='string'&&row[1]&&typeof row[1].url==='string')fileCache.set(row[0],row[1]);
    }
  }
  async function saveFiles(names){
    const keep=new Set(names);
    for(const name of fileCache.keys())if(!keep.has(name)){fileCache.delete(name);filesDirty=true;}
    if(!filesDirty||!fileScope)return;
    // Optional download cache. Failure must not affect the durable answer outbox.
    try{await put('sien-remote-files-v1:'+fileScope,{schema:1,entries:[...fileCache]});filesDirty=false;}catch{}
  }
  async function readFile(f,name){
    const cached=fileCache.get(name);if(f.raw_url&&cached?.url===f.raw_url)return cached.value;
    let value;
    if(f.truncated){const u=new URL(f.raw_url);if(u.protocol!=='https:'||u.hostname!=='gist.githubusercontent.com')throw new Error('원격 파일 주소가 올바르지 않습니다.');value=await N.request(u.href,{cache:'no-store'},'file');}
    else try{value=JSON.parse(f.content);}catch{throw new N.Failure('DATA','file');}
    fileCache.set(name,{url:f.raw_url,value});filesDirty=true;return value;
  }

  async function read(g){
    if(!g.files?.[WEB])throw new Error('기존 카드 파일을 찾지 못했습니다.');
    const names=Object.keys(g.files).filter(n=>n===WEB||n==='sien-obsidian-base-v2.json'||n.startsWith(S.PREFIX)||n.startsWith(S.BASE)||n.startsWith('sien-obsidian-lifecycle-'));
    let cursor=0,failure;
    // Bound parallelism; await every started read before a retry can begin.
    await Promise.all(Array.from({length:Math.min(3,names.length)},async()=>{
      while(cursor<names.length&&!failure){const name=names[cursor++];try{await readFile(g.files[name],name);}catch(e){failure||=e;}}
    }));
    if(failure)throw failure;
    const p=S.validPayload(await readFile(g.files[WEB],WEB)),docs=[],blocked=[];let vaultId='';
    for(const [name,f]of Object.entries(g.files)){
      if(name.startsWith(S.PREFIX)||name.startsWith(S.BASE))docs.push(S.validateDoc(await readFile(f,name)));
      if(name.startsWith('sien-obsidian-lifecycle-')){const d=await readFile(f,name);if(d.schema!==1||!Array.isArray(d.blocked))throw new Error('삭제 보호 기록이 손상되었습니다.');blocked.push(...d.blocked);}
      if(name==='sien-obsidian-base-v2.json')vaultId=(await readFile(f,name)).vaultId;
    }
    await saveFiles(names);return {p,docs,blocked,vaultId};
  }
  async function receiveView(remote){
    capture();await chain;
    const merge=()=>S.merge(remote.p,[...remote.docs,{schema:1,kind:'journal',deviceId,sequence:0,events:pending()}],remote.blocked);
    let merged=merge();await put(CACHE,merged.payload);
    // A grade can arrive while IndexedDB is committing; retain it in the view and outbox.
    capture();merged=merge();clock=Math.max(clock,merged.clock);apply(merged.payload,merged.deleted);
  }
  let activeSync=null;
  function sync(manual=false,passive=false){
    if(exitSync)return exitSync.then(()=>sync(manual,passive));
    if(activeSync)return activeSync;
    activeSync=runSync(manual,passive).finally(()=>{activeSync=null;if(pendingCount()&&!autoBlocked)scheduleGistAutoSync();});return activeSync;
  }
  async function runSync(manual=false,passive=false){
    const cfg=getGistConfig();if(!cfg?.token||!cfg.gistId)return false;
    if(lastConfig&&(lastConfig.token!==cfg.token||lastConfig.gistId!==cfg.gistId)){autoBlocked=false;nextRetryAt=0;rateUntil=0;failures=0;fileCache.clear();metadataCache=null;remoteWriteUntil=0;}
    lastConfig={token:cfg.token,gistId:cfg.gistId};
    clearTimeout(timer);timer=null;capture();
    const until=waitForRequest(cfg,pendingCount()>0);
    if(until>Date.now())return defer(until,manual);
    if(autoBlocked&&!manual)return false;
    if(document.visibilityState==='hidden'&&!manual)return false;
    if(navigator.onLine===false){nextRetryAt=Date.now()+30000;return defer(nextRetryAt,manual);}
    if(manual)autoBlocked=false;
    if(isGistSyncing)return false;isGistSyncing=true;setSyncStatusUI('syncing');
    try{
      if(!navigator.locks)throw new Error('이 브라우저는 안전한 다중 탭 저장을 지원하지 않습니다. 최신 Chrome 또는 Edge로 열어 주세요.');
      return await navigator.locks.request('sien-gist-'+cfg.gistId,async()=>{
        if(getGistConfig()?.gistId!==cfg.gistId||getGistConfig()?.token!==cfg.token)return false;
        if(passive&&Date.now()<nextLiveAt)return false;
        const until=waitForRequest(cfg,pendingCount()>0);
        if(until>Date.now())return defer(until,manual);
        if(document.visibilityState==='hidden'&&!manual)return false;
        capture();await chain;
        const ownId=await idbGet('sien-device-v1');deviceId=ownId||crypto.randomUUID();if(!ownId)await put('sien-device-v1',deviceId);
        await loadFiles(cfg);
        let remote=await read(await api(cfg)),outbox=pending();
        const files=S.append(remote.docs,deviceId,outbox);
        if(!remote.docs.some(d=>d.kind==='base'))files[S.BASE+crypto.randomUUID()+'.json']={schema:1,kind:'base',state:copy(remote.p.state)};
        const allDeleted=[...new Set(outbox.flatMap(e=>e.change.deleted||[]))];
        // Older 2.0.3 Obsidian clients also understand these durable exclusions.
        if(allDeleted.length&&remote.vaultId){
          const name='sien-obsidian-lifecycle-web-'+deviceId+'.json';
          files[name]={schema:1,vaultId:remote.vaultId,deviceId:'web-'+deviceId,published:[],blocked:[...new Set([...remote.blocked,...allDeleted])]};
        }
        if(Object.keys(files).length){
          const until=Math.max(N.pacing(localStorage,cfg.gistId).read().writeUntil,remoteWriteUntil);
          if(until>Date.now()){await receiveView(remote);N.pacing(localStorage,cfg.gistId).deferWrite(until);return defer(until,manual);}
          remote=await read(await api(cfg,'PATCH',files));
          const stored=new Set(remote.docs.filter(d=>d.kind==='journal').flatMap(d=>d.events.map(e=>e.id)));
          if(outbox.some(e=>!stored.has(e.id)))throw new N.Failure('UNCONFIRMED','verify',{retryable:true});
        }
        await receiveView(remote);
        for(const e of outbox)localStorage.removeItem(PENDING+e.id);
        dirtyFiles.clear();dirtyLogs.clear();saveDirtyLogs();setDirty(pending().length>0);lastPushAt=Date.now();ratedSincePush=0;
        cfg.lastSyncAt=Date.now();saveGistConfig(cfg);setSyncStatusUI(pendingCount()?'pending':'synced');
        if(failures)diagnostics.add({outcome:'recovered',stage:'verify',code:'LOCAL',pending:pendingCount(),hidden:document.visibilityState==='hidden'});
        failures=0;nextRetryAt=0;rateUntil=0;autoBlocked=false;hideBanner('gist');
        if(manual)toast('동기화가 완료되었습니다');if(pending().length)scheduleGistAutoSync();return true;
      });
    }catch(e){failed(e,manual);return false;}finally{isGistSyncing=false;lastGistPullTime=Date.now();}
  }
  // The fork uses Gist journals only. Old repository settings must not reactivate
  // the upstream ten-minute snapshot writer or a second persistence pipeline.
  loadCfg=function(){cfg=null;};snapSoon=function(){};snapPut=async()=>{};
  ghPut=async()=>{throw new Error('이 사이트는 GitHub 연동의 Gist 저장만 사용합니다.');};
  const oldGet=lsGet,oldSet=lsSet;
  lsGet=function(k){return k===getUserStorageKey('custom_cards')?custom:oldGet(k);};
  lsSet=function(k,v){if(k===getUserStorageKey('custom_cards')){custom=v;return true;}return oldSet(k,v);};
  restoreUserCards=function(){const list=JSON.parse(custom);const map=new Map(DATA.filter(c=>!deleted.has(c.id)).map(c=>[c.id,c]));for(const c of list)if(!deleted.has(c.id))map.set(c.id,c);DATA=[...map.values()];BYID={};DATA.forEach((c,i)=>{normalizeCard(c);c._i=i;BYID[c.id]=c;});};
  buildLocalSyncPayload=payload;executeGistSync=sync;
  applyMergedGistData=p=>apply(p);
  scheduleGistAutoSync=function(delay=0){
    if(timer)clearTimeout(timer);timer=null;
    if(autoBlocked||document.visibilityState==='hidden')return;
    const cfg=getGistConfig();
    const until=cfg?.gistId?waitForRequest(cfg,pendingCount()>0):Math.max(nextRetryAt,rateUntil);
    const wait=Math.max(delay,until-Date.now(),0);
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
  window.SienApp={capture,sync,setAppearance(value){
    if(!ready){toast('데이터를 불러온 뒤 테마를 바꿔 주세요.');return;}
    const previous=sharedAppearance;sharedAppearance=S.appearance(value);
    try{capture();receiveAppearance(sharedAppearance);renderHome();}catch(e){sharedAppearance=previous;error(e);}
  },diagnostics:()=>diagnostics.read(),async boot(){
    installDiagnostics();
    try{
      buildEngine();
      const cached=await idbGet(CACHE)||empty();
      // Import a browser's pre-journal sessions once, at the oldest logical time.
      // Per-field clocks let later shared edits/deletions win over this migration.
      if(!cached.learning){
        const change={learning:SienData.delta(null,SienSessions.initialize())};
        const e={id:'migration-'+crypto.randomUUID(),at:1,change};localStorage.setItem(PENDING+e.id,JSON.stringify(e));
      }
      const local=S.merge(cached,[{schema:1,kind:'journal',deviceId:'local',sequence:0,events:pending()}]);clock=local.clock;apply(local.payload,local.deleted);ready=true;
      if(getGistConfig()?.token)await sync(false);
    }catch(e){error(e);}
  }};
  window.addEventListener('online',()=>{nextRetryAt=0;scheduleGistAutoSync(0);});
  // A web-only viewer receives edits without a grade, tab switch or Obsidian.
  // At most four metadata checks/minute per visible view. Web Locks and the
  // existing shared pacing still prevent overlapping requests across tabs.
  setInterval(()=>{
    if(!ready||activeSync||exitSync||timer||autoBlocked||document.visibilityState==='hidden'||navigator.onLine===false)return;
    const cfg=getGistConfig();if(!cfg?.token||!cfg.gistId)return;
    if(Date.now()>=Math.max(nextLiveAt,waitForRequest(cfg,pendingCount()>0)))void sync(false,true);
  },1000);
  function leave(){
    try{
      capture();clearTimeout(timer);timer=null;
      const cfg=getGistConfig();if(!cfg?.token||!cfg.gistId||!deviceId||autoBlocked)return;
      rateUntil=Math.max(rateUntil,N.cooldown(localStorage,cfg.gistId).read()?.until||0);
      // An in-flight normal save already owns this outbox. A second exit PATCH
      // caused 409s and consumed write quota. Keep the durable outbox on abort.
      if(activeSync||isGistSyncing||exitSync||Date.now()<Math.max(rateUntil,nextRetryAt,N.pacing(localStorage,cfg.gistId).read().writeUntil)||!navigator.locks||navigator.onLine===false)return;
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
        if(!lock||activeSync||isGistSyncing||Date.now()<Math.max(rateUntil,nextRetryAt,N.cooldown(localStorage,cfg.gistId).read()?.until||0,N.pacing(localStorage,cfg.gistId).read().writeUntil))return;
        lastExitPayload=body;N.pacing(localStorage,cfg.gistId).markWrite();metadataCache=null;
        try{await N.request('https://api.github.com/gists/'+cfg.gistId,{method:'PATCH',headers:{...gistHeaders(cfg.token),'Content-Type':'application/json'},body,keepalive:true},'write',{discardResponse:true});}
        catch(e){lastExitPayload='';failed(e,false);}
      }).catch(()=>{lastExitPayload='';}).finally(()=>{exitSync=null;});
    }catch(e){console.warn('[동기화] 종료 시 미전송 기록은 다음 접속에서 다시 보냅니다.');}
  }
  window.addEventListener('pagehide',leave);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')leave();else scheduleGistAutoSync(0);});
  window.addEventListener('pageshow',e=>{if(e.persisted)scheduleGistAutoSync(0);});
})();
