"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const os=require("node:os");
const path=require("node:path");
const sharp=require("sharp");
const {buildLibrary,loadManifest}=require("../src/library");
const Background=require("../src/projector-background");
const {createBackup,inspectBackup}=require("../src/backups");

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"projector-background-"));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const csv=path.join(root,"students.csv"),libraryRoot=path.join(root,"library"),image=path.join(root,"ceremony.png");
  await fs.writeFile(csv,"id,name,group,marks\n1,Student One,Program,Pass");
  await buildLibrary({csvPath:csv,targetRoot:libraryRoot,ceremonyId:"ceremony-one"});
  await sharp({create:{width:5000,height:3000,channels:3,background:"#336699"}}).png().toFile(image);
  return{root,libraryRoot,image};
}
test("projector background is optimized, published and configured per ceremony",async t=>{
  const data=await fixture(t),before=await loadManifest(data.libraryRoot);
  const published=await Background.publish({libraryRoot:data.libraryRoot,sourcePath:data.image});
  const asset=published.assets.backgrounds.projector,metadata=await sharp(await fs.readFile(path.join(data.libraryRoot,asset.file))).metadata();
  assert.notEqual(published.version,before.version);
  assert.equal(asset.mime,"image/webp");assert.equal(asset.sourceName,"ceremony.png");
  assert.ok(metadata.width<=3840);assert.ok(metadata.height<=2160);
  assert.deepEqual(published.presentation.projectorBackground,{enabled:true,overlay:35,assetHash:asset.hash,sourceName:"ceremony.png"});
});
test("projector background settings clamp values and removal publishes safely",async t=>{
  const data=await fixture(t);await Background.publish({libraryRoot:data.libraryRoot,sourcePath:data.image});
  const configured=await Background.updateSettings({libraryRoot:data.libraryRoot,enabled:true,overlay:99});
  assert.equal(configured.presentation.projectorBackground.overlay,80);
  const removed=await Background.remove({libraryRoot:data.libraryRoot});
  assert.equal(removed.assets.backgrounds.projector,undefined);
  assert.deepEqual(removed.presentation.projectorBackground,{enabled:false,overlay:35});
});
test("main standby background is optimized and removed safely",async t=>{
  const data=await fixture(t),before=await loadManifest(data.libraryRoot);
  const published=await Background.publishMain({libraryRoot:data.libraryRoot,sourcePath:data.image});
  const asset=published.assets.backgrounds.main,metadata=await sharp(await fs.readFile(path.join(data.libraryRoot,asset.file))).metadata();
  assert.notEqual(published.version,before.version);
  assert.equal(asset.mime,"image/webp");assert.equal(asset.sourceName,"ceremony.png");
  assert.ok(metadata.width<=3840);assert.ok(metadata.height<=2160);
  assert.deepEqual(published.presentation.mainBackground,{enabled:true,assetHash:asset.hash,sourceName:"ceremony.png"});
  const removed=await Background.removeMain({libraryRoot:data.libraryRoot});
  assert.equal(removed.assets.backgrounds.main,undefined);
  assert.deepEqual(removed.presentation.mainBackground,{enabled:false});
});
test("projector backgrounds are included and validated in ceremony backups",async t=>{
  const data=await fixture(t),published=await Background.publish({libraryRoot:data.libraryRoot,sourcePath:data.image});
  const drafts=path.join(data.root,"drafts"),backup=path.join(data.root,"background.graduation-backup");
  await fs.mkdir(drafts);
  await createBackup({libraryRoot:data.libraryRoot,draftsRoot:drafts,destination:backup,appVersion:"2.0.0"});
  const inspected=await inspectBackup({backupPath:backup});
  assert.equal(inspected.library.assets.backgrounds.projector.hash,published.assets.backgrounds.projector.hash);
});
test("invalid projector background files do not replace the active library",async t=>{
  const data=await fixture(t),invalid=path.join(data.root,"broken.png"),before=await loadManifest(data.libraryRoot);
  await fs.writeFile(invalid,"not an image");
  await assert.rejects(Background.publish({libraryRoot:data.libraryRoot,sourcePath:invalid}),/could not be decoded/);
  assert.equal((await loadManifest(data.libraryRoot)).version,before.version);
});
