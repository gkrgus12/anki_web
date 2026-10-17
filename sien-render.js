(function(root){
  'use strict';
  const tags={y:'mark',g:'mark',b:'strong',i:'em',d:'del',c:'code',a:'a'};
  // Only structural metadata is accepted, never HTML from a synced note.
  function validBlocks(blocks,limit){
    let count=0;
    function check(items,lo,hi,depth){
      if(!Array.isArray(items)||depth>24)return false;
      let end=lo;
      for(const b of items){
        if(++count>5000||!b||!['callout','quote','paragraph','heading','list','item'].includes(b.kind)||!Number.isInteger(b.start)||!Number.isInteger(b.end)||b.start<end||b.end<b.start||b.end>hi)return false;
        if(b.kind==='callout'&&(!Number.isInteger(b.titleEnd)||b.titleEnd<b.start||b.titleEnd>b.end))return false;
        if(b.children&&!check(b.children,b.titleEnd??b.start,b.end,depth+1))return false;
        end=b.end;
      }
      return true;
    }
    return Array.isArray(blocks)&&blocks.length&&check(blocks,0,limit,0)?blocks:[];
  }
  function inlineNodes(parent,text,ranges,lo,hi){
    const active=ranges.filter(r=>r[0]<hi&&r[0]+r[1]>lo);
    const points=[...new Set([lo,hi,...active.flatMap(r=>[Math.max(lo,r[0]),Math.min(hi,r[0]+r[1])])])].sort((a,b)=>a-b);
    for(let i=0;i<points.length-1;i++){
      const from=points[i],to=points[i+1];let node=document.createTextNode(text.slice(from,to));
      for(const r of active.filter(r=>r[0]<=from&&r[0]+r[1]>=to)){
        const wrapper=document.createElement(tags[r[2]]);
        if(r[2]==='a'){
          try{const u=new URL(r[3]);if(!['https:','http:'].includes(u.protocol))continue;wrapper.href=u.href;wrapper.target='_blank';wrapper.rel='noopener noreferrer';}catch{continue;}
        }
        if(r[2]==='y'||r[2]==='g')wrapper.className=r[2]==='y'?'sien-target':'sien-other';
        wrapper.append(node);node=wrapper;
      }
      parent.append(node);
    }
  }
  function explanation(parent,items,text,ranges,lo,hi){
    let at=lo;
    for(const b of items){
      inlineNodes(parent,text,ranges,at,b.start);
      const folded=b.kind==='callout'&&['-','+'].includes(b.fold);
      const tag=folded?'details':({callout:'section',quote:'blockquote',paragraph:'p',heading:'h4',list:b.ordered?'ol':'ul',item:'li'})[b.kind];
      const el=document.createElement(tag);el.className='sien-note-'+b.kind;
      if(b.kind==='list'&&b.ordered&&Number.isInteger(b.startNumber)&&b.startNumber>0)el.start=b.startNumber;
      let content=el,start=b.start;
      if(b.kind==='callout'){
        const type=String(b.type||'note').toLowerCase();
        el.dataset.tone=/^(tip|hint|important|success|check|done)$/.test(type)?'tip':/^(warning|caution|attention|danger|error|bug|failure|fail|missing)$/.test(type)?'warning':/^(quote|cite)$/.test(type)?'quote':'note';
        if(folded)el.open=b.fold==='+';
        const title=document.createElement(folded?'summary':'div');title.className='sien-callout-title';
        inlineNodes(title,text,ranges,b.start,b.titleEnd);el.append(title);
        content=document.createElement('div');content.className='sien-callout-body';el.append(content);start=b.titleEnd;
      }
      if(b.children)explanation(content,b.children,text,ranges,start,b.end);else inlineNodes(content,text,ranges,start,b.end);
      parent.append(el);at=b.end;
    }
    inlineNodes(parent,text,ranges,at,hi);
  }
  function render(el,card,side){
    const text=String(side==='f'?(card.front||card.q||''):(card.back||card.a||''));
    el.replaceChildren();el.classList.add('sien-text');
    // Managed Obsidian cards have Japanese questions; Korean answers retain their own wrapping.
    if(side==='f'&&card.sien?.v===1)el.lang='ja';else el.removeAttribute('lang');
    const ranges=card.sien?.v===1&&Array.isArray(card.sien[side])?card.sien[side].filter(r=>Array.isArray(r)&&Number.isInteger(r[0])&&Number.isInteger(r[1])&&r[0]>=0&&r[1]>0&&r[0]+r[1]<=text.length&&tags[r[2]]):[];
    const footerAt=side==='b'&&card.sien?.v===1&&Number.isInteger(card.sien.footerStart)&&card.sien.footerStart>=0&&card.sien.footerStart<text.length?card.sien.footerStart:null;
    const notes=side==='b'&&card.sien?.v===1?validBlocks(card.sien.blocks,footerAt??text.length):[];
    const notesStart=notes[0]?.start,notesEnd=notes.at(-1)?.end;
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
    const points=[...new Set([0,text.length,...(notes.length?[notesStart,notesEnd]:[]),...(footer?[footerAt]:[]),...(gapEnd===null?[]:[gapEnd]),...blocks.flatMap(b=>[b.start,b.end]),...ranges.flatMap(r=>[r[0],r[0]+r[1]])])].sort((a,b)=>a-b);
    const elements=new Map();
    for(let i=0;i<points.length-1;i++){
      const from=points[i],to=points[i+1];
      if(notes.length&&from>=notesStart&&to<=notesEnd){
        if(from===notesStart){const section=document.createElement('div');section.className='sien-note-explanation';explanation(section,notes,text,ranges,notesStart,notesEnd);el.append(section);}continue;
      }
      const node=document.createDocumentFragment();inlineNodes(node,text,ranges,from,to);
      const block=blocks.find(b=>from>=b.start&&to<=b.end);
      if(block){let section=elements.get(block);if(!section){section=document.createElement('span');section.className='sien-'+block.kind;elements.set(block,section);el.append(section);}section.append(node);}
      else if(blocks.some(b=>from===b.end)&&text.slice(from,to)===' · '){const sep=document.createElement('span');sep.className='sien-field-separator';sep.textContent='\n';el.append(sep);}
      else if(gapEnd!==null&&from===gapAt&&to===gapEnd){const gap=document.createElement('span');gap.className='sien-section-gap';gap.append(node);el.append(gap);}
      else if(footer&&from>=footerAt){if(!footer.parentNode)el.append(footer);footer.append(node);}else el.append(node);
    }
  }
  root.SienRender={render};
})(globalThis);
