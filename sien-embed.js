(() => {
  if(new URLSearchParams(location.search).get('embedded')!=='obsidian'||window.parent===window)return;
  document.documentElement.classList.add('sien-embedded');
  let host=null,pending=null;
  // Keep the study tab contained. Only the parent plugin can open a linked note.
  window.open=()=>{toast('학습 탭에서는 외부 창을 열지 않습니다.');return null;};
  const nativeRender=SienRender.render;
  function decorate(el,card,side){
    if(!host||side!=='f'||el.id!=='cFront'||card.sien?.v!==1||el.querySelector('.sien-source-word'))return;
    const title=String(card.front||card.q||'').split('\n')[0];
    if(!title||!card.id)return;
    const range=document.createRange();range.setStart(el,0);
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let left=title.length,node;
    while((node=walker.nextNode())){if(left<=node.length){range.setEnd(node,left);break;}left-=node.length;}
    if(!node)return;
    const button=document.createElement('button');button.type='button';button.className='sien-source-word';button.dataset.cardId=card.id;
    button.title=host.mobile?'이 기기의 원본 노트 편집 · 상단 학습 버튼으로 돌아오기':'Obsidian 원본 노트를 별도 탭에서 편집';
    button.setAttribute('aria-label',title+' — Obsidian 원본 편집');
    const word=document.createElement('span');word.className='sien-source-title';word.append(range.extractContents());
    const hint=document.createElement('span');hint.className='sien-source-hint';hint.textContent='원본 편집';hint.setAttribute('aria-hidden','true');
    button.append(word,hint);range.insertNode(button);
  }
  SienRender.render=(el,card,side)=>{nativeRender(el,card,side);decorate(el,card,side);};
  function resumeOwnPause(){if(pending?.paused&&pauseAt)resumeSession();pending=null;if(document.activeElement?.matches('.sien-source-word'))document.activeElement.blur();}
  document.addEventListener('click',e=>{
    const button=e.target.closest?.('.sien-source-word');
    if(button){
      e.preventDefault();e.stopImmediatePropagation();
      if(pending||!host)return;
      const card=cur();if(!card||card.id!==button.dataset.cardId)return;
      pending={requestId:crypto.randomUUID(),cardId:card.id,paused:!pauseAt};
      if(pending.paused)pauseSession();
      parent.postMessage({type:'sien-open-note',requestId:pending.requestId,cardId:card.id},host.origin==='null'?'*':host.origin);
      return;
    }
    const a=e.target.closest?.('a[href]');if(!a)return;
    const u=new URL(a.href,location.href);
    if(u.origin!==location.origin||a.target==='_blank'){e.preventDefault();e.stopImmediatePropagation();toast('학습 탭에서는 외부 사이트로 이동하지 않습니다.');}
  },true);
  window.addEventListener('message',async event=>{
    if(event.source!==parent)return;
    const d=event.data;
    if(d?.type==='sien-study-host'&&d.sourceEditing===true){
      host={origin:event.origin,mobile:d.mobile===true};
      const c=cur();if(c)decorate($('cFront'),c,'f');return;
    }
    if(!host||event.origin!==host.origin)return;
    if(d?.type==='sien-note-result'&&d.requestId===pending?.requestId&&d.status==='error'){
      resumeOwnPause();toast(d.message||'원본 노트를 열지 못했습니다.');return;
    }
    if(d?.type==='sien-note-returned'&&d.requestId===pending?.requestId){resumeOwnPause();return;}
    if(d?.type==='sien-note-refresh'){
      await SienApp.sync();
      const c=cur();if(c?.id===d.cardId&&c.sien?.v===1&&$('scrSolve').classList.contains('on')){
        SienRender.render($('cFront'),c,'f');fillBack(c);
      }
    }
  });
  parent.postMessage({type:'sien-study-ready'},'*');
})();

