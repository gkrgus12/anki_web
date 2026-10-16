(function(root){
  'use strict';
  const tags={y:'mark',g:'mark',b:'strong',i:'em',d:'del',c:'code',a:'a'};
  function render(el,card,side){
    const text=String(side==='f'?(card.front||card.q||''):(card.back||card.a||''));
    el.replaceChildren();el.classList.add('sien-text');
    const ranges=card.sien?.v===1&&Array.isArray(card.sien[side])?card.sien[side].filter(r=>Array.isArray(r)&&Number.isInteger(r[0])&&Number.isInteger(r[1])&&r[0]>=0&&r[1]>0&&r[0]+r[1]<=text.length&&tags[r[2]]):[];
    const points=[...new Set([0,text.length,...ranges.flatMap(r=>[r[0],r[0]+r[1]])])].sort((a,b)=>a-b);
    for(let i=0;i<points.length-1;i++){
      const from=points[i],to=points[i+1];let node=document.createTextNode(text.slice(from,to));
      for(const r of ranges.filter(r=>r[0]<=from&&r[0]+r[1]>=to)){
        const wrapper=document.createElement(tags[r[2]]);
        if(r[2]==='a'){
          try{const u=new URL(r[3]);if(!['https:','http:'].includes(u.protocol))continue;wrapper.href=u.href;wrapper.target='_blank';wrapper.rel='noopener noreferrer';}catch{continue;}
        }
        if(r[2]==='y'||r[2]==='g')wrapper.className=r[2]==='y'?'sien-target':'sien-other';
        wrapper.append(node);node=wrapper;
      }el.append(node);
    }
  }
  root.SienRender={render};
})(globalThis);
