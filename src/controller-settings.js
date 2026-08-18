"use strict";
const fs=require("node:fs/promises");
const path=require("node:path");
const crypto=require("node:crypto");
const {normalize}=require("./output-settings");

const AUDIO_TARGETS=new Set(["projector","obs","both","none"]);
const SNAPSHOT_INTERVALS=new Set([5,10,30]);
const defaults=()=>({accent:"#00d2ff",audioTarget:"projector",playAudioOnController:false,audioFadeInSeconds:0,audioFadeOutSeconds:0,studentTransitionStyle:"fade",studentTransitionSeconds:.5,eventName:"",hideProjectorHeader:false,obsBackgroundMode:"transparent",chroma:"#00ff00",useProjectorBackground:false,projectorBackgroundOverlay:35,automaticSnapshotsEnabled:false,automaticSnapshotIntervalMinutes:5});
function sanitize(value={}){
  const normalized=normalize(value),accent=/^#[0-9a-f]{6}$/i.test(String(value.accent||""))?String(value.accent).toLowerCase():"#00d2ff";
  const interval=Number(value.automaticSnapshotIntervalMinutes);
  return{accent,audioTarget:AUDIO_TARGETS.has(value.audioTarget)?value.audioTarget:"projector",playAudioOnController:normalized.playAudioOnController,audioFadeInSeconds:normalized.audioFadeInSeconds,audioFadeOutSeconds:normalized.audioFadeOutSeconds,studentTransitionStyle:normalized.studentTransitionStyle,studentTransitionSeconds:normalized.studentTransitionSeconds,eventName:String(value.eventName||"").slice(0,120),hideProjectorHeader:!!value.hideProjectorHeader,obsBackgroundMode:normalized.obsBackgroundMode,chroma:normalized.chroma,useProjectorBackground:normalized.useProjectorBackground,projectorBackgroundOverlay:normalized.projectorBackgroundOverlay,automaticSnapshotsEnabled:!!value.automaticSnapshotsEnabled,automaticSnapshotIntervalMinutes:SNAPSHOT_INTERVALS.has(interval)?interval:5};
}
function automaticSnapshotIntervalMs(settings){return sanitize(settings).automaticSnapshotIntervalMinutes*60*1000}
async function read(filePath){
  try{return sanitize(JSON.parse(await fs.readFile(filePath,"utf8")))}catch(error){if(error.code==="ENOENT")return defaults();throw error}
}
async function write(filePath,value){
  const settings=sanitize(value);await fs.mkdir(path.dirname(filePath),{recursive:true});
  const temporary=`${filePath}.${crypto.randomUUID()}.tmp`;await fs.writeFile(temporary,JSON.stringify(settings,null,2),{flag:"wx"});await fs.rm(filePath,{force:true});await fs.rename(temporary,filePath);return settings;
}
module.exports={defaults,sanitize,read,write,automaticSnapshotIntervalMs};
