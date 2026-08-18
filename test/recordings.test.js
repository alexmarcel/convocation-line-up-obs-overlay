"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { saveDraft, recordingStatus, publishDrafts, deleteDraft } = require("../src/recordings");

function manifest() {
  return {
    schemaVersion:1, version:"old", createdAt:new Date(0).toISOString(),
    students:{ "1":{ id:"1", name:"Jane Doe", group:"Blue", marks:"98%" } },
    order:["1"], assets:{ photos:{}, thumbnails:{}, audio:{} }, recordings:{}, unmatched:[],
    counts:{ students:1, photos:0, audio:0 }
  };
}

function samples() {
  const data = new Float32Array(16000);
  for (let index = 3000; index < 13000; index++) data[index] = Math.sin(index / 10) * 0.25;
  return data;
}

test("draft recordings persist separately and publish into a new manifest", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "recordings-test-"));
  t.after(() => fs.rm(root, { recursive:true, force:true }));
  const libraryRoot = path.join(root, "library"), draftsRoot = path.join(root, "drafts");
  await fs.mkdir(libraryRoot);
  await fs.writeFile(path.join(libraryRoot, "manifest.json"), JSON.stringify(manifest()));

  await saveDraft({ id:"1", samples:samples(), sampleRate:8000, draftsRoot, manifest:manifest() });
  const before = await recordingStatus(draftsRoot, manifest());
  assert.deepEqual(before.drafts, ["1"]);
  assert.deepEqual(before.published, []);

  const published = await publishDrafts({ draftsRoot, libraryRoot });
  assert.notEqual(published.version, "old");
  assert.equal(published.assets.audio["1"].mime, "audio/wav");
  assert.equal(published.assets.audio["1"].sourceName, "1.wav");
  assert.equal(published.recordings["1"].source, "studio");
  assert.equal(JSON.parse(await fs.readFile(path.join(libraryRoot, "manifest.json"))).version, published.version);
  assert.ok((await fs.stat(path.join(libraryRoot, published.assets.audio["1"].file))).size > 44);

  await deleteDraft("1", draftsRoot);
  assert.deepEqual((await recordingStatus(draftsRoot, published)).drafts, []);
});

test("saveDraft rejects unknown student IDs", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "recordings-test-"));
  t.after(() => fs.rm(root, { recursive:true, force:true }));
  await assert.rejects(saveDraft({ id:"2", samples:samples(), sampleRate:8000, draftsRoot:root, manifest:manifest() }), /not in the active library/);
});
