"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { buildLibrary, loadManifest } = require("../src/library");
const {
  normalizeEntry, createBackup, inspectBackup, restoreBackup, recoverRestore,
  createSnapshot, listSnapshots, validateMetadata
} = require("../src/backups");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "backup-test-"));
  t.after(() => fs.rm(root, { recursive:true, force:true }));
  const source = path.join(root, "source");
  const libraryRoot = path.join(source, "ceremony-library");
  const draftsRoot = path.join(source, "recording-drafts");
  const csv = path.join(root, "students.csv");
  await fs.writeFile(csv, "id,name,group,marks\nA-1,Žara Doe,Blue,98%");
  const manifest = await buildLibrary({ csvPath:csv, targetRoot:libraryRoot });
  await fs.mkdir(draftsRoot);
  await fs.writeFile(path.join(draftsRoot, "A-1.wav"), Buffer.from("RIFF-draft-audio"));
  return { root, source, libraryRoot, draftsRoot, manifest };
}

test("backup round trip preserves library and recording drafts", async (t) => {
  const data = await fixture(t);
  const backupPath = path.join(data.root, "portable.graduation-backup");
  const created = await createBackup({
    libraryRoot:data.libraryRoot, draftsRoot:data.draftsRoot, destination:backupPath,
    appVersion:"2.0.0", reason:"manual",
    controllerState:{settings:{accent:"#123456",audioTarget:"both",playAudioOnController:true,audioFadeInSeconds:.8,audioFadeOutSeconds:1.4,studentTransitionStyle:"fade-rise",studentTransitionSeconds:.9,eventName:"Awards",hideProjectorHeader:true,obsBackgroundMode:"chroma",chroma:"#00ff00",useProjectorBackground:true,projectorBackgroundOverlay:44},outputs:[{stationId:"projector-1",name:"Main screen",role:"projector",required:true}]}
  });
  assert.equal(created.metadata.counts.students, 1);
  assert.equal(created.metadata.counts.drafts, 1);

  const inspected = await inspectBackup({ backupPath });
  assert.equal(inspected.library.students["A-1"].name, "Žara Doe");
  assert.equal(inspected.metadata.controllerState.settings.eventName,"Awards");
  assert.equal(inspected.metadata.controllerState.settings.audioTarget,"both");
  assert.equal(inspected.metadata.controllerState.settings.playAudioOnController,true);
  assert.equal(inspected.metadata.controllerState.settings.studentTransitionStyle,"fade-rise");
  assert.equal(inspected.metadata.controllerState.settings.studentTransitionSeconds,.9);
  assert.equal(inspected.metadata.controllerState.settings.audioFadeInSeconds,.8);
  assert.equal(inspected.metadata.controllerState.settings.audioFadeOutSeconds,1.4);
  assert.equal(inspected.metadata.controllerState.outputs,undefined);
  const target = path.join(data.root, "target");
  await fs.mkdir(target);
  const restored = await restoreBackup({
    backupPath, userDataRoot:target,
    libraryRoot:path.join(target, "ceremony-library"),
    draftsRoot:path.join(target, "recording-drafts"),
    inspected
  });
  assert.equal(restored.manifest.version, data.manifest.version);
  assert.equal((await loadManifest(path.join(target, "ceremony-library"))).students["A-1"].name, "Žara Doe");
  assert.equal((await fs.readFile(path.join(target, "recording-drafts", "A-1.wav"))).toString(), "RIFF-draft-audio");
});

test("path and schema validation rejects unsafe or newer backups", () => {
  assert.throws(() => normalizeEntry("../escape"), /Unsafe archive path/);
  assert.throws(() => normalizeEntry("C:/escape"), /Unsafe archive path/);
  assert.throws(() => validateMetadata({ backupSchema:999, files:[] }), /newer version/);
});

test("automatic snapshots retain only five archives", async (t) => {
  const data = await fixture(t);
  const backupsRoot = path.join(data.root, "snapshots");
  for (let index = 0; index < 6; index++) {
    await createSnapshot({
      libraryRoot:data.libraryRoot, draftsRoot:data.draftsRoot, backupsRoot,
      appVersion:"2.0.0", reason:`test-${index}`
    });
  }
  assert.equal((await listSnapshots(backupsRoot)).length, 5);
});

test("startup recovery rolls an interrupted activation back", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "restore-recovery-"));
  t.after(() => fs.rm(root, { recursive:true, force:true }));
  const libraryRoot=path.join(root,"ceremony-library"), draftsRoot=path.join(root,"recording-drafts");
  const rollbackLibrary=path.join(root,"rollback-library"), rollbackDrafts=path.join(root,"rollback-drafts"), staging=path.join(root,"staging");
  await fs.mkdir(libraryRoot); await fs.writeFile(path.join(libraryRoot,"new"),"new");
  await fs.mkdir(draftsRoot); await fs.writeFile(path.join(draftsRoot,"new.wav"),"new");
  await fs.mkdir(rollbackLibrary); await fs.writeFile(path.join(rollbackLibrary,"old"),"old");
  await fs.mkdir(rollbackDrafts); await fs.writeFile(path.join(rollbackDrafts,"old.wav"),"old");
  await fs.mkdir(staging);
  await fs.writeFile(path.join(root,"restore-journal.json"), JSON.stringify({
    phase:"activated", staging, rollbackLibrary, rollbackDrafts, hadLibrary:true, hadDrafts:true
  }));
  assert.equal(await recoverRestore({ userDataRoot:root, libraryRoot, draftsRoot }), true);
  assert.equal(await fs.readFile(path.join(libraryRoot,"old"),"utf8"), "old");
  assert.equal(await fs.readFile(path.join(draftsRoot,"old.wav"),"utf8"), "old");
});
