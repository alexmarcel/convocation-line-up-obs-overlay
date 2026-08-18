"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {normalize,windowTitle,routesAudioTo}=require("../src/output-settings");

test("OBS output settings preserve supported modes and colors",()=>{
  assert.deepEqual(normalize({obsBackgroundMode:"chroma",chroma:"#12ABef"}),{playAudioOnController:false,studentTransitionStyle:"fade",studentTransitionSeconds:.5,audioFadeInSeconds:0,audioFadeOutSeconds:0,obsBackgroundMode:"chroma",chroma:"#12abef",useProjectorBackground:false,projectorBackgroundOverlay:35});
  assert.deepEqual(normalize({obsBackgroundMode:"transparent",chroma:"#0000ff"}),{playAudioOnController:false,studentTransitionStyle:"fade",studentTransitionSeconds:.5,audioFadeInSeconds:0,audioFadeOutSeconds:0,obsBackgroundMode:"transparent",chroma:"#0000ff",useProjectorBackground:false,projectorBackgroundOverlay:35});
});

test("OBS output settings safely default invalid or legacy values",()=>{
  assert.deepEqual(normalize({}),{playAudioOnController:false,studentTransitionStyle:"fade",studentTransitionSeconds:.5,audioFadeInSeconds:0,audioFadeOutSeconds:0,obsBackgroundMode:"transparent",chroma:"#00ff00",useProjectorBackground:false,projectorBackgroundOverlay:35});
  assert.deepEqual(normalize({obsBackgroundMode:"other",chroma:"green"}),{playAudioOnController:false,studentTransitionStyle:"fade",studentTransitionSeconds:.5,audioFadeInSeconds:0,audioFadeOutSeconds:0,obsBackgroundMode:"transparent",chroma:"#00ff00",useProjectorBackground:false,projectorBackgroundOverlay:35});
});
test("controller audio output is an independent boolean setting",()=>{assert.equal(normalize({playAudioOnController:true,audioTarget:"none"}).playAudioOnController,true);assert.equal(normalize({playAudioOnController:0}).playAudioOnController,false)});
test("audio fade settings accept decimals and clamp to zero through ten seconds",()=>{
  assert.equal(normalize({audioFadeInSeconds:.5}).audioFadeInSeconds,.5);
  assert.equal(normalize({audioFadeOutSeconds:99}).audioFadeOutSeconds,10);
  assert.equal(normalize({audioFadeInSeconds:-2}).audioFadeInSeconds,0);
  assert.equal(normalize({audioFadeOutSeconds:"invalid"}).audioFadeOutSeconds,0);
});
test("student transitions normalize styles and clamp phase duration",()=>{assert.equal(normalize({studentTransitionStyle:"fade-rise",studentTransitionSeconds:1.2}).studentTransitionStyle,"fade-rise");assert.equal(normalize({studentTransitionStyle:"none",studentTransitionSeconds:0}).studentTransitionSeconds,.1);assert.equal(normalize({studentTransitionSeconds:9}).studentTransitionSeconds,3);assert.equal(normalize({studentTransitionStyle:"spin",studentTransitionSeconds:"bad"}).studentTransitionStyle,"fade");assert.equal(normalize({studentTransitionSeconds:"bad"}).studentTransitionSeconds,.5)});
test("projector background settings normalize enablement and darkness",()=>{
  assert.equal(normalize({useProjectorBackground:true,projectorBackgroundOverlay:55}).useProjectorBackground,true);
  assert.equal(normalize({projectorBackgroundOverlay:-5}).projectorBackgroundOverlay,0);
  assert.equal(normalize({projectorBackgroundOverlay:100}).projectorBackgroundOverlay,80);
});

test("window titles combine the event name with each display role",()=>{
  assert.equal(windowTitle({eventName:"Awards Night"},"scanner"),"Awards Night - Scanner");
  assert.equal(windowTitle({eventName:"Awards Night"},"projector"),"Awards Night - Projector");
  assert.equal(windowTitle({eventName:"Awards Night"},"obs"),"Awards Night - OBS");
  assert.equal(windowTitle({eventName:"Awards Night"},"obs","Broadcast Left"),"Awards Night - Broadcast Left");
  assert.equal(windowTitle({eventName:"   "},"scanner"),"Graduation Display - Scanner");
});
test("audio routing identifies the selected output roles",()=>{
  assert.equal(routesAudioTo({audioTarget:"projector"},"projector"),true);
  assert.equal(routesAudioTo({audioTarget:"projector"},"obs"),false);
  assert.equal(routesAudioTo({audioTarget:"obs"},"obs"),true);
  assert.equal(routesAudioTo({audioTarget:"both"},"projector"),true);
  assert.equal(routesAudioTo({audioTarget:"both"},"obs"),true);
  assert.equal(routesAudioTo({audioTarget:"none"},"projector"),false);
});
