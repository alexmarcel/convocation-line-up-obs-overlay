"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const os=require("node:os");
const path=require("node:path");
const {exportMedia,extensionFor,safeId}=require("../src/media-export");

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"media-export-")),library=path.join(root,"library"),destination=path.join(root,"exports");
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(library,"assets","photos"),{recursive:true});await fs.mkdir(path.join(library,"assets","audio"),{recursive:true});await fs.mkdir(destination);
  await fs.writeFile(path.join(library,"assets","photos","photo.webp"),"photo");await fs.writeFile(path.join(library,"assets","audio","audio.mp3"),"audio");
  const manifest={order:["A-1"],assets:{photos:{"A-1":{id:"A-1",file:"assets/photos/photo.webp",mime:"image/webp"}},audio:{"A-1":{id:"A-1",file:"assets/audio/audio.mp3",mime:"audio/mpeg"}}}};
  return{root,library,destination,manifest};
}
test("photo and audio exports use re-importable student ID filenames",async t=>{
  const data=await fixture(t),date=new Date("2026-07-28T00:00:00Z");
  const photos=await exportMedia({libraryRoot:data.library,manifest:data.manifest,kind:"photos",destinationRoot:data.destination,date});
  const audio=await exportMedia({libraryRoot:data.library,manifest:data.manifest,kind:"audio",destinationRoot:data.destination,date});
  assert.equal(await fs.readFile(path.join(photos.destination,"A-1.webp"),"utf8"),"photo");
  assert.equal(await fs.readFile(path.join(audio.destination,"A-1.mp3"),"utf8"),"audio");
  assert.equal(photos.count,1);assert.equal(audio.count,1);
});
test("media export creates unique folders and rejects unsafe IDs",async t=>{
  const data=await fixture(t),date=new Date("2026-07-28T00:00:00Z");
  const first=await exportMedia({libraryRoot:data.library,manifest:data.manifest,kind:"photos",destinationRoot:data.destination,date});
  const second=await exportMedia({libraryRoot:data.library,manifest:data.manifest,kind:"photos",destinationRoot:data.destination,date});
  assert.notEqual(first.destination,second.destination);
  assert.throws(()=>safeId("../bad"),/safe filename/);
  assert.equal(extensionFor("audio",{mime:"audio/wav"}),".wav");
});
