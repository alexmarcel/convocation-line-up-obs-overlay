"use strict";
const fs=require("node:fs/promises");
const path=require("node:path");
const crypto=require("node:crypto");

const ceremonyKey=value=>String(value||"no-library").replace(/[^A-Za-z0-9._-]/g,"_").slice(0,160)||"no-library";
function sanitizeEntries(outputs={}){
  return Object.fromEntries(Object.values(outputs).filter(item=>item&&item.stationId&&["projector","obs"].includes(item.role)).map(item=>{
    const stationId=String(item.stationId);
    return[stationId,{stationId,name:String(item.name||stationId),role:item.role,required:item.required!==false,muted:false,lastSeen:item.lastSeen||null}];
  }));
}

class OutputRegistry{
  constructor(filePath,ceremonies={},activeCeremonyId="no-library"){
    this.filePath=filePath;
    this.ceremonies=ceremonies;
    this.activeCeremonyId=ceremonyKey(activeCeremonyId);
    this.writeChain=Promise.resolve();
    this.loadActive();
  }
  static async open(filePath,activeCeremonyId){
    let data={};
    try{data=JSON.parse(await fs.readFile(filePath,"utf8"))}catch(error){if(error.code!=="ENOENT")throw error}
    const ceremonies={};
    if(data.schema===2&&data.ceremonies){
      for(const [key,value] of Object.entries(data.ceremonies))ceremonies[ceremonyKey(key)]=sanitizeEntries(value?.outputs||value);
    }
    // Schema 1 was global and cannot safely be attributed to the active ceremony.
    return new OutputRegistry(filePath,ceremonies,activeCeremonyId);
  }
  loadActive(){
    const saved=this.ceremonies[this.activeCeremonyId]||{};
    this.entries=new Map(Object.entries(sanitizeEntries(saved)));
  }
  async activate(ceremonyId,{reset=false}={}){
    this.saveActive();
    this.activeCeremonyId=ceremonyKey(ceremonyId);
    if(reset)delete this.ceremonies[this.activeCeremonyId];
    this.loadActive();
    await this.persist();
    return this.list();
  }
  saveActive(){this.ceremonies[this.activeCeremonyId]=Object.fromEntries(this.entries)}
  register({stationId,name,role}){if(!["projector","obs"].includes(role))return;const existing=this.entries.get(stationId);this.entries.set(stationId,{stationId,name:existing?.name||name,role,required:existing?.required??false,muted:false,lastSeen:new Date().toISOString()});void this.persist()}
  touch(stationId){const value=this.entries.get(stationId);if(value){value.lastSeen=new Date().toISOString();void this.persist()}}
  get(stationId){return this.entries.get(stationId)||null}
  async update(stationId,changes={}){const value=this.entries.get(stationId);if(!value)throw new Error("Output station was not found.");if(changes.name!==undefined)value.name=String(changes.name);await this.persist();return value}
  async setRequired(stationId,required){const value=this.entries.get(stationId);if(!value)throw new Error("Output station was not found.");value.required=!!required;await this.persist();return value}
  async clear(){this.entries.clear();await this.persist();return[]}
  list(){return[...this.entries.values()]}
  persist(){
    this.saveActive();
    this.writeChain=this.writeChain.then(async()=>{
      await fs.mkdir(path.dirname(this.filePath),{recursive:true});
      const temporary=`${this.filePath}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporary,JSON.stringify({schema:2,activeCeremonyId:this.activeCeremonyId,ceremonies:Object.fromEntries(Object.entries(this.ceremonies).map(([key,outputs])=>[key,{outputs}]))},null,2),{flag:"wx"});
      await fs.rm(this.filePath,{force:true});await fs.rename(temporary,this.filePath);
    });
    return this.writeChain;
  }
}
module.exports={OutputRegistry,ceremonyKey};
