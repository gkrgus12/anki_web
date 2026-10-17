/* UI adapter for the SM-2 scheduler. Imported due dates are never recalculated at boot. */
(function(){
  'use strict';
  const M=SienSM2;let seedLog=null,seedSize=-1,seeds=new Map(),grades=new Map(),timer=null,waiting=false;
  function imported(id){
    if(seedLog!==state.log||seedSize!==state.log.length){
      seedLog=state.log;seedSize=state.log.length;seeds=new Map();grades=new Map();
      for(const e of [...state.log].sort((a,b)=>a[1]-b[1])){const x=e[3];if(x?.ankiId&&x.factor>0)seeds.set(e[0],{ease:x.factor/1000,step:x.ankiType===0&&x.ivl===-600?1:0});
        if(x?.scheduler==='anki-sm2-v1'){if(!grades.has(e[0]))grades.set(e[0],[]);grades.get(e[0]).push({grade:e[2],phase:x.previousPhase});}
      }
    }return {...seeds.get(id),grades:grades.get(id)};
  }
  function next(c,num,now){return M.next(st(c.id),num,now,c.id,imported(c.id));}
  function alive(c){return !!c&&!!BYID[c.id]&&!retired(c)&&!buried(c)&&!offed(c);}
  const LEARN_AHEAD_MS=20*60*1000;
  function dueTime(c){return Math.max(c._sienQueueDue||0,Date.parse(state.cards[c.id]?.fsrs?.due));}
  function dueNow(c){return alive(c)&&(!state.cards[c.id]?.fsrs||M.due(state.cards[c.id]));}
  function mainReady(c){return alive(c)&&kind(c)!=='learning'&&dueNow(c);}
  function ready(c){
    if(dueNow(c))return true;
    return alive(c)&&kind(c)==='learning'&&dueTime(c)<=Date.now()+LEARN_AHEAD_MS&&
      queue.slice(qPos).some(x=>x.id===c.id)&&!queue.slice(qPos).some(mainReady);
  }
  function queued(c){return alive(c)&&(dueNow(c)||(kind(c)==='learning'&&Number.isFinite(dueTime(c))));}
  function insert(c){
    if(!M.learning(state.cards[c.id]))return null;
    for(let i=queue.length-1;i>qPos;i--)if(queue[i].id===c.id)queue.splice(i,1);
    const item={...c};delete item._re;delete item._day;delete item._sienQueueDue;
    // Anki avoids immediate repeated presentation when another learn-ahead card can go first.
    const rest=queue.slice(qPos+1),cutoff=Date.now()+LEARN_AHEAD_MS;
    if(kind(item)==='learning'&&!rest.some(mainReady)&&dueTime(item)<=cutoff){
      const next=rest.filter(x=>kind(x)==='learning').sort((a,b)=>dueTime(a)-dueTime(b))[0];
      if(next&&dueTime(next)>=dueTime(item)&&dueTime(next)+1000<cutoff)item._sienQueueDue=dueTime(next)+1000;
    }
    queue.push(item);return item;
  }
  function kind(c){
    const f=state.cards[c.id]?.fsrs;
    if(M.learning(state.cards[c.id]))return f.last_review&&M.dayNumber(f.due)>M.dayNumber(f.last_review)?'interday':'learning';
    return isNew(c)?'new':'review';
  }
  function start(sx){
    if(!sx||sx.how?.order==='doc')return;
    if(sx.sienMixVersion===1&&sx.sienMixDay===todayKey())return;
    queue=SienQueue.mix(queue,kind);
    sx.sienMixVersion=1;sx.sienMixDay=todayKey();
    // Persist the remaining order, so restarting cannot postpone the next new card.
    syncSessQueue();
  }
  function panel(){let el=$('sienLearningWait');if(!el){el=document.createElement('div');el.id='sienLearningWait';el.className='sien-learning-wait';el.innerHTML='<p class="sien-wait-label">다음 학습 단계</p><strong id="sienWaitTime"></strong><p>시간이 되면 카드가 자동으로 나타납니다.<br>지금 나가도 학습 진행은 저장됩니다.</p><button class="btn-ghost" id="sienWaitHome">홈으로</button>';$('cardZone').after(el);$('sienWaitHome').onclick=()=>{push();go('scrHome');};}return el;}
  function prepare(){
    clearTimeout(timer);waiting=false;$('scrSolve').classList.remove('sien-waiting');if($('sienLearningWait'))$('sienLearningWait').hidden=true;
    // Old session-only repeat markers must not hide Hard/Easy or bypass scheduling.
    for(let i=qPos;i<queue.length;i++){if(queue[i]._re){queue[i]={...BYID[queue[i].id],...queue[i]};delete queue[i]._re;}}
    const before=queue.slice(0,qPos),seen=new Set();
    const size=queue.length;queue=[...before,...queue.slice(qPos).filter(c=>queued(c)&&!seen.has(c.id)&&seen.add(c.id))];
    if(queue.length!==size)syncSessQueue();
    // Due short steps take precedence over fresh cards; future steps wait while other cards continue.
    const learningAt=cutoff=>{let at=-1,earliest=Infinity;for(let i=qPos;i<queue.length;i++){const c=queue[i];if(kind(c)==='learning'&&dueTime(c)<=cutoff&&dueTime(c)<earliest){earliest=dueTime(c);at=i;}}return at;};
    let at=learningAt(Date.now());
    if(at<0)at=queue.findIndex((c,i)=>i>=qPos&&mainReady(c));
    if(at<0)at=learningAt(Date.now()+LEARN_AHEAD_MS);
    if(at>=0){if(at!==qPos)queue.splice(qPos,0,queue.splice(at,1)[0]);return true;}
    const future=queue.slice(qPos).filter(c=>M.learning(state.cards[c.id])&&Number.isFinite(Date.parse(state.cards[c.id].fsrs.due)));
    if(!future.length)return true;
    waiting=true;revealed=false;$('scrSolve').classList.add('sien-waiting');const el=panel();el.hidden=false;counts();
    $('summary').style.display='none';$('cardZone').style.display='none';$('gradeBar').classList.remove('on');
    const due=Math.min(...future.map(dueTime))-LEARN_AHEAD_MS,seconds=Math.max(0,Math.ceil((due-Date.now())/1000));
    $('sienWaitTime').textContent=Math.floor(seconds/60)+'분 '+String(seconds%60).padStart(2,'0')+'초 후';
    syncSessQueue();saveResume();
    timer=setTimeout(()=>{if($('scrSolve').classList.contains('on'))showCard();},Math.min(1000,Math.max(20,due-Date.now())));
    return false;
  }
  // FSRS settings must not replay imported or newly answered SM-2 schedules.
  replayLog=function(){lastRevIdx=null;firstRevIdx=null;todayRateIdx=null;return 0;};
  retrievability=function(){return null;};
  window.SienLearning={next,insert,start,prepare,ready,queued,ahead:c=>ready(c)&&!dueNow(c),get waiting(){return waiting;}};
  for(const id of ['tglReshow','deckOptRetentionRange','retRange','cretRange','xretRange','fwBox','restDow','restDate'])$(id)?.closest('.tgl-row,.field')?.setAttribute('hidden','');
  const note=document.createElement('div');note.className='field';note.innerHTML='<label>복습 방식 · Anki SM-2</label><p class="desc">학습 1분 → 10분 · 재학습 10분<br>졸업 1일 · 쉬움 4일<br>신규·복습은 Anki 방식으로 섞기<br>복습·신규가 끝나면 20분 이내 학습 미리 보기<br>기존 일정과 기록은 보존하며 다음 답변부터 적용합니다.</p>';
  $('retRange')?.closest('.field')?.before(note);
})();

