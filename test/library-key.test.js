"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path");
const {libraryKey,draftsRootFor,migrateLegacyDrafts}=require("../src/library-key");
test("recording draft roots are isolated by stable library identity",()=>{
  const base=path.join("root","drafts");
  assert.notEqual(draftsRootFor(base,{libraryId:"ceremony-a"}),draftsRootFor(base,{libraryId:"ceremony-b"}));
  assert.equal(libraryKey({libraryId:"unsafe/id"}),"unsafe_id");
});
test("legacy flat drafts migrate into the active library directory",async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"draft-migrate-"));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,"100.wav"),"audio");
  assert.equal(await migrateLegacyDrafts(root,{libraryId:"lib-1"}),1);
  assert.equal(await fs.readFile(path.join(root,"lib-1","100.wav"),"utf8"),"audio");
});
