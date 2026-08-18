"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path");
const {EventLedger}=require("../src/event-ledger");
test("resolved offline events persist across controller restarts",async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"ledger-test-"));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const file=path.join(root,"ledger.json"),first=await EventLedger.open(file);
  await first.resolve("event-1","approve");
  const reopened=await EventLedger.open(file);
  assert.equal(reopened.get("event-1").decision,"approve");
});
