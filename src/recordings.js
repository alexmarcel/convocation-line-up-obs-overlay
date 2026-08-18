"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { processRecording } = require("./wav");
const { loadManifest, sha256 } = require("./library");

function safeId(id) {
  const value = String(id || "");
  if (!value || value.includes("/") || value.includes("\\") || value === "." || value === "..") throw new Error("Invalid student ID.");
  return value;
}

async function draftIds(draftsRoot) {
  try {
    const entries = await fs.readdir(draftsRoot, { withFileTypes:true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".wav")).map((entry) => entry.name.slice(0, -4));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function recordingStatus(draftsRoot, manifest) {
  const drafts = await draftIds(draftsRoot);
  return {
    drafts,
    published:Object.keys(manifest?.assets?.audio || {}),
    total:manifest?.order?.length || 0
  };
}

async function saveDraft({ id, samples, sampleRate, draftsRoot, manifest }) {
  id = safeId(id);
  if (!manifest?.students?.[id]) throw new Error(`Student ${id} is not in the active library.`);
  const input = samples instanceof Float32Array ? samples : new Float32Array(samples);
  const processed = processRecording(input, Number(sampleRate));
  await fs.mkdir(draftsRoot, { recursive:true });
  const destination = path.join(draftsRoot, `${id}.wav`);
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, processed.wav, { flag:"wx" });
  await fs.rename(temporary, destination);
  return { id, duration:processed.duration, peak:processed.peak, gain:processed.gain };
}

async function readDraft(id, draftsRoot) {
  id = safeId(id);
  return fs.readFile(path.join(draftsRoot, `${id}.wav`));
}

async function deleteDraft(id, draftsRoot) {
  id = safeId(id);
  await fs.rm(path.join(draftsRoot, `${id}.wav`), { force:true });
  return { id };
}

async function publishDrafts({ draftsRoot, libraryRoot }) {
  const current = await loadManifest(libraryRoot);
  if (!current) throw new Error("Import a ceremony library before publishing recordings.");
  const ids = await draftIds(draftsRoot);
  if (!ids.length) throw new Error("There are no draft recordings to publish.");
  const next = structuredClone(current);
  next.ceremonyId ||= current.libraryId||current.version;
  next.libraryId=next.ceremonyId;
  next.assets.audio ||= {};
  next.recordings ||= {};
  const publishedAt = new Date().toISOString();
  for (const id of ids) {
    if (!next.students[id]) continue;
    const buffer = await readDraft(id, draftsRoot);
    const hash = await sha256(buffer);
    const relative = path.join("assets", "audio", `${hash}.wav`);
    const destination = path.join(libraryRoot, relative);
    await fs.mkdir(path.dirname(destination), { recursive:true });
    try { await fs.writeFile(destination, buffer, { flag:"wx" }); } catch (error) { if (error.code !== "EEXIST") throw error; }
    next.assets.audio[id] = {
      id, kind:"audio", hash, size:buffer.length, mime:"audio/wav",
      url:`/api/assets/audio/${hash}.wav`,
      file:relative.replaceAll("\\", "/"),
      sourceName:`${id}.wav`
    };
    next.recordings[id] = { source:"studio", hash, publishedAt };
  }
  next.counts.audio = Object.keys(next.assets.audio).length;
  next.createdAt = publishedAt;
  const fingerprint = await sha256(Buffer.from(JSON.stringify({
    students:next.students,
    photos:Object.fromEntries(Object.entries(next.assets.photos || {}).map(([id, asset]) => [id, asset.hash])),
    audio:Object.fromEntries(Object.entries(next.assets.audio || {}).map(([id, asset]) => [id, asset.hash]))
  })));
  next.version = `${Date.now()}-${fingerprint.slice(0, 12)}`;

  const manifestPath = path.join(libraryRoot, "manifest.json");
  const temporary = path.join(libraryRoot, `manifest.${crypto.randomUUID()}.next`);
  const backup = path.join(libraryRoot, "manifest.previous.json");
  await fs.writeFile(temporary, JSON.stringify(next, null, 2), { flag:"wx" });
  await fs.rm(backup, { force:true });
  await fs.rename(manifestPath, backup);
  try {
    await fs.rename(temporary, manifestPath);
  } catch (error) {
    await fs.rename(backup, manifestPath);
    await fs.rm(temporary, { force:true });
    throw error;
  }
  return next;
}

module.exports = { recordingStatus, saveDraft, readDraft, deleteDraft, publishDrafts, safeId };
