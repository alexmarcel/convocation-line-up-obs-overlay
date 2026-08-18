"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const os=require("node:os");
const path=require("node:path");
const sharp=require("sharp");
const {buildLibrary,ensureCeremonyIdentity,loadManifest}=require("../src/library");
const {draftsRootFor}=require("../src/library-key");
const Maintenance=require("../src/maintenance");

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"maintenance-test-"));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const csv=path.join(root,"students.csv"),libraryRoot=path.join(root,"library"),workingRoot=path.join(root,"working"),draftsBase=path.join(root,"drafts");
  await fs.writeFile(csv,"id,name,group,marks\n1,Jane Doe,Engineering,98%\n2,John Roe,Arts,91%");
  const manifest=await buildLibrary({csvPath:csv,targetRoot:libraryRoot,ceremonyId:"ceremony-1"});
  const draftsRoot=draftsRootFor(draftsBase,manifest);await fs.mkdir(draftsRoot,{recursive:true});await fs.writeFile(path.join(draftsRoot,"1.wav"),Buffer.from("draft"));
  return{root,csv,libraryRoot,workingRoot,draftsRoot,manifest};
}

test("stable ceremony identity migrates older manifests",async t=>{
  const data=await fixture(t),manifest=await loadManifest(data.libraryRoot);delete manifest.ceremonyId;manifest.libraryId="legacy-id";
  await fs.writeFile(path.join(data.libraryRoot,"manifest.json"),JSON.stringify(manifest));
  const migrated=await ensureCeremonyIdentity(data.libraryRoot);
  assert.equal(migrated.ceremonyId,"legacy-id");assert.equal(migrated.libraryId,"legacy-id");
});

test("maintenance additions, edits and ordering publish without losing existing drafts",async t=>{
  const data=await fixture(t);
  await Maintenance.addStudent({workingRoot:data.workingRoot,manifest:data.manifest,student:{id:"3",name:"New Student",group:"Science",marks:"88%"},placement:{position:"before",targetId:"2"}});
  await Maintenance.editStudent({workingRoot:data.workingRoot,manifest:data.manifest,originalId:"1",student:{id:"1",name:"Jane Updated",group:"Engineering",marks:"99%"}});
  const staged=await Maintenance.readState(data.workingRoot);assert.deepEqual(staged.order,["1","3","2"]);
  const result=await Maintenance.publish({workingRoot:data.workingRoot,libraryRoot:data.libraryRoot,draftsRoot:data.draftsRoot});
  assert.equal(result.manifest.ceremonyId,"ceremony-1");assert.equal(result.manifest.students["1"].marks,"99%");assert.ok(result.manifest.students["3"]);
  assert.deepEqual(result.manifest.order,["1","3","2"]);assert.equal(await fs.readFile(path.join(data.draftsRoot,"1.wav"),"utf8"),"draft");
  assert.equal(await Maintenance.readState(data.workingRoot),null);
});

test("CSV reconciliation retains omitted students and overlays media for new records",async t=>{
  const data=await fixture(t),updated=path.join(data.root,"updated.csv"),photos=path.join(data.root,"photos");
  await fs.mkdir(photos);await fs.writeFile(updated,"id,name,group,marks\n2,John Changed,Arts,92%\n3,Third Student,Law,87%");
  await sharp({create:{width:40,height:50,channels:3,background:"#123456"}}).png().toFile(path.join(photos,"3.png"));
  const result=await Maintenance.reconcile({workingRoot:data.workingRoot,manifest:data.manifest,csvPath:updated,photoFolder:photos});
  assert.deepEqual(result.summary.added,["3"]);assert.deepEqual(result.summary.changed,["2"]);assert.deepEqual(result.summary.retained,["1"]);
  assert.deepEqual(result.state.order,["2","3","1"]);assert.equal(result.state.media.photos["3"].sourceName,"3.png");
  const published=await Maintenance.publish({workingRoot:data.workingRoot,libraryRoot:data.libraryRoot,draftsRoot:data.draftsRoot});
  assert.ok(published.manifest.students["1"]);assert.equal(published.manifest.assets.photos["3"].sourceName,"3.png");
});

test("explicit removal deletes references and its draft only after publication",async t=>{
  const data=await fixture(t);await Maintenance.removeStudent({workingRoot:data.workingRoot,manifest:data.manifest,id:"1"});
  assert.equal(await fs.readFile(path.join(data.draftsRoot,"1.wav"),"utf8"),"draft");
  const published=await Maintenance.publish({workingRoot:data.workingRoot,libraryRoot:data.libraryRoot,draftsRoot:data.draftsRoot});
  assert.equal(published.manifest.students["1"],undefined);await assert.rejects(fs.access(path.join(data.draftsRoot,"1.wav")));
});

test("CSV export preserves order and quotes special fields",()=>{
  const csv=Maintenance.exportCsv({order:["1"],students:{"1":{id:"1",name:'Doe, "Jane"',group:"A\nB",marks:"98%"}}});
  assert.equal(csv,'id,name,group,marks\r\n1,"Doe, ""Jane""","A\nB",98%\r\n');
});

test("maintenance validates duplicate, unsafe and non-Code-128 IDs",async t=>{
  const data=await fixture(t);
  await assert.rejects(Maintenance.addStudent({workingRoot:data.workingRoot,manifest:data.manifest,student:{id:"1",name:"X",group:"Y",marks:"Z"}}),/already exists/);
  await assert.rejects(Maintenance.addStudent({workingRoot:data.workingRoot,manifest:data.manifest,student:{id:"bad/id",name:"X",group:"Y",marks:"Z"}}),/unsafe/);
  await assert.rejects(Maintenance.addStudent({workingRoot:data.workingRoot,manifest:data.manifest,student:{id:"é",name:"X",group:"Y",marks:"Z"}}),/unsupported/);
});

test("working copies resume, discard safely, and reject stale publication",async t=>{
  const data=await fixture(t);
  await Maintenance.addStudent({workingRoot:data.workingRoot,manifest:data.manifest,student:{id:"3",name:"Resume Me",group:"Law",marks:"80%"}});
  const resumed=await Maintenance.loadOrCreate(data.workingRoot,data.manifest);assert.equal(resumed.students["3"].name,"Resume Me");
  const changed={...data.manifest,version:"externally-changed"};await fs.writeFile(path.join(data.libraryRoot,"manifest.json"),JSON.stringify(changed));
  await assert.rejects(Maintenance.publish({workingRoot:data.workingRoot,libraryRoot:data.libraryRoot,draftsRoot:data.draftsRoot}),/active library changed/);
  assert.ok((await Maintenance.readState(data.workingRoot)).students["3"]);
  await Maintenance.discard(data.workingRoot);assert.equal(await Maintenance.readState(data.workingRoot),null);
  assert.equal((await loadManifest(data.libraryRoot)).students["3"],undefined);
});
