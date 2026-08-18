"use strict";

(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.ScannerSearch=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  const normalize=value=>String(value??"").trim().replace(/\s+/g," ").toLowerCase();

  function matchRank(id,student,query){
    const needle=normalize(query),normalizedId=normalize(id),name=normalize(student?.name);
    if(!needle)return null;
    if(normalizedId===needle)return 0;
    if(normalizedId.startsWith(needle))return 1;
    if(name===needle)return 2;
    if(name.startsWith(needle))return 3;
    if(normalizedId.includes(needle)||name.includes(needle))return 4;
    return null;
  }

  function searchStudents(library,query,limit=10){
    if(!library?.students||!Array.isArray(library.order)||!normalize(query))return[];
    const maximum=Math.max(0,Math.trunc(Number(limit)||0));
    return library.order
      .map((id,index)=>({id,student:library.students[id],index,rank:matchRank(id,library.students[id],query)}))
      .filter(result=>result.student&&result.rank!==null)
      .sort((left,right)=>left.rank-right.rank||left.index-right.index)
      .slice(0,maximum)
      .map(({id,student,rank})=>({id,student,rank}));
  }

  return{normalize,matchRank,searchStudents};
});
