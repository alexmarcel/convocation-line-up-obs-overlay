"use strict";

const fs=require("node:fs/promises");
const path=require("node:path");
const crypto=require("node:crypto");
const sharp=require("sharp");
const {loadManifest,writeAsset,activateLibrary,sha256}=require("./library");

const EXTENSIONS=new Set([".jpg",".jpeg",".png",".webp"]);
const defaults=()=>({enabled:false,overlay:35});
async function copyDirectory(source,destination){
  await fs.mkdir(destination,{recursive:true});
  for(const entry of await fs.readdir(source,{withFileTypes:true})){
    const from=path.join(source,entry.name),to=path.join(destination,entry.name);
    if(entry.isDirectory())await copyDirectory(from,to);
    else if(entry.isFile())try{await fs.link(from,to)}catch{await fs.copyFile(from,to)}
  }
}
function presentation(manifest){
  const value=manifest?.presentation?.projectorBackground||{};
  return{...defaults(),...value,enabled:!!value.enabled,overlay:Math.max(0,Math.min(80,Number(value.overlay??35)))};
}
async function publish({libraryRoot,sourcePath}){
  const current=await loadManifest(libraryRoot);
  if(!current)throw new Error("Import a ceremony library before uploading a projector background.");
  const extension=path.extname(sourcePath).toLowerCase();
  if(!EXTENSIONS.has(extension))throw new Error("Choose a PNG, JPEG, or WebP image.");
  let buffer;
  try{
    buffer=await sharp(sourcePath,{limitInputPixels:268402689}).rotate().resize({width:3840,height:2160,fit:"inside",withoutEnlargement:true}).webp({quality:86}).toBuffer();
  }catch(error){throw new Error(`The selected background image could not be decoded: ${error.message}`)}
  const staging=`${libraryRoot}.background-${crypto.randomUUID()}`;
  await copyDirectory(libraryRoot,staging);
  try{
    const next=structuredClone(current);
    next.assets||={};next.assets.backgrounds||={};
    const asset=await writeAsset(buffer,"backgrounds","projector","image/webp",staging,path.basename(sourcePath));
    next.assets.backgrounds.projector=asset;
    next.presentation||={};
    next.presentation.projectorBackground={...presentation(next),enabled:true,assetHash:asset.hash,sourceName:path.basename(sourcePath)};
    const fingerprint=await sha256(Buffer.from(JSON.stringify({base:current.version,background:asset.hash})));
    next.version=`${Date.now()}-${fingerprint.slice(0,12)}`;next.createdAt=new Date().toISOString();
    await fs.writeFile(path.join(staging,"manifest.json"),JSON.stringify(next,null,2));
    await activateLibrary(staging,libraryRoot);
    return next;
  }catch(error){await fs.rm(staging,{recursive:true,force:true});throw error}
}
async function remove({libraryRoot}){
  const current=await loadManifest(libraryRoot);
  if(!current)throw new Error("No ceremony library is active.");
  if(!current.assets?.backgrounds?.projector)return current;
  const staging=`${libraryRoot}.background-${crypto.randomUUID()}`;
  await copyDirectory(libraryRoot,staging);
  try{
    const next=structuredClone(current);
    delete next.assets.backgrounds.projector;
    next.presentation||={};next.presentation.projectorBackground={...defaults(),enabled:false};
    const fingerprint=await sha256(Buffer.from(JSON.stringify({base:current.version,background:null})));
    next.version=`${Date.now()}-${fingerprint.slice(0,12)}`;next.createdAt=new Date().toISOString();
    await fs.writeFile(path.join(staging,"manifest.json"),JSON.stringify(next,null,2));
    await activateLibrary(staging,libraryRoot);
    return next;
  }catch(error){await fs.rm(staging,{recursive:true,force:true});throw error}
}
async function updateSettings({libraryRoot,enabled,overlay}){
  const current=await loadManifest(libraryRoot);
  if(!current)throw new Error("No ceremony library is active.");
  const asset=current.assets?.backgrounds?.projector;
  const next=structuredClone(current),value=presentation(next);
  value.enabled=!!enabled&&!!asset;value.overlay=Math.max(0,Math.min(80,Number(overlay??value.overlay)));
  if(asset){value.assetHash=asset.hash;value.sourceName=asset.sourceName||value.sourceName}
  next.presentation||={};next.presentation.projectorBackground=value;
  const manifestPath=path.join(libraryRoot,"manifest.json"),temporary=path.join(libraryRoot,`manifest.${crypto.randomUUID()}.presentation`),backup=path.join(libraryRoot,"manifest.presentation.previous.json");
  await fs.writeFile(temporary,JSON.stringify(next,null,2),{flag:"wx"});
  await fs.rm(backup,{force:true});await fs.rename(manifestPath,backup);
  try{await fs.rename(temporary,manifestPath);await fs.rm(backup,{force:true})}
  catch(error){await fs.rename(backup,manifestPath);await fs.rm(temporary,{force:true});throw error}
  return next;
}
async function publishMain({libraryRoot,sourcePath}){
  const current=await loadManifest(libraryRoot);if(!current)throw new Error("Import a ceremony library before uploading a main background.");
  if(!EXTENSIONS.has(path.extname(sourcePath).toLowerCase()))throw new Error("Choose a PNG, JPEG, or WebP image.");
  let buffer;try{buffer=await sharp(sourcePath,{limitInputPixels:268402689}).rotate().resize({width:3840,height:2160,fit:"inside",withoutEnlargement:true}).webp({quality:88}).toBuffer()}catch(error){throw new Error(`The selected main background could not be decoded: ${error.message}`)}
  const staging=`${libraryRoot}.main-background-${crypto.randomUUID()}`;await copyDirectory(libraryRoot,staging);
  try{const next=structuredClone(current);next.assets||={};next.assets.backgrounds||={};const asset=await writeAsset(buffer,"backgrounds","main","image/webp",staging,path.basename(sourcePath));next.assets.backgrounds.main=asset;next.presentation||={};next.presentation.mainBackground={enabled:true,assetHash:asset.hash,sourceName:path.basename(sourcePath)};const fingerprint=await sha256(Buffer.from(JSON.stringify({base:current.version,mainBackground:asset.hash})));next.version=`${Date.now()}-${fingerprint.slice(0,12)}`;next.createdAt=new Date().toISOString();await fs.writeFile(path.join(staging,"manifest.json"),JSON.stringify(next,null,2));await activateLibrary(staging,libraryRoot);return next}catch(error){await fs.rm(staging,{recursive:true,force:true});throw error}
}
async function removeMain({libraryRoot}){
  const current=await loadManifest(libraryRoot);if(!current)throw new Error("No ceremony library is active.");if(!current.assets?.backgrounds?.main)return current;
  const staging=`${libraryRoot}.main-background-${crypto.randomUUID()}`;await copyDirectory(libraryRoot,staging);
  try{const next=structuredClone(current);delete next.assets.backgrounds.main;next.presentation||={};next.presentation.mainBackground={enabled:false};const fingerprint=await sha256(Buffer.from(JSON.stringify({base:current.version,mainBackground:null})));next.version=`${Date.now()}-${fingerprint.slice(0,12)}`;next.createdAt=new Date().toISOString();await fs.writeFile(path.join(staging,"manifest.json"),JSON.stringify(next,null,2));await activateLibrary(staging,libraryRoot);return next}catch(error){await fs.rm(staging,{recursive:true,force:true});throw error}
}
module.exports={EXTENSIONS,presentation,publish,remove,updateSettings,publishMain,removeMain};
