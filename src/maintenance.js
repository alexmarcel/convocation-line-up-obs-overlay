"use strict";

const fs=require("node:fs/promises");
const path=require("node:path");
const crypto=require("node:crypto");
const sharp=require("sharp");
const {parseStudents}=require("./csv");
const {validateBarcodeId}=require("./barcodes");
const {calculateMissingPhotos}=require("./photo-status");
const {loadManifest,sha256,activateLibrary,writeAsset}=require("./library");

const PHOTO_EXTENSIONS=new Set([".jpg",".jpeg",".png",".webp"]);
const AUDIO_MIME={".mp3":"audio/mpeg",".wav":"audio/wav"};
const STATE_FILE="working-copy.json";

function validateStudent(student,existing={},originalId){
  const next={id:String(student?.id||"").trim(),name:String(student?.name||"").trim(),group:String(student?.group||"").trim(),marks:String(student?.marks||"").trim()};
  if(!next.id||!next.name||!next.group||!next.marks)throw new Error("ID, name, program, and marks are required.");
  if(next.id.includes("/")||next.id.includes("\\")||next.id==="."||next.id==="..")throw new Error("Student ID contains unsafe path characters.");
  const existingUnchanged=originalId===next.id&&!!existing[next.id];
  if(!existingUnchanged){
    validateBarcodeId(next.id);
    if(!/^[A-Za-z0-9._-]+$/.test(next.id))throw new Error("New student IDs may use only letters, numbers, dot, underscore, and hyphen.");
  }
  if(next.id!==originalId&&existing[next.id])throw new Error(`Student ID "${next.id}" already exists.`);
  return next;
}
function csvEscape(value){const text=String(value??"");return /[",\r\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text}
function exportCsv(manifest){return["id,name,group,marks",...manifest.order.map(id=>{const s=manifest.students[id];return[s.id,s.name,s.group,s.marks].map(csvEscape).join(",")})].join("\r\n")+"\r\n"}
async function exists(file){try{await fs.access(file);return true}catch{return false}}
async function readState(root){
  try{return JSON.parse(await fs.readFile(path.join(root,STATE_FILE),"utf8"))}
  catch(error){if(error.code==="ENOENT")return null;throw error}
}
async function writeState(root,state){
  await fs.mkdir(root,{recursive:true});
  const target=path.join(root,STATE_FILE),temporary=path.join(root,`${STATE_FILE}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(temporary,JSON.stringify(state,null,2),{flag:"wx"});await fs.rename(temporary,target);return state;
}
async function createState(workingRoot,manifest){
  if(!manifest)throw new Error("Import a ceremony library before managing it.");
  const state={schemaVersion:1,baseVersion:manifest.version,ceremonyId:manifest.ceremonyId||manifest.libraryId||manifest.version,students:structuredClone(manifest.students),order:[...manifest.order],media:{photos:{},audio:{}},removedDraftIds:[],updatedAt:new Date().toISOString()};
  return writeState(workingRoot,state);
}
async function loadOrCreate(workingRoot,manifest){
  const state=await readState(workingRoot);
  if(state&&state.ceremonyId===(manifest?.ceremonyId||manifest?.libraryId||manifest?.version))return state;
  if(state)throw new Error("A working copy exists for another ceremony. Publish or discard it first.");
  return createState(workingRoot,manifest);
}
async function save(workingRoot,state){state.updatedAt=new Date().toISOString();return writeState(workingRoot,state)}
function insertId(order,id,placement={}){
  const target=placement.targetId,index=target?order.indexOf(target):-1;
  if(index<0){order.push(id);return}
  order.splice(index+(placement.position==="after"?1:0),0,id);
}
async function addStudent({workingRoot,manifest,student,placement}){
  const state=await loadOrCreate(workingRoot,manifest),next=validateStudent(student,state.students);
  state.students[next.id]=next;insertId(state.order,next.id,placement);return save(workingRoot,state);
}
async function editStudent({workingRoot,manifest,originalId,student,placement}){
  const state=await loadOrCreate(workingRoot,manifest);
  if(!state.students[originalId])throw new Error("Student was not found in the working copy.");
  const next=validateStudent(student,state.students,originalId),index=state.order.indexOf(originalId);
  if(next.id!==originalId){
    delete state.students[originalId];state.order.splice(index,1);state.students[next.id]=next;insertId(state.order,next.id,placement);
    state.removedDraftIds.push(originalId);state.media.photos[originalId]={action:"remove"};state.media.audio[originalId]={action:"remove"};
  }else{state.students[originalId]=next;if(placement){state.order.splice(index,1);insertId(state.order,originalId,placement)}}
  return save(workingRoot,state);
}
async function removeStudent({workingRoot,manifest,id}){
  const state=await loadOrCreate(workingRoot,manifest);if(!state.students[id])throw new Error("Student was not found.");
  delete state.students[id];state.order=state.order.filter(item=>item!==id);state.media.photos[id]={action:"remove"};state.media.audio[id]={action:"remove"};if(!state.removedDraftIds.includes(id))state.removedDraftIds.push(id);
  return save(workingRoot,state);
}
async function moveStudent({workingRoot,manifest,id,direction}){
  const state=await loadOrCreate(workingRoot,manifest),index=state.order.indexOf(id),next=index+(direction==="up"?-1:1);
  if(index<0||next<0||next>=state.order.length)return state;
  [state.order[index],state.order[next]]=[state.order[next],state.order[index]];return save(workingRoot,state);
}
async function stageMedia({workingRoot,manifest,id,kind,sourcePath}){
  const state=await loadOrCreate(workingRoot,manifest);if(!state.students[id])throw new Error("Student was not found.");
  const extension=path.extname(sourcePath).toLowerCase(),allowed=kind==="photos"?PHOTO_EXTENSIONS:new Set(Object.keys(AUDIO_MIME));
  if(!allowed.has(extension))throw new Error(kind==="photos"?"Choose a JPG, JPEG, PNG, or WebP photo.":"Choose an MP3 or WAV audio file.");
  const mediaRoot=path.join(workingRoot,"media",kind);await fs.mkdir(mediaRoot,{recursive:true});
  const fileName=`${crypto.randomUUID()}${extension}`,destination=path.join(mediaRoot,fileName);await fs.copyFile(sourcePath,destination);
  state.media[kind][id]={action:"replace",file:path.relative(workingRoot,destination).replaceAll("\\","/"),sourceName:path.basename(sourcePath)};
  return save(workingRoot,state);
}
async function removeMedia({workingRoot,manifest,id,kind}){
  const state=await loadOrCreate(workingRoot,manifest);if(!state.students[id])throw new Error("Student was not found.");
  state.media[kind][id]={action:"remove"};return save(workingRoot,state);
}
async function listFolder(folder,extensions){
  if(!folder)return[];return(await fs.readdir(folder,{withFileTypes:true})).filter(entry=>entry.isFile()&&extensions.has(path.extname(entry.name).toLowerCase())).map(entry=>path.join(folder,entry.name));
}
async function reconcile({workingRoot,manifest,csvPath,photoFolder,audioFolder}){
  const state=await loadOrCreate(workingRoot,manifest),parsed=parseStudents(await fs.readFile(csvPath,"utf8")),previousStudents=structuredClone(state.students),previousOrder=[...state.order];
  const added=[],changed=[],unchanged=[];
  for(const id of parsed.order){
    const next=validateStudent(parsed.students[id],state.students,id);
    if(!previousStudents[id])added.push(id);
    else if(JSON.stringify(previousStudents[id])!==JSON.stringify(next))changed.push(id);else unchanged.push(id);
    state.students[id]=next;
  }
  const retained=previousOrder.filter(id=>!parsed.students[id]);
  state.order=[...parsed.order,...retained];
  await save(workingRoot,state);
  const unmatched=[];
  for(const file of await listFolder(photoFolder,PHOTO_EXTENSIONS)){const id=path.parse(file).name;if(!state.students[id])unmatched.push(path.basename(file));else await stageMedia({workingRoot,manifest,id,kind:"photos",sourcePath:file})}
  for(const file of await listFolder(audioFolder,new Set(Object.keys(AUDIO_MIME)))){const id=path.parse(file).name;if(!state.students[id])unmatched.push(path.basename(file));else await stageMedia({workingRoot,manifest,id,kind:"audio",sourcePath:file})}
  const latest=await readState(workingRoot);latest.students=state.students;latest.order=state.order;
  latest.reconciliation={added,changed,unchanged,retained,unmatched,sourceName:path.basename(csvPath),at:new Date().toISOString()};
  await save(workingRoot,latest);return{state:latest,summary:latest.reconciliation};
}
function diff(active,state){
  const added=state.order.filter(id=>!active.students[id]),removed=active.order.filter(id=>!state.students[id]);
  const changed=state.order.filter(id=>active.students[id]&&JSON.stringify(active.students[id])!==JSON.stringify(state.students[id]));
  const reordered=JSON.stringify(active.order.filter(id=>state.students[id]))!==JSON.stringify(state.order.filter(id=>active.students[id]));
  const photoChanges=Object.keys(state.media.photos),audioChanges=Object.keys(state.media.audio);
  return{added,removed,changed,reordered,photoChanges,audioChanges,hasChanges:!!(added.length||removed.length||changed.length||reordered||photoChanges.length||audioChanges.length)};
}
async function copyDirectory(source,destination){
  await fs.mkdir(destination,{recursive:true});
  for(const entry of await fs.readdir(source,{withFileTypes:true})){
    const from=path.join(source,entry.name),to=path.join(destination,entry.name);
    if(entry.isDirectory())await copyDirectory(from,to);
    else if(entry.isFile())try{await fs.link(from,to)}catch{await fs.copyFile(from,to)}
  }
}
async function pruneAssets(root,manifest){
  for(const kind of ["photos","thumbnails","audio"]){
    const directory=path.join(root,"assets",kind);if(!await exists(directory))continue;
    const keep=new Set(Object.values(manifest.assets[kind]||{}).map(asset=>path.basename(asset.file)));
    for(const entry of await fs.readdir(directory,{withFileTypes:true}))if(entry.isFile()&&!keep.has(entry.name))await fs.rm(path.join(directory,entry.name),{force:true});
  }
}
async function publish({workingRoot,libraryRoot,draftsRoot}){
  const state=await readState(workingRoot),active=await loadManifest(libraryRoot);
  if(!state)throw new Error("There are no staged library changes.");
  if(!active||state.baseVersion!==active.version)throw new Error("The active library changed after this working copy was created. Discard it and review the latest library.");
  const changes=diff(active,state);if(!changes.hasChanges)throw new Error("There are no changes to publish.");
  const staging=`${libraryRoot}.maintenance-${crypto.randomUUID()}`;await copyDirectory(libraryRoot,staging);
  let activated=false,next;
  try{
    next=structuredClone(active);next.ceremonyId=state.ceremonyId;next.libraryId=state.ceremonyId;next.students=state.students;next.order=state.order;
    next.assets.photos||={};next.assets.thumbnails||={};next.assets.audio||={};next.recordings||={};
    for(const [id,change]of Object.entries(state.media.photos)){
      if(change.action==="remove"){delete next.assets.photos[id];delete next.assets.thumbnails[id];continue}
      const source=sharp(path.join(workingRoot,change.file)).rotate(),full=await source.clone().resize({width:1400,height:1400,fit:"inside",withoutEnlargement:true}).webp({quality:86}).toBuffer(),thumb=await source.clone().resize({width:180,height:180,fit:"cover"}).webp({quality:76}).toBuffer();
      next.assets.photos[id]=await writeAsset(full,"photos",id,"image/webp",staging,change.sourceName);next.assets.thumbnails[id]=await writeAsset(thumb,"thumbnails",id,"image/webp",staging,change.sourceName);
    }
    for(const [id,change]of Object.entries(state.media.audio)){
      if(change.action==="remove"){delete next.assets.audio[id];delete next.recordings[id];continue}
      const extension=path.extname(change.sourceName).toLowerCase(),buffer=await fs.readFile(path.join(workingRoot,change.file));
      next.assets.audio[id]=await writeAsset(buffer,"audio",id,AUDIO_MIME[extension],staging,change.sourceName);next.recordings[id]={source:"maintenance",hash:next.assets.audio[id].hash,publishedAt:new Date().toISOString()};
    }
    for(const id of Object.keys(next.assets.photos))if(!next.students[id]){delete next.assets.photos[id];delete next.assets.thumbnails[id]}
    for(const id of Object.keys(next.assets.audio))if(!next.students[id]){delete next.assets.audio[id];delete next.recordings[id]}
    next.missingPhotos=calculateMissingPhotos(next.order,next.assets.photos,next.assets.thumbnails);
    next.counts={students:next.order.length,photos:Object.keys(next.assets.photos).length,missingPhotos:next.missingPhotos.length,audio:Object.keys(next.assets.audio).length};
    const fingerprint=await sha256(Buffer.from(JSON.stringify({students:next.students,order:next.order,photos:Object.fromEntries(Object.entries(next.assets.photos).map(([id,a])=>[id,a.hash])),audio:Object.fromEntries(Object.entries(next.assets.audio).map(([id,a])=>[id,a.hash]))})));
    next.version=`${Date.now()}-${fingerprint.slice(0,12)}`;next.createdAt=new Date().toISOString();
    await pruneAssets(staging,next);await fs.writeFile(path.join(staging,"manifest.json"),JSON.stringify(next,null,2));await activateLibrary(staging,libraryRoot);activated=true;
  }catch(error){await fs.rm(staging,{recursive:true,force:true});throw error}
  const warnings=[];
  for(const id of state.removedDraftIds)try{await fs.rm(path.join(draftsRoot,`${id}.wav`),{force:true})}catch(error){warnings.push(`Could not remove the orphaned recording draft for ${id}: ${error.message}`)}
  try{await fs.rm(workingRoot,{recursive:true,force:true})}catch(error){warnings.push(`Published successfully, but the working-copy cleanup needs attention: ${error.message}`)}
  return{manifest:next,diff:changes,warnings,activated};
}
async function discard(workingRoot){await fs.rm(workingRoot,{recursive:true,force:true});return{discarded:true}}

module.exports={validateStudent,csvEscape,exportCsv,readState,loadOrCreate,addStudent,editStudent,removeStudent,moveStudent,stageMedia,removeMedia,reconcile,diff,publish,discard};
