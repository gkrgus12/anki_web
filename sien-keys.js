/* Physical keyboard bindings, per browser. No controller polling or synthetic key input. */
(function(){
  'use strict';
  const KEY='sien-keyboard-v1';
  const actions=[
    ['reveal','정답 보기 / 알맞음',['Space','Enter']],['again','다시',['Digit1','KeyZ']],['hard','어려움',['Digit2','KeyX']],['good','알맞음',['Digit3','KeyC']],['easy','쉬움',['Digit4','KeyV']],
    ['undo','답변 되돌리기',['KeyR']],['bury','내일로 미루기',['Shift+KeyB']],['off','카드 끄기',['KeyQ']],['flag','플래그',['KeyF']],['pause','일시정지 / 재개',['KeyS']],['hint','초성 힌트',['KeyT']],
    ['up','위로 스크롤',['ArrowUp']],['down','아래로 스크롤',['ArrowDown']],['home','홈으로',['KeyH']],['search','카드 검색',['Slash']],['close','닫기 / 나가기',['Escape']],['poke','스터디 알림',['KeyJ']],
    ['flag1','중요 표시',['Ctrl+Digit1']],['flag2','핵심 표시',['Ctrl+Digit2']],['flag3','재확인 표시',['Ctrl+Digit3']],['flag4','보충 표시',['Ctrl+Digit4']]
  ];
  const defaults=()=>Object.fromEntries(actions.map(a=>[a[0],[...a[2]]]));let bindings=defaults(),capture=null;
  try{const saved=JSON.parse(localStorage.getItem(KEY));if(saved?.v===1){const seen=new Set();for(const [id]of actions){const keys=saved.bindings[id];if(Array.isArray(keys)&&keys.every(k=>typeof k==='string'&&!seen.has(k))){bindings[id]=keys;keys.forEach(k=>seen.add(k));}}}}catch{}
  function label(k){return k.replace(/Key([A-Z])/g,'$1').replace(/Digit([0-9])/g,'$1').replace('ArrowUp','↑').replace('ArrowDown','↓').replace('ArrowLeft','←').replace('ArrowRight','→').replace('Slash','/').replace('Escape','Esc').replace('Numpad','Num ');}
  function chord(e){const code=e.code||({ ' ':'Space',Enter:'Enter',Escape:'Escape' }[e.key])||'';return (e.ctrlKey?'Ctrl+':'')+(e.altKey?'Alt+':'')+(e.shiftKey?'Shift+':'')+code;}
  function save(){localStorage.setItem(KEY,JSON.stringify({v:1,bindings}));render();hints();window.SienApp?.capture();}
  function status(t){$('sienKeyStatus').textContent=t;}
  function render(){
    const box=$('keyboardMap');if(!box)return;box.replaceChildren();
    for(const [id,name]of actions){const row=document.createElement('div');row.className='sien-key-row';const text=document.createElement('span');text.textContent=name;const key=document.createElement('kbd');key.textContent=bindings[id].map(label).join(' / ')||'미지정';const btn=document.createElement('button');btn.className='ym-btn ghost';btn.dataset.keyAction=id;btn.textContent=capture===id?'키 입력 대기…':'변경';btn.setAttribute('aria-label',name+' 키 변경');btn.onclick=()=>{capture=capture===id?null:id;render();status(capture?'원하는 키를 누르세요. Esc로 취소합니다.':'');};row.append(text,key,btn);box.append(row);}
  }
  function hints(){for(const [id,el]of [['reveal','revealBtn'],['again','gAgain'],['hard','gHard'],['good','gGood'],['easy','gEasy']]){const k=$(el)?.querySelector('.keycap');if(k)k.textContent=bindings[id].map(label).join(' / ');}}
  function close(){const ovl=document.querySelector('.ovl.show, #ovlHd.show, #ovlImg.show');if(ovl){if(ovl.id==='ovlCard')closeCardSheet();else if(ovl.id==='ovlHd')closeHoedok();else if(ovl.id==='ovlImg')closeImg();else ovl.classList.remove('show');}else if($('rail').classList.contains('open')){$('rail').classList.remove('open');$('railScrim').classList.remove('show');}else{push();go('scrHome');}}
  function handle(e){
    if(e.metaKey)return;
    const key=chord(e),target=e.target,typing=target?.matches?.('input,textarea,select')||target?.isContentEditable;
    if(capture&&$('scrInput').classList.contains('on')){
      e.preventDefault();if(e.repeat)return;
      if(e.code==='Escape'){capture=null;render();status('키 변경을 취소했습니다.');return;}
      if(/^(Control|Alt|Shift|Meta)/.test(e.code)||!e.code)return;
      if((e.ctrlKey&&['KeyR','KeyW','KeyT','KeyL','KeyN','KeyC','KeyV','KeyX','KeyA','KeyF','KeyP','Tab'].includes(e.code))||e.altKey||/^F\d+$/.test(e.code)){status('브라우저에서 사용하는 조합입니다. 다른 키를 선택해 주세요.');return;}
      const owner=actions.find(([id])=>id!==capture&&bindings[id].includes(key));
      if(owner){status(label(key)+' 키는 「'+owner[1]+'」에서 사용 중입니다. 다른 키를 선택해 주세요.');return;}
      const name=actions.find(a=>a[0]===capture)[1];bindings[capture]=[key];capture=null;save();status(name+' → '+label(key)+' 저장됨');return;
    }
    if(typing||!kbdOn)return;
    if(target?.closest?.('#rail')&&['Space','Enter','ArrowLeft','ArrowRight','Home','End'].includes(e.code))return;
    if(target?.closest?.('summary,.sien-source-word')&&['Space','Enter'].includes(e.code))return;
    const action=actions.find(([id])=>bindings[id].includes(key))?.[0];if(!action)return;
    const overlay=document.querySelector('.ovl.show, #ovlHd.show, #ovlImg.show');
    if(overlay&&action!=='close')return;
    if(pauseAt){if(['pause','reveal','close'].includes(action)){e.preventDefault();resumeSession();}return;}
    if(action==='up'||action==='down'){const box=scrollBox();if(box){e.preventDefault();box.scrollBy({top:(action==='up'?-1:1)*Math.max(80,Math.round(box.clientHeight*.42)),behavior:'auto'});}return;}
    if(e.repeat)return;
    if(action==='close'){e.preventDefault();close();return;}
    if(action==='search'){e.preventDefault();go('scrList');$('qSearch').focus();return;}
    if(action==='home'){e.preventDefault();push();go('scrHome');return;}
    if(action==='poke'){e.preventDefault();triggerStudyPoke();return;}
    if(!$('scrSolve').classList.contains('on')||SienLearning.waiting)return;
    e.preventDefault();
    if($('summary').style.display!=='none'){if(action==='reveal')$('smNew')?.click();return;}
    if(action==='reveal'){if(!revealed)reveal();else if(!itemMarks.some(Boolean))rate(3);return;}
    const grade={again:1,hard:2,good:3,easy:4}[action];if(grade){if(!revealed)reveal();else rate(grade);return;}
    if(action==='undo'){if(!tooSoon())doUndo();return;}
    if(action==='bury'){if(!tooSoon())$('rBury').click();return;}
    if(action==='off'){if(!tooSoon())$('rOff').click();return;}
    if(action==='flag'){$('rFlag').click();return;}
    if(action==='pause'){pauseSession();return;}
    if(action==='hint'){if(!revealed)document.querySelector('#hintBox.on .hint-chip:not(.on)')?.click();return;}
    if(/^flag[1-4]$/.test(action)){const c=cur();if(c){toggleFlagType(c,FLAG_TYPES[Number(action.slice(4))-1]);syncRail();}return;}
  }
  $('keyboardReset').onclick=()=>{bindings=defaults();capture=null;save();status('기본 키 배치로 복원했습니다.');};
  window.SienKeys={handle,render,hints,settings:()=>({v:1,bindings:JSON.parse(JSON.stringify(bindings))}),receive(value){if(value?.v!==1||!value.bindings)return;bindings={...defaults(),...value.bindings};localStorage.setItem(KEY,JSON.stringify({v:1,bindings}));render();hints();},cancel(){capture=null;}};render();hints();
})();
