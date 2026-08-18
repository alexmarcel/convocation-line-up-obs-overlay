"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const archiver = require("archiver");
const yauzl = require("yauzl");
const { loadManifest } = require("./library");
const ControllerSettings=require("./controller-settings");

const BACKUP_SCHEMA = 1;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;

function abortError() {
  const error = new Error("Operation cancelled.");
  error.name = "AbortError";
  return error;
}
function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
function normalizeEntry(name) {
  const value = String(name || "").replaceAll("\\", "/");
  if (!value || value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe archive path: ${name}`);
  }
  return value;
}
function safeDraftName(name) {
  const normalized = normalizeEntry(name);
  if (!/^recording-drafts\/[^/]+\.wav$/.test(normalized)) throw new Error(`Unsafe recording draft path: ${name}`);
  return normalized;
}
async function hashFile(filePath, signal) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  if (signal) signal.addEventListener("abort", () => stream.destroy(abortError()), { once:true });
  for await (const chunk of stream) { checkAbort(signal); hash.update(chunk); }
  return hash.digest("hex");
}
async function fileRecord(source, archivePath, signal) {
  const stat = await fsp.stat(source);
  if (!stat.isFile()) throw new Error(`Backup source is not a file: ${source}`);
  return { path:normalizeEntry(archivePath), size:stat.size, sha256:await hashFile(source, signal), source };
}
async function collectBackupFiles({ libraryRoot, draftsRoot, signal }) {
  const manifest = await loadManifest(libraryRoot);
  const files = [];
  if (manifest) {
    files.push(await fileRecord(path.join(libraryRoot, "manifest.json"), "ceremony-library/manifest.json", signal));
    const seen = new Set(["manifest.json"]);
    for (const kind of ["photos", "thumbnails", "audio", "backgrounds"]) {
      for (const asset of Object.values(manifest.assets?.[kind] || {})) {
        checkAbort(signal);
        const relative = normalizeEntry(asset.file);
        if (seen.has(relative)) continue;
        seen.add(relative);
        files.push(await fileRecord(path.join(libraryRoot, ...relative.split("/")), `ceremony-library/${relative}`, signal));
      }
    }
  }
  try {
    const entries = await fsp.readdir(draftsRoot, { withFileTypes:true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".wav")) continue;
      const archivePath = safeDraftName(`recording-drafts/${entry.name}`);
      files.push(await fileRecord(path.join(draftsRoot, entry.name), archivePath, signal));
    }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  return { manifest, files };
}
function controllerState(value){
  if(!value)return undefined;
  // Station IDs describe venue hardware, not portable ceremony data. Legacy
  // backup output lists are intentionally ignored during validation/restore.
  return{settings:ControllerSettings.sanitize(value.settings)};
}
function metadataFor(manifest, files, appVersion, reason, state) {
  const draftCount = files.filter(file => file.path.startsWith("recording-drafts/")).length;
  const metadata = {
    backupSchema:BACKUP_SCHEMA,
    appVersion,
    createdAt:new Date().toISOString(),
    reason,
    platform:process.platform,
    libraryVersion:manifest?.version || null,
    counts:{
      students:manifest?.counts?.students || 0,
      photos:manifest?.counts?.photos || 0,
      audio:manifest?.counts?.audio || 0,
      drafts:draftCount
    },
    totalBytes:files.reduce((sum, file) => sum + file.size, 0),
    files:files.map(({ path, size, sha256 }) => ({ path, size, sha256 }))
  };
  if(state)metadata.controllerState=controllerState(state);
  return metadata;
}
async function createBackup({ libraryRoot, draftsRoot, destination, appVersion, reason = "manual", signal, onProgress, controllerState:state }) {
  checkAbort(signal);
  const { manifest, files } = await collectBackupFiles({ libraryRoot, draftsRoot, signal });
  if (!files.length) throw new Error("There is no ceremony library or recording draft to back up.");
  const metadata = metadataFor(manifest, files, appVersion, reason, state);
  await fsp.mkdir(path.dirname(destination), { recursive:true });
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  const output = fs.createWriteStream(temporary, { flags:"wx" });
  const archive = archiver("zip", { zlib:{ level:6 }, forceZip64:true });
  const abort = () => archive.abort();
  signal?.addEventListener("abort", abort, { once:true });
  try {
    const completion = pipeline(archive, output);
    archive.on("progress", progress => onProgress?.({
      phase:"backup", processedBytes:progress.fs.processedBytes, totalBytes:metadata.totalBytes,
      percent:metadata.totalBytes ? Math.min(99, Math.round(progress.fs.processedBytes / metadata.totalBytes * 100)) : 0
    }));
    archive.append(JSON.stringify(metadata, null, 2), { name:"backup-manifest.json" });
    for (const file of files) {
      checkAbort(signal);
      archive.file(file.source, { name:file.path });
    }
    await archive.finalize();
    await completion;
    checkAbort(signal);
    await fsp.rename(temporary, destination);
    const stat = await fsp.stat(destination);
    onProgress?.({ phase:"complete", processedBytes:metadata.totalBytes, totalBytes:metadata.totalBytes, percent:100 });
    return { metadata, destination, archiveBytes:stat.size };
  } catch (error) {
    archive.abort();
    output.destroy();
    await fsp.rm(temporary, { force:true });
    if (signal?.aborted) throw abortError();
    throw error;
  } finally { signal?.removeEventListener("abort", abort); }
}

function openZip(zipPath) {
  return new Promise((resolve, reject) => yauzl.open(zipPath, { lazyEntries:true, decodeStrings:true, validateEntrySizes:true }, (error, zip) => error ? reject(error) : resolve(zip)));
}
function entryStream(zip, entry) {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream)));
}
async function forEachEntry(zipPath, handler) {
  const zip = await openZip(zipPath);
  return new Promise((resolve, reject) => {
    let busy = false, ended = false;
    const fail = error => { try { zip.close(); } catch {} reject(error); };
    zip.on("error", fail);
    zip.on("end", () => { ended=true; if (!busy) resolve(); });
    zip.on("entry", entry => {
      busy = true;
      Promise.resolve(handler(zip, entry)).then(() => {
        busy = false;
        if (ended) resolve(); else zip.readEntry();
      }, fail);
    });
    zip.readEntry();
  });
}
async function streamToBuffer(stream, maximum, signal) {
  const chunks = []; let size = 0;
  for await (const chunk of stream) {
    checkAbort(signal); size += chunk.length;
    if (size > maximum) throw new Error("Backup manifest is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function hashEntry(stream, expectedSize, signal, onBytes) {
  const hash = crypto.createHash("sha256"); let size = 0;
  for await (const chunk of stream) {
    checkAbort(signal); size += chunk.length; hash.update(chunk); onBytes?.(chunk.length);
  }
  if (size !== expectedSize) throw new Error(`Archive entry size mismatch: expected ${expectedSize}, received ${size}.`);
  return hash.digest("hex");
}
function validateMetadata(metadata) {
  if (!metadata || !Number.isInteger(metadata.backupSchema)) throw new Error("Invalid backup manifest.");
  if (metadata.backupSchema > BACKUP_SCHEMA) throw new Error("This backup requires a newer version of Graduation Display.");
  if (metadata.backupSchema < 1) throw new Error("Unsupported backup schema.");
  if (!Array.isArray(metadata.files) || !metadata.files.length) throw new Error("Backup contains no files.");
  const names = new Set();
  for (const file of metadata.files) {
    file.path = normalizeEntry(file.path);
    if (names.has(file.path)) throw new Error(`Duplicate declared backup path: ${file.path}`);
    names.add(file.path);
    if (!/^(ceremony-library|recording-drafts)\//.test(file.path)) throw new Error(`Backup file is outside allowed directories: ${file.path}`);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error(`Invalid backup inventory entry: ${file.path}`);
    if (file.path.startsWith("recording-drafts/")) safeDraftName(file.path);
  }
  metadata.totalBytes = metadata.files.reduce((sum, file) => sum + file.size, 0);
  if(metadata.controllerState)metadata.controllerState=controllerState(metadata.controllerState);
  return metadata;
}
function validateLibraryManifest(library, inventory) {
  if (!library || library.schemaVersion !== 1 || !library.students || !Array.isArray(library.order) || !library.assets) throw new Error("Backup contains an invalid ceremony manifest.");
  if (new Set(library.order).size !== library.order.length || library.order.some(id => !library.students[id])) throw new Error("Ceremony student order is inconsistent.");
  if (library.counts?.students !== library.order.length) throw new Error("Ceremony student count is inconsistent.");
  for (const kind of ["photos", "thumbnails", "audio", "backgrounds"]) {
    for (const asset of Object.values(library.assets[kind] || {})) {
      const archivePath = normalizeEntry(`ceremony-library/${asset.file}`);
      const declared = inventory.get(archivePath);
      if (!declared || declared.sha256 !== asset.hash || declared.size !== asset.size) throw new Error(`Ceremony asset does not match backup inventory: ${archivePath}`);
      const expectedPrefix = `ceremony-library/assets/${kind}/`;
      if (!archivePath.startsWith(expectedPrefix)) throw new Error(`Ceremony asset has an invalid location: ${archivePath}`);
    }
  }
}
async function inspectBackup({ backupPath, signal, onProgress }) {
  checkAbort(signal);
  let metadata, library, processed = 0;
  const archiveNames = new Set();
  await forEachEntry(backupPath, async (zip, entry) => {
    checkAbort(signal);
    const name = normalizeEntry(entry.fileName);
    const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
    if (mode === 0o120000 || name.endsWith("/")) throw new Error(`Links and directory entries are not allowed: ${name}`);
    if (entry.generalPurposeBitFlag & 1) throw new Error("Encrypted backup archives are not supported.");
    if (archiveNames.has(name)) throw new Error(`Duplicate archive entry: ${name}`);
    archiveNames.add(name);
    const stream = await entryStream(zip, entry);
    if (name === "backup-manifest.json") {
      if (metadata) throw new Error("Duplicate backup manifest.");
      metadata = validateMetadata(JSON.parse((await streamToBuffer(stream, MAX_MANIFEST_BYTES, signal)).toString("utf8")));
      return;
    }
    if (!metadata) throw new Error("backup-manifest.json must be the first archive entry.");
    const declared = metadata.files.find(file => file.path === name);
    if (!declared) throw new Error(`Undeclared archive entry: ${name}`);
    const hash = await hashEntry(stream, declared.size, signal, bytes => {
      processed += bytes;
      onProgress?.({ phase:"validate", processedBytes:processed, totalBytes:metadata.totalBytes, percent:Math.round(processed / metadata.totalBytes * 100) });
    });
    if (hash !== declared.sha256) throw new Error(`Backup integrity check failed: ${name}`);
    if (name === "ceremony-library/manifest.json") {
      const manifestStream = await entryStreamFromPath(backupPath, name);
      library = JSON.parse((await streamToBuffer(manifestStream, MAX_MANIFEST_BYTES, signal)).toString("utf8"));
    }
  });
  if (!metadata) throw new Error("Backup manifest is missing.");
  const inventory = new Map(metadata.files.map(file => [file.path, file]));
  if (archiveNames.size !== metadata.files.length + 1) throw new Error("Backup contents do not match the declared inventory.");
  if (inventory.has("ceremony-library/manifest.json")) {
    if (!library) throw new Error("Ceremony manifest could not be read.");
    validateLibraryManifest(library, inventory);
  }
  return { metadata, library };
}
async function entryStreamFromPath(zipPath, target) {
  const zip = await openZip(zipPath);
  return new Promise((resolve, reject) => {
    zip.on("error", reject);
    zip.on("entry", entry => {
      if (entry.fileName === target) zip.openReadStream(entry, (error, stream) => {
        if (error) return reject(error);
        stream.on("end", () => zip.close());
        resolve(stream);
      });
      else zip.readEntry();
    });
    zip.on("end", () => reject(new Error(`Archive entry is missing: ${target}`)));
    zip.readEntry();
  });
}
async function readBackupMetadata(zipPath) {
  const zip = await openZip(zipPath);
  return new Promise((resolve, reject) => {
    const fail = error => { try { zip.close(); } catch {} reject(error); };
    zip.on("error", fail);
    zip.on("entry", entry => {
      if (entry.fileName !== "backup-manifest.json") return fail(new Error("backup-manifest.json must be the first archive entry."));
      entryStream(zip, entry).then(async stream => {
        try {
          const metadata = validateMetadata(JSON.parse((await streamToBuffer(stream, MAX_MANIFEST_BYTES)).toString("utf8")));
          zip.close();
          resolve(metadata);
        } catch (error) { fail(error); }
      }, fail);
    });
    zip.on("end", () => fail(new Error("Backup manifest is missing.")));
    zip.readEntry();
  });
}
async function extractBackup({ backupPath, destination, metadata, signal, onProgress }) {
  await fsp.mkdir(destination, { recursive:true });
  const inventory = new Map(metadata.files.map(file => [file.path, file]));
  let processed = 0;
  await forEachEntry(backupPath, async (zip, entry) => {
    const name = normalizeEntry(entry.fileName);
    if (name === "backup-manifest.json") {
      const stream = await entryStream(zip, entry);
      for await (const _chunk of stream) checkAbort(signal);
      return;
    }
    const declared = inventory.get(name);
    if (!declared) throw new Error(`Undeclared archive entry: ${name}`);
    const target = path.resolve(destination, ...name.split("/"));
    if (!target.startsWith(path.resolve(destination) + path.sep)) throw new Error(`Unsafe restore target: ${name}`);
    await fsp.mkdir(path.dirname(target), { recursive:true });
    const stream = await entryStream(zip, entry);
    const hash = crypto.createHash("sha256"); let size = 0;
    stream.on("data", chunk => {
      hash.update(chunk); size += chunk.length; processed += chunk.length;
      onProgress?.({ phase:"extract", processedBytes:processed, totalBytes:metadata.totalBytes, percent:Math.round(processed / metadata.totalBytes * 100) });
    });
    if (signal) signal.addEventListener("abort", () => stream.destroy(abortError()), { once:true });
    await pipeline(stream, fs.createWriteStream(target, { flags:"wx" }));
    checkAbort(signal);
    if (size !== declared.size || hash.digest("hex") !== declared.sha256) throw new Error(`Extracted file failed verification: ${name}`);
  });
}

async function availableBytes(directory) {
  if (typeof fsp.statfs !== "function") return null;
  const stats = await fsp.statfs(directory);
  return Number(stats.bavail) * Number(stats.bsize);
}
async function recoverRestore({ userDataRoot, libraryRoot, draftsRoot }) {
  const journalPath = path.join(userDataRoot, "restore-journal.json");
  let journal;
  try { journal = JSON.parse(await fsp.readFile(journalPath, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
  libraryRoot=journal.libraryRoot||libraryRoot;
  draftsRoot=journal.draftsRoot||draftsRoot;
  const exists = async target => { try { await fsp.access(target); return true; } catch { return false; } };
  if (journal.phase !== "committed") {
    if (journal.phase === "activated") {
      await fsp.rm(libraryRoot, { recursive:true, force:true });
      await fsp.rm(draftsRoot, { recursive:true, force:true });
    }
    if (journal.hadLibrary && await exists(journal.rollbackLibrary)) {
      await fsp.rm(libraryRoot, { recursive:true, force:true });
      await fsp.rename(journal.rollbackLibrary, libraryRoot);
    }
    if (journal.hadDrafts && await exists(journal.rollbackDrafts)) {
      await fsp.rm(draftsRoot, { recursive:true, force:true });
      await fsp.rename(journal.rollbackDrafts, draftsRoot);
    }
  }
  await fsp.rm(journal.rollbackLibrary, { recursive:true, force:true });
  await fsp.rm(journal.rollbackDrafts, { recursive:true, force:true });
  await fsp.rm(journal.staging, { recursive:true, force:true });
  await fsp.rm(journalPath, { force:true });
  return true;
}
async function restoreBackup({ backupPath, userDataRoot, libraryRoot, draftsRoot, signal, onProgress, inspected }) {
  const details = inspected || await inspectBackup({ backupPath, signal, onProgress });
  const free = await availableBytes(userDataRoot);
  if (free !== null && free < details.metadata.totalBytes * 2) throw new Error("Insufficient disk space to stage and safely restore this backup.");
  const staging = path.join(userDataRoot, `restore-staging-${crypto.randomUUID()}`);
  const rollbackLibrary = path.join(userDataRoot, `restore-rollback-library-${crypto.randomUUID()}`);
  const rollbackDrafts = path.join(userDataRoot, `restore-rollback-drafts-${crypto.randomUUID()}`);
  const journalPath = path.join(userDataRoot, "restore-journal.json");
  const exists = async target => { try { await fsp.access(target); return true; } catch { return false; } };
  const journal = {
    schema:1, phase:"prepared", staging, rollbackLibrary, rollbackDrafts,
    libraryRoot,draftsRoot,
    hadLibrary:await exists(libraryRoot), hadDrafts:await exists(draftsRoot)
  };
  try {
    await extractBackup({ backupPath, destination:staging, metadata:details.metadata, signal, onProgress });
    await fsp.writeFile(journalPath, JSON.stringify(journal, null, 2));
    if (journal.hadLibrary) await fsp.rename(libraryRoot, rollbackLibrary);
    if (journal.hadDrafts) await fsp.rename(draftsRoot, rollbackDrafts);
    journal.phase = "current-moved"; await fsp.writeFile(journalPath, JSON.stringify(journal, null, 2));
    const stagedLibrary = path.join(staging, "ceremony-library");
    const stagedDrafts = path.join(staging, "recording-drafts");
    if (await exists(stagedLibrary)) await fsp.rename(stagedLibrary, libraryRoot);
    if (await exists(stagedDrafts)) await fsp.rename(stagedDrafts, draftsRoot);
    journal.phase = "activated"; await fsp.writeFile(journalPath, JSON.stringify(journal, null, 2));
    const restored = await loadManifest(libraryRoot);
    if (details.library && restored?.version !== details.library.version) throw new Error("Restored library activation check failed.");
    journal.phase = "committed"; await fsp.writeFile(journalPath, JSON.stringify(journal, null, 2));
    await recoverRestore({ userDataRoot, libraryRoot, draftsRoot });
    return { metadata:details.metadata, manifest:restored };
  } catch (error) {
    if (await exists(journalPath)) await recoverRestore({ userDataRoot, libraryRoot, draftsRoot });
    else await fsp.rm(staging, { recursive:true, force:true });
    throw error;
  }
}
async function listSnapshots(backupsRoot) {
  try {
    const entries = await fsp.readdir(backupsRoot, { withFileTypes:true });
    const results = [];
    for (const entry of entries.filter(item => item.isFile() && item.name.endsWith(".graduation-backup"))) {
      const backupPath = path.join(backupsRoot, entry.name);
      try {
        const metadata = await readBackupMetadata(backupPath);
        results.push({ path:backupPath, name:entry.name, metadata, valid:true });
      } catch (error) { results.push({ path:backupPath, name:entry.name, valid:false, error:error.message }); }
    }
    return results.sort((a,b) => String(b.metadata?.createdAt || "").localeCompare(String(a.metadata?.createdAt || "")));
  } catch (error) { if (error.code === "ENOENT") return []; throw error; }
}
async function createSnapshot(options) {
  await fsp.mkdir(options.backupsRoot, { recursive:true });
  const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}-${options.reason}.graduation-backup`;
  const result = await createBackup({ ...options, destination:path.join(options.backupsRoot, filename) });
  const snapshots = await listSnapshots(options.backupsRoot);
  for (const snapshot of snapshots.slice(5)) await fsp.rm(snapshot.path, { force:true });
  return result;
}

module.exports = {
  BACKUP_SCHEMA, normalizeEntry, collectBackupFiles, createBackup, inspectBackup, extractBackup,
  restoreBackup, recoverRestore, listSnapshots, createSnapshot, validateMetadata, validateLibraryManifest, readBackupMetadata, controllerState
};
