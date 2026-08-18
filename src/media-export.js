"use strict";
const fs=require("node:fs/promises");
const path=require("node:path");
const crypto=require("node:crypto");

function extensionFor(kind,asset){
  if(kind==="photos")return".webp";
  if(asset.mime==="audio/mpeg")return".mp3";
  if(asset.mime==="audio/wav")return".wav";
  throw new Error(`Unsupported ${kind==="photos"?"photo":"audio"} format for ${asset.id||"an asset"}.`);
}
function safeId(id){
  const value=String(id||"");
  if(!value||path.basename(value)!==value||!/[A-Za-z0-9]/.test(value)||!/^[A-Za-z0-9._-]+$/.test(value))throw new Error(`Student ID "${value}" cannot be exported as a safe filename.`);
  return value;
}
async function availablePath(parent,name){
  for(let suffix=0;suffix<1000;suffix++){
    const candidate=path.join(parent,suffix?`${name}-${suffix+1}`:name);
    try{await fs.access(candidate)}catch(error){if(error.code==="ENOENT")return candidate;throw error}
  }
  throw new Error("Could not create a unique export folder.");
}
async function exportMedia({libraryRoot,manifest,kind,destinationRoot,signal,date=new Date()}){
  if(!["photos","audio"].includes(kind))throw new Error("Invalid media export type.");
  const assets=manifest?.assets?.[kind]||{},ids=(manifest?.order||[]).filter(id=>assets[id]);
  if(!ids.length)throw new Error(`This ceremony has no ${kind} to export.`);
  const label=kind==="photos"?"photos":"audio",folderName=`graduation-${label}-${date.toISOString().slice(0,10)}`;
  const destination=await availablePath(destinationRoot,folderName),staging=path.join(destinationRoot,`.${path.basename(destination)}.${crypto.randomUUID()}.tmp`);
  let bytes=0;
  try{
    await fs.mkdir(staging,{recursive:false});
    for(const id of ids){
      if(signal?.aborted)throw new Error("Operation cancelled.");
      const asset=assets[id],source=path.resolve(libraryRoot,...String(asset.file).split("/"));
      if(!source.startsWith(path.resolve(libraryRoot)+path.sep))throw new Error(`Unsafe managed asset path for student ${id}.`);
      const target=path.join(staging,`${safeId(id)}${extensionFor(kind,asset)}`);
      await fs.copyFile(source,target);bytes+=(await fs.stat(target)).size;
    }
    await fs.rename(staging,destination);
    return{destination,count:ids.length,bytes};
  }catch(error){await fs.rm(staging,{recursive:true,force:true});throw error}
}
module.exports={extensionFor,safeId,exportMedia};
