"use strict";

const DB_NAME = "graduation-display";
const STORES = ["metadata","students","thumbnails","photos","audio","settings","offlineEvents"];
let dbPromise;

function openDb() {
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve, reject) => {
    // Open the browser's existing schema without forcing a version upgrade.
    // Backgrounds use a namespaced key in the existing settings store.
    const request = indexedDB.open(DB_NAME);
    request.onupgradeneeded = () => {
      for (const store of STORES) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
    };
    request.onsuccess = () => {
      const db=request.result;
      db.onversionchange=()=>{db.close();dbPromise=null};
      resolve(db);
    };
    request.onerror = () => {dbPromise=null;reject(request.error)};
    request.onblocked = () => {dbPromise=null;reject(new Error("Local cache is blocked by another open display tab. Close or refresh the other tab, then retry."))};
  });
  return dbPromise;
}
async function dbGet(store, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function dbPut(store, key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, "readwrite").objectStore(store).put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
async function dbDelete(store, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, "readwrite").objectStore(store).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
async function dbEntries(store) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).getAllKeys();
    request.onsuccess = async () => resolve(await Promise.all(request.result.map(async key => [key, await dbGet(store, key)])));
    request.onerror = () => reject(request.error);
  });
}
async function clearCeremonyCache(){
  const db=await openDb();
  await new Promise((resolve,reject)=>{const transaction=db.transaction(STORES,"readwrite");for(const store of STORES)transaction.objectStore(store).clear();transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||new Error("Cache reset was aborted."))});
}
async function digest(blob) {
  const bytes = blob instanceof Blob ? await blob.arrayBuffer() : blob;
  if(globalThis.crypto?.subtle){
    return [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2,"0")).join("");
  }
  return GraduationCrypto.sha256Hex(bytes);
}

function requiredAssets(manifest,role){
  return CachePolicy.kindsForRole(role).flatMap(kind=>Object.values(manifest.assets?.[kind]||{}).map(asset=>({...asset,kind,store:CachePolicy.storeForKind(kind),cacheKey:CachePolicy.keyForAsset(kind,asset.hash)})));
}
async function hasRequiredAssets(manifest,role){
  for(const asset of requiredAssets(manifest,role))if(!await dbGet(asset.store,asset.cacheKey))return false;
  return true;
}

async function syncLibrary(role, progress = () => {}) {
  const response = await fetch("/api/manifest", { cache:"no-store" });
  if (!response.ok) throw new Error((await response.json()).error || "Manifest unavailable");
  const manifest = await response.json();
  const manifestKey=CachePolicy.manifestKeyForRole(role),active=await dbGet("metadata",manifestKey);
  if(active?.version===manifest.version&&await hasRequiredAssets(manifest,role))return active;
  const kinds=CachePolicy.kindsForRole(role),required=requiredAssets(manifest,role);
  let completed = 0;
  const worker = async (asset) => {
    const cached = await dbGet(asset.store, asset.cacheKey);
    if (!cached) {
      let lastError;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const result = await fetch(asset.url);
          if (!result.ok) throw new Error(`Download failed (${result.status})`);
          const blob = await result.blob();
          if (await digest(blob) !== asset.hash) throw new Error("Asset hash verification failed");
          await dbPut(asset.store, asset.cacheKey, blob);
          lastError = null; break;
        } catch (error) { lastError = error; }
      }
      if (lastError) throw lastError;
    }
    completed++; progress(completed, required.length);
  };
  let cursor = 0;
  await Promise.all(Array.from({ length:Math.min(4, Math.max(1, required.length)) }, async () => {
    while (cursor < required.length) await worker(required[cursor++]);
  }));
  await dbPut("students", manifest.version, { students:manifest.students, order:manifest.order });
  await dbPut("metadata",manifestKey,manifest);
  for (const kind of kinds) {
    const valid = new Set(Object.values(manifest.assets?.[kind]||{}).map(asset => asset.hash));
    const store=CachePolicy.storeForKind(kind);
    for (const [key] of await dbEntries(store)){
      if(kind==="backgrounds"){
        if(CachePolicy.isAssetKey(kind,key)&&!valid.has(String(key).slice("background:".length)))await dbDelete(store,key);
      }else if(!valid.has(key))await dbDelete(store,key);
    }
  }
  return manifest;
}

async function cachedLibrary(role) {
  const manifest=await dbGet("metadata",CachePolicy.manifestKeyForRole(role));
  if (!manifest) return null;
  const data = await dbGet("students", manifest.version);
  return { manifest, ...data };
}
async function assetUrl(manifest, kind, id) {
  const asset = manifest?.assets?.[kind]?.[id];
  if (!asset) return "";
  const blob = await dbGet(CachePolicy.storeForKind(kind),CachePolicy.keyForAsset(kind,asset.hash));
  return blob ? URL.createObjectURL(blob) : "";
}
window.GraduationCache = { syncLibrary, cachedLibrary, assetUrl, dbGet, dbPut, dbDelete, dbEntries, clearCeremonyCache };
