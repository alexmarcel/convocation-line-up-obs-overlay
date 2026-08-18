"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path");
const {OutputRegistry}=require("../src/output-registry");

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"output-test-"));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  return path.join(root,"outputs.json");
}

test("output designation is optional by default and persists for the same ceremony",async t=>{
  const file=await fixture(t),registry=await OutputRegistry.open(file,"ceremony-a");
  registry.register({stationId:"projector-1",name:"Projector",role:"projector"});await registry.writeChain;
  assert.equal(registry.list()[0].required,false);
  await registry.setRequired("projector-1",true);
  assert.equal((await OutputRegistry.open(file,"ceremony-a")).list()[0].required,true);
});

test("a different ceremony does not inherit remembered outputs",async t=>{
  const file=await fixture(t),registry=await OutputRegistry.open(file,"ceremony-a");
  registry.register({stationId:"old",name:"Old",role:"obs"});await registry.writeChain;
  await registry.activate("ceremony-b",{reset:true});
  assert.deepEqual(registry.list(),[]);
  registry.register({stationId:"new",name:"New",role:"projector"});await registry.writeChain;
  assert.deepEqual((await OutputRegistry.open(file,"ceremony-a")).list().map(item=>item.stationId),["old"]);
  assert.deepEqual((await OutputRegistry.open(file,"ceremony-b")).list().map(item=>item.stationId),["new"]);
});

test("reset and clear remove only the active ceremony outputs",async t=>{
  const file=await fixture(t),registry=await OutputRegistry.open(file,"ceremony-a");
  registry.register({stationId:"a",name:"A",role:"obs"});await registry.writeChain;
  await registry.activate("ceremony-b");registry.register({stationId:"b",name:"B",role:"projector"});await registry.writeChain;
  await registry.clear();assert.deepEqual(registry.list(),[]);
  await registry.activate("ceremony-a");assert.deepEqual(registry.list().map(item=>item.stationId),["a"]);
  await registry.activate("ceremony-a",{reset:true});assert.deepEqual(registry.list(),[]);
});

test("legacy global output registries are not assigned to a ceremony",async t=>{
  const file=await fixture(t);
  await fs.writeFile(file,JSON.stringify({schema:1,outputs:{old:{stationId:"old",name:"Old",role:"obs",required:true}}}));
  const registry=await OutputRegistry.open(file,"ceremony-a");
  assert.deepEqual(registry.list(),[]);
  await registry.persist();
  assert.equal(JSON.parse(await fs.readFile(file,"utf8")).schema,2);
});
test("output names persist while legacy controller mute state is cleared",async t=>{
  const file=await fixture(t),registry=await OutputRegistry.open(file,"ceremony-a");
  registry.register({stationId:"obs-1",name:"OBS",role:"obs"});await registry.writeChain;
  await registry.update("obs-1",{name:"Broadcast Left"});
  registry.register({stationId:"obs-1",name:"obs-default",role:"obs"});await registry.writeChain;
  const saved=(await OutputRegistry.open(file,"ceremony-a")).get("obs-1");
  assert.equal(saved.name,"Broadcast Left");assert.equal(saved.muted,false);
});
