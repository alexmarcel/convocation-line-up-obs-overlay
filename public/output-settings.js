"use strict";

(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.OutputSettings=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  const HEX_COLOR=/^#[0-9a-f]{6}$/i;
  function fadeSeconds(value){const number=Number(value);return Number.isFinite(number)?Math.max(0,Math.min(10,number)):0}
  function transitionStyle(value){return["fade","fade-rise","none"].includes(value)?value:"fade"}
  function transitionSeconds(value){const number=Number(value);return Number.isFinite(number)?Math.max(.1,Math.min(3,number)):.5}
  function normalize(settings={}){
    const overlay=Number(settings.projectorBackgroundOverlay);
    return{
      ...settings,
      playAudioOnController:!!settings.playAudioOnController,
      studentTransitionStyle:transitionStyle(settings.studentTransitionStyle),
      studentTransitionSeconds:transitionSeconds(settings.studentTransitionSeconds),
      audioFadeInSeconds:fadeSeconds(settings.audioFadeInSeconds),
      audioFadeOutSeconds:fadeSeconds(settings.audioFadeOutSeconds),
      obsBackgroundMode:settings.obsBackgroundMode==="chroma"?"chroma":"transparent",
      chroma:HEX_COLOR.test(String(settings.chroma||""))?String(settings.chroma).toLowerCase():"#00ff00",
      useProjectorBackground:!!settings.useProjectorBackground,
      projectorBackgroundOverlay:Number.isFinite(overlay)?Math.max(0,Math.min(80,overlay)):35
    };
  }
  function windowTitle(settings={},role="projector",deviceName=""){
    const labels={scanner:"Scanner",projector:"Projector",obs:"OBS"};
    const label=String(deviceName||"").trim()||labels[role]||"Display",eventName=String(settings.eventName||"").trim();
    return eventName?`${eventName} - ${label}`:`Graduation Display - ${label}`;
  }
  function routesAudioTo(settings={},role){return settings.audioTarget==="both"||settings.audioTarget===role}
  return{normalize,windowTitle,routesAudioTo,fadeSeconds,transitionStyle,transitionSeconds};
});
