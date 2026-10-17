(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SienQueue=factory();})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  // Anki v3 Intersperser behavior: (one length + 1) / (two length + 1),
  // float32 comparisons and ties from the first queue. See README source reference.
  function interleave(one,two){
    const out=[],ratio=Math.fround((one.length+1)/(two.length+1));let a=0,b=0;
    while(a<one.length&&b<two.length){
      if(Math.fround(Math.fround(b+1)*ratio)<Math.fround(a+1))out.push(two[b++]);
      else out.push(one[a++]);
    }
    return out.concat(one.slice(a),two.slice(b));
  }
  function mix(cards,kind){
    const learning=[],interday=[],reviews=[],fresh=[];
    for(const c of cards){const k=kind(c);(k==='learning'?learning:k==='interday'?interday:k==='new'?fresh:reviews).push(c);}
    // Anki merges interday learning into reviews first, then merges new cards.
    return [...learning,...interleave(interleave(reviews,interday),fresh)];
  }
  return {mix,interleave};
});
