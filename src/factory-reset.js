"use strict";
const fs=require("node:fs/promises"),path=require("node:path"),crypto=require("node:crypto");
const JOURNAL="factory-reset-journal.json",QUARANTINE_PREFIX="factory-reset-quarantine-";
const MANAGED=new Set(["ceremony-library","recording-drafts","backups","library-working","controller-settings.json","output-registry.json","event-ledger.json","restore-journal.json"]);
const PREFIXES=["ceremony-library.staging-","ceremony-library.maintenance-","ceremony-library.projector-background-","ceremony-library.main-background-","restore-staging-","restore-rollback-library-","restore-rollback-drafts-"];
const managedName=name=>MANAGED.has(name)||PREFIXES.some(prefix=>name.startsWith(prefix));
const validConfirmation=value=>value==="RESET EVERYTHING";
async function exists(target){try{await fs.access(target);return true}catch{return false}}
async function writeJournal(root,journal){const target=path.join(root,JOURNAL),temporary=`${target}.${crypto.randomUUID()}.tmp`;await fs.writeFile(temporary,JSON.stringify(journal,null,2),{flag:"wx"});await fs.rm(target,{force:true});await fs.rename(temporary,target)}
async function rollback(root,journal){for(const name of [...journal.moved].reverse()){const source=path.join(journal.quarantine,name),target=path.join(root,name);if(await exists(source)&&!await exists(target))await fs.rename(source,target)}await fs.rm(journal.quarantine,{recursive:true,force:true});await fs.rm(path.join(root,JOURNAL),{force:true})}
async function recoverFactoryReset(root){
  const journalPath=path.join(root,JOURNAL);let journal;
  try{journal=JSON.parse(await fs.readFile(journalPath,"utf8"))}catch(error){if(error.code==="ENOENT")return false;throw error}
  if(!journal?.quarantine||path.dirname(journal.quarantine)!==path.resolve(root)||!path.basename(journal.quarantine).startsWith(QUARANTINE_PREFIX))throw new Error("Invalid factory reset journal.");
  if(journal.phase==="committed"){await fs.rm(journal.quarantine,{recursive:true,force:true});await fs.rm(journalPath,{force:true})}
  else await rollback(root,journal);
  return true;
}
async function resetEverything(root,{afterMove}={}){
  await recoverFactoryReset(root);await fs.mkdir(root,{recursive:true});
  const quarantine=path.join(path.resolve(root),`${QUARANTINE_PREFIX}${crypto.randomUUID()}`),journal={schema:1,phase:"prepared",quarantine,moved:[]};
  await fs.mkdir(quarantine);await writeJournal(root,journal);
  try{
    for(const entry of await fs.readdir(root,{withFileTypes:true})){
      if(!managedName(entry.name))continue;
      await fs.rename(path.join(root,entry.name),path.join(quarantine,entry.name));journal.moved.push(entry.name);await writeJournal(root,journal);
    }
    await afterMove?.();journal.phase="committed";await writeJournal(root,journal);
  }catch(error){await rollback(root,journal);throw error}
  await fs.rm(quarantine,{recursive:true,force:true});await fs.rm(path.join(root,JOURNAL),{force:true});return{removed:[...journal.moved]};
}
module.exports={resetEverything,recoverFactoryReset,managedName,validConfirmation,JOURNAL,QUARANTINE_PREFIX};
