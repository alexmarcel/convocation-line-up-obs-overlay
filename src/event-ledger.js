"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

class EventLedger {
  constructor(filePath, entries = {}) {
    this.filePath=filePath;
    this.resolved=new Map(Object.entries(entries));
    this.writeChain=Promise.resolve();
  }
  static async open(filePath) {
    let entries={};
    try { entries=JSON.parse(await fs.readFile(filePath,"utf8")).resolved||{}; }
    catch(error){if(error.code!=="ENOENT")throw error}
    const ledger=new EventLedger(filePath,entries);
    await ledger.prune();
    return ledger;
  }
  get(eventId){return this.resolved.get(String(eventId))}
  async resolve(eventId,decision) {
    this.resolved.set(String(eventId),{decision,resolvedAt:new Date().toISOString()});
    await this.persist();
    return this.get(eventId);
  }
  async prune(maxEntries=10000,maxAgeDays=30) {
    const cutoff=Date.now()-maxAgeDays*86400000;
    for(const [id,value] of this.resolved)if(Date.parse(value.resolvedAt||0)<cutoff)this.resolved.delete(id);
    if(this.resolved.size>maxEntries){
      const ordered=[...this.resolved.entries()].sort((a,b)=>Date.parse(a[1].resolvedAt)-Date.parse(b[1].resolvedAt));
      for(const [id] of ordered.slice(0,this.resolved.size-maxEntries))this.resolved.delete(id);
    }
    await this.persist();
  }
  persist() {
    this.writeChain=this.writeChain.then(async()=>{
      await fs.mkdir(path.dirname(this.filePath),{recursive:true});
      const temporary=`${this.filePath}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporary,JSON.stringify({schema:1,resolved:Object.fromEntries(this.resolved)},null,2),{flag:"wx"});
      try{
        await fs.rm(this.filePath,{force:true});
        await fs.rename(temporary,this.filePath);
      }catch(error){await fs.rm(temporary,{force:true});throw error}
    });
    return this.writeChain;
  }
}

module.exports={EventLedger};
