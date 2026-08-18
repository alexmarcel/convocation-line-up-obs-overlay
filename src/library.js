"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("sharp");
const { parseStudents } = require("./csv");
const { calculateMissingPhotos } = require("./photo-status");

const PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const AUDIO_MIME = { ".mp3": "audio/mpeg", ".wav": "audio/wav" };

async function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function listFiles(folder, extensions) {
  if (!folder) return [];
  const entries = await fs.readdir(folder, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(folder, entry.name));
}

async function writeAsset(buffer, kind, id, mime, root, sourceName) {
  const hash = await sha256(buffer);
  const extension = mime === "image/webp" ? ".webp" : mime === "audio/mpeg" ? ".mp3" : ".wav";
  const relativePath = path.join("assets", kind, `${hash}${extension}`);
  const destination = path.join(root, relativePath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, buffer);
  return {
    id, kind, hash, size: buffer.length, mime,
    url: `/api/assets/${kind}/${hash}${extension}`,
    file: relativePath.replaceAll("\\", "/"),
    ...(sourceName ? { sourceName } : {})
  };
}
async function activateLibrary(staging,targetRoot,fsApi=fs){
  const backup=`${targetRoot}.previous`;
  await fsApi.rm(backup,{recursive:true,force:true});
  let movedCurrent=false;
  try{await fsApi.rename(targetRoot,backup);movedCurrent=true}catch(error){if(error.code!=="ENOENT")throw error}
  try{await fsApi.rename(staging,targetRoot)}
  catch(error){
    if(movedCurrent){
      try{await fsApi.rename(backup,targetRoot)}catch(rollbackError){error.message+=` Rollback also failed: ${rollbackError.message}`}
    }
    throw error;
  }
}

async function buildLibrary({ csvPath, photoFolder, audioFolder, targetRoot, ceremonyId=crypto.randomUUID() }) {
  const csvBuffer = await fs.readFile(csvPath);
  const parsed = parseStudents(csvBuffer.toString("utf8"));
  const staging = `${targetRoot}.staging-${crypto.randomUUID()}`;
  await fs.mkdir(staging, { recursive: true });
  const photos = {}, thumbnails = {}, audio = {}, unmatched = [];
  try {
    for (const file of await listFiles(photoFolder, PHOTO_EXTENSIONS)) {
      const id = path.parse(file).name;
      if (!parsed.students[id]) { unmatched.push(path.basename(file)); continue; }
      const source = sharp(file).rotate();
      const full = await source.clone().resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true }).webp({ quality: 86 }).toBuffer();
      const thumb = await source.clone().resize({ width: 180, height: 180, fit: "cover" }).webp({ quality: 76 }).toBuffer();
      photos[id] = await writeAsset(full, "photos", id, "image/webp", staging, path.basename(file));
      thumbnails[id] = await writeAsset(thumb, "thumbnails", id, "image/webp", staging, path.basename(file));
    }
    for (const file of await listFiles(audioFolder, new Set(Object.keys(AUDIO_MIME)))) {
      const extension = path.extname(file).toLowerCase();
      const id = path.parse(file).name;
      if (!parsed.students[id]) { unmatched.push(path.basename(file)); continue; }
      audio[id] = await writeAsset(await fs.readFile(file), "audio", id, AUDIO_MIME[extension], staging, path.basename(file));
    }
    const missingPhotos = calculateMissingPhotos(parsed.order, photos, thumbnails);
    const contentFingerprint = await sha256(Buffer.from(JSON.stringify({
      students: parsed.students,
      photos: Object.fromEntries(Object.entries(photos).map(([id, value]) => [id, value.hash])),
      audio: Object.fromEntries(Object.entries(audio).map(([id, value]) => [id, value.hash]))
    })));
    const manifest = {
      schemaVersion: 1,
      ceremonyId,
      libraryId: ceremonyId,
      version: `${Date.now()}-${contentFingerprint.slice(0, 12)}`,
      createdAt: new Date().toISOString(),
      students: parsed.students,
      order: parsed.order,
      assets: { photos, thumbnails, audio, backgrounds:{} },
      presentation:{projectorBackground:{enabled:false,overlay:35}},
      missingPhotos,
      recordings: Object.fromEntries(Object.entries(audio).map(([id, asset]) => [id, { source:"import", hash:asset.hash, publishedAt:new Date().toISOString() }])),
      unmatched,
      counts: {
        students: parsed.order.length,
        photos: Object.keys(photos).length,
        missingPhotos: missingPhotos.length,
        audio: Object.keys(audio).length
      }
    };
    await fs.writeFile(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2));
    await activateLibrary(staging,targetRoot);
    return manifest;
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function loadManifest(targetRoot) {
  try { return JSON.parse(await fs.readFile(path.join(targetRoot, "manifest.json"), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function ensureCeremonyIdentity(targetRoot) {
  const manifest=await loadManifest(targetRoot);
  if(!manifest)return null;
  if(manifest.ceremonyId)return manifest;
  manifest.ceremonyId=manifest.libraryId||manifest.version||crypto.randomUUID();
  manifest.libraryId=manifest.ceremonyId;
  const manifestPath=path.join(targetRoot,"manifest.json"),temporary=path.join(targetRoot,`manifest.${crypto.randomUUID()}.identity`);
  await fs.writeFile(temporary,JSON.stringify(manifest,null,2),{flag:"wx"});
  await fs.rename(temporary,manifestPath);
  return manifest;
}

module.exports = { buildLibrary, loadManifest, ensureCeremonyIdentity, sha256, activateLibrary, writeAsset };
