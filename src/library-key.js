"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

function libraryKey(manifest) {
  const value=String(manifest?.ceremonyId||manifest?.libraryId||manifest?.version||"no-library");
  return value.replace(/[^A-Za-z0-9._-]/g,"_").slice(0,160)||"no-library";
}
function draftsRootFor(baseRoot,manifest){return path.join(baseRoot,libraryKey(manifest))}
async function migrateLegacyDrafts(baseRoot,manifest) {
  if(!manifest)return 0;
  let entries;
  try{entries=await fs.readdir(baseRoot,{withFileTypes:true})}catch(error){if(error.code==="ENOENT")return 0;throw error}
  const legacy=entries.filter(entry=>entry.isFile()&&entry.name.endsWith(".wav"));
  if(!legacy.length)return 0;
  const target=draftsRootFor(baseRoot,manifest);await fs.mkdir(target,{recursive:true});
  let moved=0;
  for(const entry of legacy){
    const source=path.join(baseRoot,entry.name),destination=path.join(target,entry.name);
    try{await fs.rename(source,destination);moved++}catch(error){if(error.code!=="EEXIST")throw error}
  }
  return moved;
}

module.exports={libraryKey,draftsRootFor,migrateLegacyDrafts};
