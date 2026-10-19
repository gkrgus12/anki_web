/* Personal additions on top of the shared fork: inline daily limits per deck and
   today-only boosts. Loads last. Upstream files are wrapped, never edited.
   Pure helpers are exported for Node tests; install() wires the browser. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.SienMine=api;if(typeof document!=='undefined')api.install(root);}})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const MAX={newLimit:9999,reviewLimit:99999},STEP={newLimit:5,reviewLimit:50},BOOST='deckBoost',OPEN_KEY='sien-mine-open-decks-v1';
  const key=(...parts)=>JSON.stringify(parts),copy=x=>JSON.parse(JSON.stringify(x));
  const leaf=name=>String(name||'').split('::').pop();

  // Empty input keeps the current value. Negative -> 0, fractions floor, oversized -> cap.
  function clampLimit(value,current,max){
    if(value===''||value===null||value===undefined)return current;
    const n=Math.floor(Number(value));
    if(!Number.isFinite(n))return current;
    return Math.min(max,Math.max(0,n));
  }
  // A stored boost applies only on the study day it was created (Asia/Seoul 04:00 boundary).
  function normalizeBoost(value,day){
    if(!value||typeof value!=='object'||value.day!==day)return null;
    const n=clampLimit(value.new,0,MAX.newLimit),r=clampLimit(value.review,0,MAX.reviewLimit);
    return n||r?{day,new:n,review:r}:null;
  }
  function effective(base,boost){
    const out={...base,boost:null};
    if(boost){
      out.newLimit=Math.min(MAX.newLimit,Math.max(0,base.newLimit)+boost.new);
      out.reviewLimit=Math.min(MAX.reviewLimit,Math.max(0,base.reviewLimit)+boost.review);
      out.boost={new:boost.new,review:boost.review};
    }
    return out;
  }
  function summary(opts,deck,defaults){
    const src=opts.isInherited?`상위 '${leaf(opts.inheritedFrom)}' 설정 상속`:opts.isCustom?`덱 '${leaf(deck?.name)}' 설정`:`기본값 ${defaults.newLimit}/${defaults.reviewLimit}`;
    let s=`신규 ${opts.newLimit} · 복습 ${opts.reviewLimit} — ${src}`;
    if(opts.boost){const parts=[];if(opts.boost.new)parts.push('신규 +'+opts.boost.new);if(opts.boost.review)parts.push('복습 +'+opts.boost.review);if(parts.length)s+=', 오늘 '+parts.join(' · ');}
    return s;
  }
  // Imported Anki notes carry [sound:file.mp3] markers the web app cannot play; hide them in the note box.
  const SOUND=/\s*\[sound:[^\]]*\]/gi;
  function stripSound(text){return String(text??'').replace(SOUND,'').trim();}
  // Plain (non-plugin) cards are French on the front and Korean on the back.
  function frontLang(card){return card?.sien?.v===1?null:'fr';}
  // Same test upstream uses for its 15px standalone offset; exposed as a class so CSS can target the home-screen app.
  function standalone(nav,mm){return !!(nav?.standalone||mm?.('(display-mode: standalone)')?.matches);}
  function queueGrew(before,after){const had=new Set(before||[]);return (after||[]).some(id=>!had.has(id));}
  // The only place limits are computed stays deckDailyPlan. While it runs, the deck it was
  // called for sees its today-only boost through getDeckOptions; every other caller
  // (options modal, other decks, inheritance lookups) keeps the stored base values.
  function wrapPlanning(env){
    let target=null;
    function getDeckOptions(deck){
      const base=env.options(deck);
      if(target===null||!deck||deck.id!==target)return base;
      return effective(base,env.boost(deck.id));
    }
    function deckDailyPlan(deck,includeChildren){
      const previous=target;target=deck?.id??null;
      try{return includeChildren===undefined?env.plan(deck):env.plan(deck,includeChildren);}finally{target=previous;}
    }
    return {deckDailyPlan,getDeckOptions,base:env.options};
  }

  function install(g){
    const Sess=g.SienSessions,$=id=>document.getElementById(id);
    if(!Sess||typeof g.deckDailyPlan!=='function'||typeof g.getDeckOptions!=='function'||typeof g.renderDeckHub!=='function'){console.warn('[mine] 한도 조절을 설치하지 못했습니다. 상위 모듈이 먼저 로드되어야 합니다.');return;}
    const defaults=()=>{try{return DEFAULT_DECK_OPTS;}catch{return {newLimit:40,reviewLimit:400};}};
    let boosts=new Map();
    const today=()=>g.todayKey();
    const todayBoost=id=>normalizeBoost(boosts.get(String(id)),today());
    const planning=wrapPlanning({plan:g.deckDailyPlan,options:g.getDeckOptions,boost:todayBoost});
    g.deckDailyPlan=planning.deckDailyPlan;g.getDeckOptions=planning.getDeckOptions;

    // Shared through the existing LWW journal under the setting namespace; no new transport.
    const origSnapshot=Sess.snapshot,origReceive=Sess.receive;
    Sess.snapshot=function(){
      const out=origSnapshot.apply(this,arguments);
      for(const [id,value]of boosts)out.values[key('setting',BOOST,id)]=value===undefined?null:copy(value);
      return out;
    };
    Sess.receive=function(){
      const r=origReceive.apply(this,arguments);
      boosts=new Map();
      for(const [k,v]of Object.entries(Sess.shared.values)){const p=JSON.parse(k);if(p[0]==='setting'&&p[1]===BOOST&&p.length===3)boosts.set(p[2],v);}
      return r;
    };

    let open=new Set();
    try{open=new Set(JSON.parse(localStorage.getItem(OPEN_KEY)||'[]'));}catch{}
    const rememberOpen=()=>{try{localStorage.setItem(OPEN_KEY,JSON.stringify([...open]));}catch{}};

    function setBase(deck,field,value){
      const base=planning.base(deck),next=clampLimit(value,base[field],MAX[field]);
      if(next===base[field])return false;
      deck.opts={newLimit:base.newLimit,reviewLimit:base.reviewLimit,retention:base.retention,[field]:next};
      g.saveUserDecks();refresh();return true;
    }
    function setBoost(deck,field,value){
      const current=todayBoost(deck.id)||{day:today(),new:0,review:0},name=field==='newLimit'?'new':'review';
      const next=clampLimit(value,current[name],MAX[field]);
      if(next===current[name])return false;
      const value2={...current,day:today(),[name]:next};
      boosts.set(String(deck.id),value2.new||value2.review?value2:null);
      g.SienApp?.capture();refresh();return true;
    }
    function clearBoost(deck){if(!todayBoost(deck.id))return;boosts.set(String(deck.id),null);g.SienApp?.capture();refresh();}

    // Home tile, deck rows, start/resume buttons and session rows all derive from deckDailyPlan.
    function refresh(){
      try{_dueParts=null;}catch{}
      g.renderDeckHub();g.renderHome();
    }
    // When a deck session's remaining queue gains cards (a raised limit, a boost, another
    // device's change), the next resume mixes them in like a fresh start instead of
    // appending them after every review. Shrinking keeps the stored order.
    const origResume=g.refreshDeckResume;
    if(typeof origResume==='function')g.refreshDeckResume=function(sx){
      const before=Array.isArray(sx?.q)?sx.q.slice():[];
      const r=origResume.apply(this,arguments);
      if(sx?.sienDeckId&&queueGrew(before,sx.q)){delete sx.sienOrder;delete sx.sienOrderDay;delete sx.sienMixDay;}
      return r;
    };

    function stepper(kind,field,label,value){
      return `<label class="mine-step" data-kind="${kind}" data-field="${field}"><span class="mine-step-name">${label}</span>`+
        `<button type="button" class="mine-step-btn" data-d="-1" aria-label="${label} ${kind==='boost'?'오늘만 추가':'기본 한도'} 줄이기">−</button>`+
        `<input type="number" inputmode="numeric" min="0" max="${MAX[field]}" step="1" value="${value}" aria-label="${label} ${kind==='boost'?'오늘만 추가':'기본 한도'}">`+
        `<button type="button" class="mine-step-btn" data-d="1" aria-label="${label} ${kind==='boost'?'오늘만 추가':'기본 한도'} 늘리기">+</button></label>`;
    }
    function buildPanel(deck,stats){
      const base=planning.base(deck),boost=todayBoost(deck.id)||{new:0,review:0};
      const panel=document.createElement('div');panel.className='mine-limit-panel';panel.dataset.deckId=deck.id;
      panel.innerHTML=`<div class="mine-limit-grid">
        <span class="mine-lbl">기본 한도</span>${stepper('base','newLimit','신규',base.newLimit)}${stepper('base','reviewLimit','복습',base.reviewLimit)}
        <span class="mine-lbl">오늘만 추가</span>${stepper('boost','newLimit','신규',boost.new)}${stepper('boost','reviewLimit','복습',boost.review)}
      </div>
      <div class="mine-limit-foot"><span>오늘 푼 신규 ${stats.studiedNew}장 · 복습 ${stats.studiedReview}장 · 오늘만 추가는 04:00에 사라져요</span>
        <button type="button" class="btn-ghost mine-boost-clear"${boost.new||boost.review?'':' disabled'}>오늘만 취소</button></div>`;
      panel.addEventListener('click',e=>{
        e.stopPropagation();
        if(e.target.closest('.mine-boost-clear')){clearBoost(deck);return;}
        const btn=e.target.closest('.mine-step-btn');if(!btn)return;
        const step=btn.closest('.mine-step'),input=step.querySelector('input'),field=step.dataset.field;
        const current=clampLimit(input.value,0,MAX[field]),next=current+Number(btn.dataset.d)*STEP[field];
        (step.dataset.kind==='boost'?setBoost:setBase)(deck,field,Math.max(0,next));
      });
      panel.addEventListener('change',e=>{
        // Chrome re-fires change when a dirty input is detached by a rebuild; that one is stale.
        const input=e.target.closest('input');if(!input||!input.isConnected||rebuilding)return;
        const step=input.closest('.mine-step');
        if(!(step.dataset.kind==='boost'?setBoost:setBase)(deck,step.dataset.field,input.value))decorate(true);
      });
      panel.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('input')){e.preventDefault();e.target.blur();}e.stopPropagation();});
      return panel;
    }
    let rebuilding=false;
    function decorate(force){
      const area=$('deckListArea');if(!area||rebuilding)return;
      rebuilding=true;try{paint(area,force);}finally{rebuilding=false;}
    }
    function paint(area,force){
      const byName=new Map(DECKS.filter(d=>d&&d.name).map(d=>[d.name,d]));
      for(const row of area.querySelectorAll('.deck-tree-row')){
        const deck=byName.get(row.dataset.deckName);if(!deck)continue;
        const info=row.querySelector('.deck-info');if(!info)continue;
        if(force){row.querySelector('.mine-limit-line')?.remove();const old=row.nextElementSibling;if(old?.matches?.('.mine-limit-panel'))old.remove();}
        if(row.querySelector('.mine-limit-line'))continue;
        const stats=g.getDeckStats(deck,true),isOpen=open.has(deck.id);
        const line=document.createElement('button');line.type='button';line.className='mine-limit-line';
        line.textContent=summary(stats.opts,deck,defaults());
        line.title='한도 조절 열기/닫기';line.setAttribute('aria-expanded',String(isOpen));
        line.onclick=e=>{e.stopPropagation();if(open.has(deck.id))open.delete(deck.id);else open.add(deck.id);rememberOpen();decorate(true);};
        info.append(line);
        row.classList.toggle('mine-open',isOpen);
        if(isOpen)row.after(buildPanel(deck,stats));
      }
    }
    const origHub=g.renderDeckHub;
    g.renderDeckHub=function(){const r=origHub.apply(this,arguments);try{decorate();}catch(e){console.warn('[mine] 한도 패널을 그리지 못했습니다.',e);}return r;};
    if($('deckListArea')?.querySelector('.deck-tree-row'))try{decorate();}catch{}
    g.SienMine.boosts=()=>new Map(boosts);

    // Theme segment: "기기 설정" cannot fit a 60px cell on one line; the shorter label keeps the same data-th and tooltip.
    const auto=document.querySelector('#themeSeg [data-th="auto"]');if(auto&&auto.textContent.trim()==='기기 설정')auto.textContent='자동';
    // Phone tab bar: upstream keeps it inside the home screen, so it vanished on 탐색/통계. Moving it to #main
    // keeps every handler (same elements) and lets CSS show it on the sub screens; the active tab follows go().
    const phone=()=>matchMedia('(max-width: 759px)').matches;
    const tabBar=$('tabBar'),main=$('main');
    if(tabBar&&main&&!main.contains(tabBar)===false&&tabBar.parentElement!==main)main.append(tabBar);
    const settings=$('ovlSettings');
    const settingsOpen=()=>!!settings?.classList.contains('show');
    function markTabs(id){
      for(const [tab,screen]of [['tabToday','scrHome'],['tabCards','scrList'],['tabStats','scrStats']])$(tab)?.classList.toggle('on',id===screen&&!settingsOpen());
      $('tabSetup')?.classList.toggle('on',settingsOpen());
    }
    const origGo=g.go;
    if(typeof origGo==='function'&&tabBar)g.go=function(id){
      if(phone()&&settingsOpen()){settings.classList.remove('show','page');}   // another tab closes the settings page
      const r=origGo.apply(this,arguments);
      try{markTabs(id);}catch{}
      return r;
    };
    // Settings opens as a full page on phones: upstream's page mode (sidebar layout) with the tab bar kept on top.
    const btnSettings=$('btnSettings');
    if(btnSettings&&settings){
      const origOpen=btnSettings.onclick;
      btnSettings.onclick=function(){
        const r=origOpen?.apply(this,arguments);
        if(phone()){settings.classList.add('page');settings.style.setProperty('--set-left','0px');settings.style.setProperty('--set-top','0px');settings.scrollTop=0;settings.querySelector('.sheet')?.scrollTo?.(0,0);}
        try{markTabs(document.querySelector('.scr.on')?.id);}catch{}
        return r;
      };
      // The 설정 tab used to open the Gist modal; that stays reachable from the page's GitHub 연결 button.
      // Upstream assigns this tab's onclick later during init, so a capturing listener takes it over.
      $('tabSetup')?.addEventListener('click',e=>{e.stopImmediatePropagation();if(settingsOpen()){settings.classList.remove('show','page');markTabs(document.querySelector('.scr.on')?.id);return;}btnSettings.click();},true);
      for(const id of ['setClose','setCloseX'])$(id)?.addEventListener('click',()=>setTimeout(()=>markTabs(document.querySelector('.scr.on')?.id),0));
    }
    const mark=()=>{
      const on=standalone(navigator,q=>matchMedia(q));document.documentElement.classList.toggle('sien-standalone',on);
      // iOS 26 keeps part of the screen below the web-app viewport; expose that gap so bottom bars do not pad twice.
      const gap=on&&innerHeight>innerWidth?Math.max(0,(screen?.height||0)-innerHeight):0;
      document.documentElement.style.setProperty('--viewport-gap',Math.round(gap)+'px');
    };
    mark();try{matchMedia('(display-mode: standalone)').addEventListener('change',mark);}catch{}
    addEventListener('resize',mark);addEventListener('orientationchange',mark);

    // lang=fr on the question so Safari hyphenates, quotes and reads it as French; plugin cards keep SienRender's lang.
    const origShow=g.showCard;
    if(typeof origShow==='function')g.showCard=function(){
      const r=origShow.apply(this,arguments);
      try{const lang=frontLang(g.cur()),el=$('cFront');if(el&&lang)el.lang=lang;}catch{}
      return r;
    };
    function cleanNote(){
      const n=$('cNote');if(!n||!n.classList.contains('on'))return;
      const walker=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);let node,changed=false;
      while((node=walker.nextNode())){if(SOUND.test(node.textContent)){node.textContent=stripSound(node.textContent);changed=true;}SOUND.lastIndex=0;}
      if(changed&&!stripSound(n.textContent.replace(/^보충/,'')))n.classList.remove('on');
    }
    for(const name of ['fillBack','reveal']){
      const orig=g[name];if(typeof orig!=='function')continue;
      g[name]=function(){const r=orig.apply(this,arguments);try{cleanNote();}catch{}return r;};
    }
  }
  return {MAX,STEP,BOOST,clampLimit,normalizeBoost,effective,summary,queueGrew,stripSound,frontLang,standalone,wrapPlanning,install};
});
