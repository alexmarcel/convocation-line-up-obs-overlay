"use strict";
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.CachePolicy=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  function storeForKind(kind){return kind==="backgrounds"?"settings":kind}
  function keyForAsset(kind,hash){return kind==="backgrounds"?`background:${hash}`:hash}
  function isAssetKey(kind,key){return kind==="backgrounds"&&String(key).startsWith("background:")}
  function kindsForRole(role){return role==="scanner"?["thumbnails"]:role==="projector"?["photos","audio","backgrounds"]:role==="obs"?["photos","audio"]:[]}
  function manifestKeyForRole(role){return `activeManifest:${["scanner","projector","obs"].includes(role)?role:"display"}`}
  return{storeForKind,keyForAsset,isAssetKey,kindsForRole,manifestKeyForRole};
});
