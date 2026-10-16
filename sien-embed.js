(() => {
  if(new URLSearchParams(location.search).get('embedded')!=='obsidian'||window.parent===window)return;
  document.documentElement.classList.add('sien-embedded');
  // Keep the study tab contained. Authentication uses the site's existing forms.
  window.open=()=>{toast('학습 탭에서는 외부 창을 열지 않습니다.');return null;};
  document.addEventListener('click',e=>{
    const a=e.target.closest?.('a[href]');if(!a)return;
    const u=new URL(a.href,location.href);
    if(u.origin!==location.origin||a.target==='_blank'){e.preventDefault();e.stopImmediatePropagation();toast('학습 탭에서는 외부 사이트로 이동하지 않습니다.');}
  },true);
  window.parent.postMessage({type:'sien-study-ready'},'*');
})();

