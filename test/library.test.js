"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { buildLibrary, loadManifest, sha256, activateLibrary } = require("../src/library");

test("sha256 produces a stable content hash", async () => {
  assert.equal(await sha256(Buffer.from("graduation")), "415473a357d9d696222e86407a96e6a0e022269c22dd2c8d5187a69c100f0097");
});

test("buildLibrary publishes role assets and reports unmatched media", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "graduation-test-"));
  t.after(() => fs.rm(root, { recursive:true, force:true }));
  const csvPath = path.join(root, "students.csv");
  const photos = path.join(root, "photos");
  const audio = path.join(root, "audio");
  await fs.mkdir(photos); await fs.mkdir(audio);
  await fs.writeFile(csvPath, "id,name,group,marks\n1,Jane Doe,Blue,98%");
  await sharp({ create:{ width:300, height:400, channels:3, background:"#11aaff" } }).png().toFile(path.join(photos, "1.png"));
  await fs.writeFile(path.join(audio, "1.mp3"), Buffer.from("audio"));
  await fs.writeFile(path.join(audio, "unknown.mp3"), Buffer.from("fake"));
  const target = path.join(root, "library");
  const manifest = await buildLibrary({ csvPath, photoFolder:photos, audioFolder:audio, targetRoot:target });
  assert.equal(manifest.counts.students, 1);
  assert.equal(manifest.counts.photos, 1);
  assert.equal(manifest.counts.missingPhotos, 0);
  assert.deepEqual(manifest.missingPhotos, []);
  assert.ok(manifest.assets.photos["1"].hash);
  assert.equal(manifest.assets.photos["1"].sourceName, "1.png");
  assert.ok(manifest.assets.thumbnails["1"].hash);
  assert.equal(manifest.assets.audio["1"].sourceName, "1.mp3");
  assert.deepEqual(manifest.unmatched, ["unknown.mp3"]);
  assert.equal((await loadManifest(target)).version, manifest.version);
});

test("buildLibrary warns but publishes when student photos are missing", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "graduation-test-"));
  t.after(() => fs.rm(root, { recursive:true, force:true }));
  const csvPath=path.join(root,"students.csv"),target=path.join(root,"library");
  await fs.writeFile(csvPath,"id,name,group,marks\n2,Beta,Blue,90%\n1,Alpha,Red,91%");
  const manifest=await buildLibrary({csvPath,targetRoot:target});
  assert.deepEqual(manifest.missingPhotos,["2","1"]);
  assert.equal(manifest.counts.missingPhotos,2);
  assert.equal(manifest.counts.students,2);
});

test("failed replacement preserves the active library", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "graduation-test-"));
  t.after(() => fs.rm(root, { recursive:true, force:true }));
  const valid = path.join(root, "valid.csv"), invalid = path.join(root, "invalid.csv"), target = path.join(root, "library");
  await fs.writeFile(valid, "id,name,group,marks\n1,Jane,Blue,98%");
  await fs.writeFile(invalid, "id,name\n1,Jane");
  const first = await buildLibrary({ csvPath:valid, targetRoot:target });
  await assert.rejects(buildLibrary({ csvPath:invalid, targetRoot:target }), /Missing CSV headers/);
  assert.equal((await loadManifest(target)).version, first.version);
});

test("activation restores the current library when the final rename fails",async()=>{
  const calls=[];
  const fake={
    rm:async target=>calls.push(["rm",target]),
    rename:async(source,target)=>{
      calls.push(["rename",source,target]);
      if(source==="staging")throw Object.assign(new Error("activation failed"),{code:"EACCES"});
    }
  };
  await assert.rejects(activateLibrary("staging","active",fake),/activation failed/);
  assert.deepEqual(calls,[
    ["rm","active.previous"],
    ["rename","active","active.previous"],
    ["rename","staging","active"],
    ["rename","active.previous","active"]
  ]);
});
