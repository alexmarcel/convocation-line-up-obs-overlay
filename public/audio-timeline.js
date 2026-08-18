"use strict";
(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;else root.AudioTimeline=api})(typeof globalThis!=="undefined"?globalThis:this,function(){
  const formatTime=value=>{const seconds=Math.max(0,Math.floor(Number(value)||0));return`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`};
  const progress=(current,duration)=>Number.isFinite(duration)&&duration>0?Math.max(0,Math.min(100,current/duration*100)):0;
  class Timeline{
    constructor(root){this.root=root;this.fill=root.querySelector("[data-audio-timeline-fill]");this.label=root.querySelector("[data-audio-timeline-label]");this.audio=null;this.frame=null;this.generation=0}
    stop(){this.generation++;if(this.frame)cancelAnimationFrame(this.frame);this.frame=null;if(this.audio){this.audio.pause();this.audio.removeAttribute("src");this.audio.load();this.audio=null}}
    set(kind,text,width=0){this.root.className=`audio-timeline ${kind}`;this.root.hidden=false;this.label.textContent=text;this.fill.style.width=`${width}%`}
    unavailable(){this.stop();this.set("unavailable","No published audio",0)}
    reset(){this.stop();this.root.hidden=true;this.fill.style.width="0%"}
    async play(url){
      if(!url)return this.unavailable();
      this.stop();const generation=this.generation,audio=new Audio(url);this.audio=audio;audio.muted=true;audio.preload="auto";this.set("loading","Loading audio timeline...",0);
      const tick=()=>{if(generation!==this.generation||this.audio!==audio)return;const width=progress(audio.currentTime,audio.duration);this.set(audio.ended?"complete":"playing",`${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`,width);if(!audio.ended)this.frame=requestAnimationFrame(tick)};
      audio.onerror=()=>{if(generation===this.generation)this.unavailable()};
      try{await audio.play();if(generation===this.generation)tick()}catch{if(generation===this.generation)this.set("unavailable","Audio timeline unavailable",0)}
    }
  }
  return{Timeline,formatTime,progress};
});
