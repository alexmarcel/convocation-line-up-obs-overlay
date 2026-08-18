"use strict";
(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;else root.AudioFade=api})(typeof globalThis!=="undefined"?globalThis:this,function(){
  const clamp=value=>Math.max(0,Math.min(1,value));
  function volumeAt(currentTime,duration,fadeInSeconds,fadeOutSeconds){const current=Math.max(0,Number(currentTime)||0),total=Number(duration),fadeIn=Math.max(0,Number(fadeInSeconds)||0),fadeOut=Math.max(0,Number(fadeOutSeconds)||0);const inLevel=fadeIn?clamp(current/fadeIn):1,outLevel=fadeOut&&Number.isFinite(total)&&total>=0?clamp((total-current)/fadeOut):1;return Math.min(inLevel,outLevel)}
  return{volumeAt};
});
