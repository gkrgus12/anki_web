/* Received pokes have their own durable, non-modal inbox instead of an 1.8s toast. */
(function(){
  'use strict';
  const key=()=>SC.auth?.user_id?'sien-pokes-v1:'+SC.auth.user_id:null;
  function read(){try{return JSON.parse(localStorage.getItem(key())||'[]');}catch{return [];}}
  function save(rows){localStorage.setItem(key(),JSON.stringify(rows.slice(-40)));}
  function render(){
    if(!key()){$('sienPokeNotice')?.remove();return;}
    if(document.visibilityState!=='visible')return;
    let el=$('sienPokeNotice');const rows=read().filter(r=>!r.read);
    if(!rows.length){el?.remove();return;}
    if(!el){el=document.createElement('aside');el.id='sienPokeNotice';el.setAttribute('aria-label','받은 찌르기');el.setAttribute('role','status');el.setAttribute('aria-live','polite');el.addEventListener('click',e=>e.stopPropagation());document.body.append(el);}
    el.replaceChildren();const head=document.createElement('div');head.className='sien-poke-head';const title=document.createElement('strong');title.textContent='받은 찌르기 · '+rows.length;const close=document.createElement('button');close.className='btn-ghost';close.textContent='확인';close.setAttribute('aria-label','찌르기 알림 확인');close.onclick=()=>{save(read().map(r=>({...r,read:true})));render();};head.append(title,close);el.append(head);
    for(const r of rows.slice(-5)){const line=document.createElement('p');line.textContent=(r.name||'스터디 친구')+'님이 콕 찔렀어요';el.append(line);}
  }
  async function receive(){
    render();
    if(!SC.auth||!SC.group||scPokeBusy||Date.now()<scPokeOff||document.visibilityState!=='visible'||!document.hasFocus())return;
    scPokeBusy=true;
    try{
      const rows=await scAuthed(tok=>scReq('POST','/rest/v1/rpc/fetch_my_pokes',{token:tok,body:{target_group:SC.group.id}}))||[];
      if(!Array.isArray(rows))throw new Error('찌르기 응답 형식 오류');
      const inbox=read(),seen=new Set(inbox.map(r=>r.id));let added=0;
      for(const r of rows){if(!r?.from_user)continue;const id=String(r.id||r.from_user+':'+r.created_at);if(seen.has(id))continue;seen.add(id);const member=(SC.members||[]).find(m=>m.user_id===r.from_user);inbox.push({id,from:r.from_user,name:member?.display_name||'스터디 친구',at:r.created_at||new Date().toISOString(),read:false});added++;}
      if(added){save(inbox);render();try{navigator.vibrate?.(80);}catch{}}
    }catch(e){if(scPokeGone(e))scPokeOff=Date.now()+60000;else console.warn('[스터디] 찌르기 수신을 다음 연결에서 다시 확인합니다.');}
    finally{scPokeBusy=false;}
  }
  scPokeFetch=receive;
  setInterval(receive,5000);
  window.addEventListener('focus',()=>{render();receive();});
  window.addEventListener('storage',e=>{if(e.key===key())render();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){render();receive();}});
  window.addEventListener('DOMContentLoaded',render);
})();
