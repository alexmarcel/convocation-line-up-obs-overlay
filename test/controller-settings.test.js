"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const os=require("node:os");
const path=require("node:path");
const Settings=require("../src/controller-settings");

test("controller output settings are sanitized and persist across restarts",async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"controller-settings-")),file=path.join(root,"settings.json");t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const saved=await Settings.write(file,{accent:"#ABCDEF",audioTarget:"both",playAudioOnController:true,audioFadeInSeconds:.7,audioFadeOutSeconds:2.5,studentTransitionStyle:"fade-rise",studentTransitionSeconds:1.1,eventName:"Graduation".repeat(20),hideProjectorHeader:true,obsBackgroundMode:"chroma",chroma:"#12ABef",useProjectorBackground:true,projectorBackgroundOverlay:75,automaticSnapshotsEnabled:true,automaticSnapshotIntervalMinutes:30});
  assert.equal(saved.accent,"#abcdef");assert.equal(saved.audioTarget,"both");assert.equal(saved.playAudioOnController,true);assert.equal(saved.audioFadeInSeconds,.7);assert.equal(saved.audioFadeOutSeconds,2.5);assert.equal(saved.studentTransitionStyle,"fade-rise");assert.equal(saved.studentTransitionSeconds,1.1);assert.equal(saved.eventName.length,120);assert.equal(saved.automaticSnapshotsEnabled,true);assert.equal(Settings.automaticSnapshotIntervalMs(saved),30*60*1000);
  assert.deepEqual(await Settings.read(file),saved);
});
test("invalid restored output settings receive safe defaults",()=>{
  const value=Settings.sanitize({accent:"red",audioTarget:"speakers",obsBackgroundMode:"bad",chroma:"green",projectorBackgroundOverlay:999});
  assert.equal(value.accent,"#00d2ff");assert.equal(value.audioTarget,"projector");assert.equal(value.obsBackgroundMode,"transparent");assert.equal(value.projectorBackgroundOverlay,80);
  assert.equal(value.automaticSnapshotsEnabled,false);assert.equal(value.automaticSnapshotIntervalMinutes,5);
  assert.equal(value.audioFadeInSeconds,0);assert.equal(value.audioFadeOutSeconds,0);
  assert.equal(value.playAudioOnController,false);
  assert.equal(value.studentTransitionStyle,"fade");assert.equal(value.studentTransitionSeconds,.5);
});
