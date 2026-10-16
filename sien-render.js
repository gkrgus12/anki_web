(function(root){
  'use strict';
  const tags={y:'mark',g:'mark',b:'strong',i:'em',d:'del',c:'code',a:'a'};
  function render(el,card,side){
    const text=String(side==='f'?(card.front||card.q||''):(card.back||card.a||''));
    el.replaceChildren();el.classList.add('sien-text');
    const ranges=card.sien?.v===1&&Array.isArray(card.sien[side])?card.sien[side].filter(r=>Array.isArray(r)&&Number.isInteger(r[0])&&Number.isInteger(r[1])&&r[0]>=0&&r[1]>0&&r[0]+r[1]<=text.length&&tags[r[2]]):[];
    const footerAt=side==='b'&&card.sien?.v===1&&Number.isInteger(card.sien.footerStart)&&card.sien.footerStart>=0&&card.sien.footerStart<text.length?card.sien.footerStart:null;
    // v1 exports deliberately compacted Reading/Meaning with a middle-dot separator.
    // Restore those field boundaries in the view only; ranges retain original offsets.
    const blocks=[];
    if(side==='b'&&card.sien?.v===1){
      const end=text.indexOf('\n\n')<0?(footerAt??text.length):text.indexOf('\n\n');
      const head=text.slice(0,end),parts=head.split(' · ');let offset=0;
      for(let n=0;n<parts.length;n++){
        const value=parts[n],isReading=n===0&&/^[\u3040-\u30ff\s・ー〜～()（）\[\]0-9,.、]+$/.test(value);
        blocks.push({start:offset,end:offset+value.length,kind:isReading?'reading':'meaning'});offset+=value.length+3;
      }
    }
    const footer=footerAt===null?null:document.createElement('small');
    if(footer)footer.className='sien-footer';
    const gapAt=blocks.at(-1)?.end,gapEnd=gapAt!==undefined&&text.slice(gapAt,gapAt+2)==='\n\n'?gapAt+2:null;
    const points=[...new Set([0,text.length,...(footer?[footerAt]:[]),...(gapEnd===null?[]:[gapEnd]),...blocks.flatMap(b=>[b.start,b.end]),...ranges.flatMap(r=>[r[0],r[0]+r[1]])])].sort((a,b)=>a-b);
    const elements=new Map();
    for(let i=0;i<points.length-1;i++){
      const from=points[i],to=points[i+1];let node=document.createTextNode(text.slice(from,to));
      for(const r of ranges.filter(r=>r[0]<=from&&r[0]+r[1]>=to)){
        const wrapper=document.createElement(tags[r[2]]);
        if(r[2]==='a'){
          try{const u=new URL(r[3]);if(!['https:','http:'].includes(u.protocol))continue;wrapper.href=u.href;wrapper.target='_blank';wrapper.rel='noopener noreferrer';}catch{continue;}
        }
        if(r[2]==='y'||r[2]==='g')wrapper.className=r[2]==='y'?'sien-target':'sien-other';
        wrapper.append(node);node=wrapper;
      }
      const block=blocks.find(b=>from>=b.start&&to<=b.end);
      if(block){let section=elements.get(block);if(!section){section=document.createElement('span');section.className='sien-'+block.kind;elements.set(block,section);el.append(section);}section.append(node);}
      else if(blocks.some(b=>from===b.end)&&text.slice(from,to)===' · '){const sep=document.createElement('span');sep.className='sien-field-separator';sep.textContent='\n';el.append(sep);}
      else if(gapEnd!==null&&from===gapAt&&to===gapEnd){const gap=document.createElement('span');gap.className='sien-section-gap';gap.append(node);el.append(gap);}
      else if(footer&&from>=footerAt){if(!footer.parentNode)el.append(footer);footer.append(node);}else el.append(node);
    }
  }
  root.SienRender={render};
})(globalThis);
