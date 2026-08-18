"use strict";

const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, session } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");
const { buildLibrary, ensureCeremonyIdentity } = require("./library");
const { startServer } = require("./server");
const { recordingStatus, saveDraft, readDraft, deleteDraft, publishDrafts } = require("./recordings");
const { OperationCoordinator } = require("./operations");
const { createBackup, inspectBackup, restoreBackup, recoverRestore, listSnapshots, createSnapshot } = require("./backups");
const { generateBarcodeBatch } = require("./barcodes");
const { EventLedger } = require("./event-ledger");
const { OutputRegistry } = require("./output-registry");
const { draftsRootFor, migrateLegacyDrafts } = require("./library-key");
const Maintenance = require("./maintenance");
const ProjectorBackground = require("./projector-background");
const { exportMedia } = require("./media-export");
const ControllerSettings = require("./controller-settings");
const { resetEverything, recoverFactoryReset, validConfirmation } = require("./factory-reset");

let mainWindow, server, manifest;
const PORT = 4173;
const operations = new OperationCoordinator();
const inspectedBackups = new Map();
let libraryRoot, draftsBaseRoot, backupsRoot, workingRoot, userDataRoot, controllerSettingsPath, outputRegistry, eventLedger;
let quitting = false;
let closeWarningOpen = false;
let automaticSnapshotTimer = null;
let controllerSettingsWriteChain=Promise.resolve();
const singleInstance=app.requestSingleInstanceLock();
if(!singleInstance)app.quit();
app.on("second-instance",async()=>{
  if(!app.isReady())return;
  if(!mainWindow||mainWindow.isDestroyed()){
    if(server)await createMainWindow();
    return;
  }
  if(mainWindow.isMinimized())mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});
const currentDraftsRoot=()=>draftsRootFor(draftsBaseRoot,manifest);
const backupControllerState=()=>({settings:server?.snapshot()?.state?.settings||{}});
const persistControllerSettings=settings=>(controllerSettingsWriteChain=controllerSettingsWriteChain.then(()=>ControllerSettings.write(controllerSettingsPath,settings),()=>ControllerSettings.write(controllerSettingsPath,settings)));

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter(item => item?.family === "IPv4" && !item.internal).map(item => item.address);
}
function progress(data) {
  if (!mainWindow?.isDestroyed()) mainWindow.webContents.send("backup-progress", data);
}
async function createMainWindow() {
  if(mainWindow&&!mainWindow.isDestroyed())return mainWindow;
  const window = new BrowserWindow({
    width:1440, height:900, minWidth:1050, minHeight:700,
    webPreferences:{ preload:path.join(__dirname, "preload.js"), contextIsolation:true, nodeIntegration:false }
  });
  mainWindow=window;
  window.on("close",event=>{
    const operation=operations.status();
    if(quitting||!operation.busy)return;
    event.preventDefault();
    if(closeWarningOpen)return;
    closeWarningOpen=true;
    void dialog.showMessageBox(window,{
      type:"warning",title:"Operation in progress",
      message:`Wait for "${operation.type}" to finish or cancel it before closing Graduation Display.`
    }).finally(()=>{closeWarningOpen=false});
  });
  window.on("closed",()=>{if(mainWindow===window)mainWindow=null});
  await window.loadURL(`http://127.0.0.1:${PORT}/controller`);
  return window;
}
function snapshotView(snapshot) {
  return {
    id:snapshot.name, name:snapshot.name, valid:snapshot.valid,
    metadata:snapshot.metadata, error:snapshot.error
  };
}
async function snapshots() {
  return (await listSnapshots(backupsRoot)).map(snapshotView);
}
async function chooseDirectory(title) {
  const result = await dialog.showOpenDialog(mainWindow, { title, properties:["openDirectory"] });
  return result.canceled ? null : result.filePaths[0];
}
async function hasManagedData() {
  try {
    if (manifest) return true;
    return (await fsp.readdir(currentDraftsRoot())).some(name => name.endsWith(".wav"));
  } catch { return false; }
}
async function safetySnapshot(reason, signal) {
  if (!await hasManagedData()) return null;
  const snapshotProgress=data=>progress({...data,automaticSnapshot:true});
  try {
    return await createSnapshot({
      libraryRoot, draftsRoot:currentDraftsRoot(), backupsRoot, appVersion:app.getVersion(), reason, signal, onProgress:snapshotProgress, controllerState:backupControllerState()
    });
  } finally {
    snapshotProgress({phase:"snapshot-finished",terminal:true,processedBytes:0,totalBytes:0,percent:100});
  }
}
function configureAutomaticSnapshots(settings){
  if(automaticSnapshotTimer){clearInterval(automaticSnapshotTimer);automaticSnapshotTimer=null}
  if(!settings?.automaticSnapshotsEnabled)return;
  automaticSnapshotTimer=setInterval(()=>{
    if(operations.status().busy)return;
    void operations.run("scheduled safety snapshot",signal=>safetySnapshot("scheduled",signal)).catch(error=>console.error("Scheduled safety snapshot failed:",error));
  },ControllerSettings.automaticSnapshotIntervalMs(settings));
  automaticSnapshotTimer.unref?.();
}
async function maintenanceView() {
  const state=await Maintenance.readState(workingRoot);
  if(!state)return{state:null,diff:null};
  return{state,manifest,diff:manifest?Maintenance.diff(manifest,state):null,recording:await recordingStatus(currentDraftsRoot(),manifest)};
}
async function requireNoWorkingCopy(action) {
  if(await Maintenance.readState(workingRoot))throw new Error(`Publish or discard the staged library changes before ${action}.`);
}
function snapshotPath(id) {
  const name = path.basename(String(id || ""));
  if (name !== id || !name.endsWith(".graduation-backup")) throw new Error("Invalid snapshot identifier.");
  const resolved = path.resolve(backupsRoot, name);
  if (!resolved.startsWith(path.resolve(backupsRoot) + path.sep)) throw new Error("Invalid snapshot path.");
  return resolved;
}
async function copyWithProgress(source, destination, signal) {
  const stat = await fsp.stat(source);
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  let processed = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      if (signal.aborted) return callback(new Error("Operation cancelled."));
      processed += chunk.length;
      progress({ phase:"export", processedBytes:processed, totalBytes:stat.size, percent:Math.round(processed / stat.size * 100) });
      callback(null, chunk);
    }
  });
  try {
    await pipeline(fs.createReadStream(source), meter, fs.createWriteStream(temporary, { flags:"wx" }));
    await fsp.rename(temporary, destination);
    return { destination, archiveBytes:stat.size };
  } catch (error) { await fsp.rm(temporary, { force:true }); throw error; }
}

if(singleInstance)app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  userDataRoot = app.getPath("userData");
  libraryRoot = path.join(userDataRoot, "ceremony-library");
  draftsBaseRoot = path.join(userDataRoot, "recording-drafts");
  backupsRoot = path.join(userDataRoot, "backups");
  workingRoot = path.join(userDataRoot, "library-working");
  controllerSettingsPath = path.join(userDataRoot,"controller-settings.json");
  await recoverFactoryReset(userDataRoot);
  await recoverRestore({ userDataRoot, libraryRoot, draftsRoot:draftsBaseRoot });
  manifest = await ensureCeremonyIdentity(libraryRoot);
  await migrateLegacyDrafts(draftsBaseRoot,manifest);
  eventLedger=await EventLedger.open(path.join(userDataRoot,"event-ledger.json"));
  outputRegistry=await OutputRegistry.open(path.join(userDataRoot,"output-registry.json"),manifest?.ceremonyId);
  const initialSettings=await ControllerSettings.read(controllerSettingsPath);
  server = startServer({
    publicRoot:path.join(__dirname, "..", "public"),
    libraryRoot,
    getManifest:() => manifest,
    eventLedger,
    outputRegistry,
    initialSettings,
    onSettingsChange:async settings=>{const saved=await persistControllerSettings(settings);configureAutomaticSnapshots(saved);return saved},
    port:PORT
  });
  configureAutomaticSnapshots(initialSettings);
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    permission === "media" && String(requestingOrigin || "").startsWith(`http://127.0.0.1:${PORT}`));
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) =>
    callback(permission === "media" && webContents.getURL().startsWith(`http://127.0.0.1:${PORT}/controller`)));

  ipcMain.handle("app-info", () => ({ port:PORT, addresses:lanAddresses(), manifest, snapshot:server.snapshot(), operation:operations.status() }));
  ipcMain.handle("reset-everything",async(_event,confirmation)=>{
    if(!validConfirmation(confirmation))return{error:"Type RESET EVERYTHING exactly to confirm."};
    try{return await operations.run("reset everything",async()=>{
      if(automaticSnapshotTimer){clearInterval(automaticSnapshotTimer);automaticSnapshotTimer=null}
      await server.resetRemoteCaches();
      await Promise.all([outputRegistry.writeChain,eventLedger.writeChain,controllerSettingsWriteChain]);
      await server.close();server=null;
      await session.defaultSession.clearStorageData({origin:`http://127.0.0.1:${PORT}`,storages:["localstorage","indexdb"]});
      const result=await resetEverything(userDataRoot);manifest=null;inspectedBackups.clear();
      setTimeout(()=>{app.relaunch();app.exit(0)},250);return{reset:true,...result};
    })}catch(error){if(!server)setTimeout(()=>{app.relaunch();app.exit(1)},500);return{error:error.message}}
  });
  await createMainWindow();
  ipcMain.handle("copy-text", (_event, value) => {
    const text=String(value??"");
    if(!text||text.length>4096)throw new Error("Invalid clipboard text.");
    clipboard.writeText(text);
    return { ok:true };
  });
  ipcMain.handle("recording-status", () => recordingStatus(currentDraftsRoot(), manifest));
  ipcMain.handle("save-recording", async (_event, data) => {
    try {
      return await operations.run("save recording", async () => {
        const draftsRoot=currentDraftsRoot(),result=await saveDraft({ ...data, draftsRoot, manifest });
        return { result, status:await recordingStatus(draftsRoot, manifest) };
      });
    } catch (error) { return { error:error.message }; }
  });
  ipcMain.handle("read-recording", async (_event, id) => {
    try { return { bytes:await readDraft(id, currentDraftsRoot()) }; }
    catch (error) { return { error:error.code === "ENOENT" ? "No draft recording exists." : error.message }; }
  });
  ipcMain.handle("delete-recording", async (_event, id) => {
    try {
      return await operations.run("delete recording", async () => {
        const draftsRoot=currentDraftsRoot();await deleteDraft(id, draftsRoot);
        return { status:await recordingStatus(draftsRoot, manifest) };
      });
    } catch (error) { return { error:error.message }; }
  });
  ipcMain.handle("publish-recordings", async () => {
    try {
      return await operations.run("publish recordings", async signal => {
        await requireNoWorkingCopy("publishing recordings");
        await safetySnapshot("before-publish", signal);
        const draftsRoot=currentDraftsRoot();manifest = await publishDrafts({ draftsRoot, libraryRoot });
        server.libraryChanged();
        return { manifest, status:await recordingStatus(draftsRoot, manifest), snapshots:await snapshots() };
      });
    } catch (error) { return { error:error.message }; }
  });
  ipcMain.handle("import-library", async () => {
    if(await Maintenance.readState(workingRoot))return{error:"Publish or discard the staged library changes before starting a new ceremony."};
    const csv = await dialog.showOpenDialog(mainWindow, { title:"Select student CSV", properties:["openFile"], filters:[{ name:"CSV", extensions:["csv"] }] });
    if (csv.canceled) return { canceled:true };
    const photoFolder = await chooseDirectory("Select student photo folder (Cancel to skip)");
    const audioFolder = await chooseDirectory("Select student audio folder (Cancel to skip)");
    try {
      return await operations.run("import library", async signal => {
        await requireNoWorkingCopy("starting a new ceremony");
        await safetySnapshot("before-import", signal);
        manifest = await buildLibrary({ csvPath:csv.filePaths[0], photoFolder, audioFolder, targetRoot:libraryRoot });
        await outputRegistry.activate(manifest?.ceremonyId,{reset:true});
        server.libraryChanged();
        return { manifest, snapshots:await snapshots() };
      });
    } catch (error) { return { error:error.message }; }
  });
  ipcMain.handle("maintenance-state", async () => {
    try{return await maintenanceView()}catch(error){return{error:error.message}}
  });
  ipcMain.handle("maintenance-start", async () => {
    try{return await operations.run("start library maintenance",async()=>{await Maintenance.loadOrCreate(workingRoot,manifest);return maintenanceView()})}
    catch(error){return{error:error.message}}
  });
  ipcMain.handle("maintenance-add", async (_event,data) => {
    try{return await operations.run("add student",async()=>{await Maintenance.addStudent({workingRoot,manifest,...data});return maintenanceView()})}
    catch(error){return{error:error.message}}
  });
  ipcMain.handle("maintenance-edit", async (_event,data) => {
    try{return await operations.run("edit student",async()=>{await Maintenance.editStudent({workingRoot,manifest,...data});return maintenanceView()})}
    catch(error){return{error:error.message}}
  });
  ipcMain.handle("maintenance-remove-student", async (_event,id) => {
    try{return await operations.run("remove student",async()=>{await Maintenance.removeStudent({workingRoot,manifest,id});return maintenanceView()})}
    catch(error){return{error:error.message}}
  });
  ipcMain.handle("maintenance-move", async (_event,data) => {
    try{return await operations.run("reorder student",async()=>{await Maintenance.moveStudent({workingRoot,manifest,...data});return maintenanceView()})}
    catch(error){return{error:error.message}}
  });
  ipcMain.handle("maintenance-import-media", async (_event,data) => {
    const kind=data.kind==="photos"?"photos":"audio",result=await dialog.showOpenDialog(mainWindow,{
      title:kind==="photos"?"Choose student photo":"Choose student audio",properties:["openFile"],
      filters:kind==="photos"?[{name:"Images",extensions:["jpg","jpeg","png","webp"]}]:[{name:"Audio",extensions:["mp3","wav"]}]
    });
    if(result.canceled)return{canceled:true};
    try{return await operations.run("stage student media",async()=>{await Maintenance.stageMedia({workingRoot,manifest,id:data.id,kind,sourcePath:result.filePaths[0]});return maintenanceView()})}
    catch(error){return{error:error.message}}
  });
  ipcMain.handle("maintenance-remove-media", async (_event,data) => {
    try{return await operations.run("remove student media",async()=>{await Maintenance.removeMedia({workingRoot,manifest,...data});return maintenanceView()})}
    catch(error){return{error:error.message}}
  });
  ipcMain.handle("maintenance-reconcile", async () => {
    if(!manifest)return{error:"Import a ceremony library before updating it."};
    const csv=await dialog.showOpenDialog(mainWindow,{title:"Select updated student CSV",properties:["openFile"],filters:[{name:"CSV",extensions:["csv"]}]});
    if(csv.canceled)return{canceled:true};
    const photoFolder=await chooseDirectory("Select replacement photo folder (Cancel to preserve existing photos)");
    const audioFolder=await chooseDirectory("Select replacement audio folder (Cancel to preserve existing audio)");
    try{return await operations.run("reconcile updated CSV",async()=>{const result=await Maintenance.reconcile({workingRoot,manifest,csvPath:csv.filePaths[0],photoFolder,audioFolder});return{...(await maintenanceView()),summary:result.summary}})}
    catch(error){return{error:error.message}}
  });
  ipcMain.handle("maintenance-publish", async () => {
    try{return await operations.run("publish library maintenance",async signal=>{
      await safetySnapshot("before-library-maintenance",signal);
      const result=await Maintenance.publish({workingRoot,libraryRoot,draftsRoot:currentDraftsRoot()});manifest=result.manifest;server.libraryChanged();
      return{manifest,diff:result.diff,warnings:result.warnings,snapshots:await snapshots()};
    })}catch(error){return{error:error.message}}
  });
  ipcMain.handle("maintenance-discard", async () => {
    try{return await operations.run("discard library maintenance",async()=>Maintenance.discard(workingRoot))}
    catch(error){return{error:error.message}}
  });
  ipcMain.handle("export-library-csv", async () => {
    if(!manifest)return{error:"No ceremony library is active."};
    const result=await dialog.showSaveDialog(mainWindow,{title:"Export Current Student CSV",defaultPath:"students-current.csv",filters:[{name:"CSV",extensions:["csv"]}]});
    if(result.canceled)return{canceled:true};
    try{
      const temporary=`${result.filePath}.${crypto.randomUUID()}.tmp`;await fsp.writeFile(temporary,Maintenance.exportCsv(manifest),{flag:"wx"});await fsp.rename(temporary,result.filePath);
      return{destination:result.filePath};
    }catch(error){return{error:error.message}}
  });
  ipcMain.handle("export-library-media", async (_event,kind) => {
    if(!manifest)return{error:"No ceremony library is active."};
    if(!["photos","audio"].includes(kind))return{error:"Invalid media export type."};
    const selected=await dialog.showOpenDialog(mainWindow,{title:`Choose where to export ceremony ${kind}`,properties:["openDirectory","createDirectory"]});
    if(selected.canceled)return{canceled:true};
    try{return await operations.run(`export ${kind}`,signal=>exportMedia({libraryRoot,manifest,kind,destinationRoot:selected.filePaths[0],signal}))}
    catch(error){return{error:error.message}}
  });
  ipcMain.handle("upload-projector-background", async () => {
    if(!manifest)return{error:"Import a ceremony library before uploading a projector background."};
    const selected=await dialog.showOpenDialog(mainWindow,{title:"Choose projector background",properties:["openFile"],filters:[{name:"Images",extensions:["png","jpg","jpeg","webp"]}]});
    if(selected.canceled)return{canceled:true};
    try{return await operations.run("publish projector background",async signal=>{
      await requireNoWorkingCopy("changing the projector background");
      await safetySnapshot("before-projector-background",signal);
      manifest=await ProjectorBackground.publish({libraryRoot,sourcePath:selected.filePaths[0]});
      server.libraryChanged();
      return{manifest,snapshots:await snapshots()};
    })}catch(error){return{error:error.message}}
  });
  ipcMain.handle("remove-projector-background", async () => {
    try{return await operations.run("remove projector background",async signal=>{
      await requireNoWorkingCopy("removing the projector background");
      await safetySnapshot("before-projector-background",signal);
      manifest=await ProjectorBackground.remove({libraryRoot});
      server.libraryChanged();
      return{manifest,snapshots:await snapshots()};
    })}catch(error){return{error:error.message}}
  });
  ipcMain.handle("set-projector-background-settings", async (_event,data) => {
    try{return await operations.run("save projector background settings",async()=>{
      manifest=await ProjectorBackground.updateSettings({libraryRoot,enabled:data?.enabled,overlay:data?.overlay});
      return{manifest};
    })}catch(error){return{error:error.message}}
  });
  ipcMain.handle("upload-main-background",async()=>{
    if(!manifest)return{error:"Import a ceremony library before uploading a main background."};
    const selected=await dialog.showOpenDialog(mainWindow,{title:"Choose main standby background",properties:["openFile"],filters:[{name:"Images",extensions:["png","jpg","jpeg","webp"]}]});if(selected.canceled)return{canceled:true};
    try{return await operations.run("publish main background",async signal=>{await requireNoWorkingCopy("changing the main background");await safetySnapshot("before-main-background",signal);manifest=await ProjectorBackground.publishMain({libraryRoot,sourcePath:selected.filePaths[0]});server.libraryChanged();return{manifest,snapshots:await snapshots()}})}catch(error){return{error:error.message}}
  });
  ipcMain.handle("remove-main-background",async()=>{
    try{return await operations.run("remove main background",async signal=>{await requireNoWorkingCopy("removing the main background");await safetySnapshot("before-main-background",signal);manifest=await ProjectorBackground.removeMain({libraryRoot});server.libraryChanged();return{manifest,snapshots:await snapshots()}})}catch(error){return{error:error.message}}
  });

  ipcMain.handle("list-backups", async () => {
    try { return { snapshots:await snapshots() }; } catch (error) { return { error:error.message }; }
  });
  ipcMain.handle("export-backup", async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title:"Export Graduation Backup",
      defaultPath:`graduation-${new Date().toISOString().slice(0, 10)}.graduation-backup`,
      filters:[{ name:"Graduation Backup", extensions:["graduation-backup"] }]
    });
    if (result.canceled) return { canceled:true };
    try {
      return await operations.run("export backup", signal => createBackup({
        libraryRoot, draftsRoot:currentDraftsRoot(), destination:result.filePath, appVersion:app.getVersion(), reason:"manual", signal, onProgress:progress, controllerState:backupControllerState()
      }));
    } catch (error) { return { error:error.message }; }
  });
  ipcMain.handle("inspect-backup", async (_event, snapshotId) => {
    let backupPath;
    if (snapshotId) backupPath = snapshotPath(snapshotId);
    else {
      const result = await dialog.showOpenDialog(mainWindow, {
        title:"Select Graduation Backup", properties:["openFile"],
        filters:[{ name:"Graduation Backup", extensions:["graduation-backup"] }]
      });
      if (result.canceled) return { canceled:true };
      backupPath = result.filePaths[0];
    }
    try {
      return await operations.run("validate backup", async signal => {
        const inspected = await inspectBackup({ backupPath, signal, onProgress:progress });
        const token = crypto.randomUUID();
        inspectedBackups.clear();
        inspectedBackups.set(token, { backupPath, inspected });
        return { token, metadata:inspected.metadata };
      });
    } catch (error) { return { error:error.message }; }
  });
  ipcMain.handle("restore-backup", async (_event, token) => {
    const cached = inspectedBackups.get(token);
    if (!cached) return { error:"The restore preview expired. Inspect the backup again." };
    try {
      return await operations.run("restore backup", async signal => {
        await requireNoWorkingCopy("restoring a backup");
        await safetySnapshot("before-restore", signal);
        const restoredDraftsRoot=draftsRootFor(draftsBaseRoot,cached.inspected.library);
        const restored = await restoreBackup({
          backupPath:cached.backupPath, userDataRoot, libraryRoot, draftsRoot:restoredDraftsRoot,
          signal, onProgress:progress, inspected:cached.inspected
        });
        manifest = await ensureCeremonyIdentity(libraryRoot);
        if(restored.metadata.controllerState){
          const settings=await persistControllerSettings(restored.metadata.controllerState.settings);
          server.applySettings(settings);
        }
        await outputRegistry.activate(manifest?.ceremonyId,{reset:true});
        inspectedBackups.clear();
        server.clearDisplay();
        server.libraryChanged();
        return {
          manifest,
          status:await recordingStatus(currentDraftsRoot(), manifest),
          metadata:restored.metadata,
          snapshots:await snapshots()
        };
      });
    } catch (error) { return { error:error.message }; }
  });
  ipcMain.handle("export-snapshot", async (_event, id) => {
    try {
      const source = snapshotPath(id);
      const result = await dialog.showSaveDialog(mainWindow, {
        title:"Export Safety Snapshot", defaultPath:id,
        filters:[{ name:"Graduation Backup", extensions:["graduation-backup"] }]
      });
      if (result.canceled) return { canceled:true };
      return await operations.run("export snapshot", signal => copyWithProgress(source, result.filePath, signal));
    } catch (error) { return { error:error.message }; }
  });
  ipcMain.handle("delete-snapshot", async (_event, id) => {
    try {
      return await operations.run("delete snapshot", async () => {
        await fsp.rm(snapshotPath(id), { force:true });
        return { snapshots:await snapshots() };
      });
    } catch (error) { return { error:error.message }; }
  });
  ipcMain.handle("cancel-operation", () => ({ cancelled:operations.cancel() }));
  ipcMain.handle("generate-barcodes", async (_event, ids) => {
    try {
      if (!manifest) throw new Error("Import a ceremony library before printing barcodes.");
      const unique = [...new Set((ids || []).map(String))];
      if (!unique.length) throw new Error("Select at least one student.");
      if (unique.length > 20000) throw new Error("Too many barcode records were requested.");
      for (const id of unique) if (!manifest.students[id]) throw new Error(`Student ${id} is not in the active library.`);
      return generateBarcodeBatch(unique);
    } catch (error) { return { error:error.message }; }
  });
  ipcMain.handle("print-barcodes", async () => {
    try {
      return await operations.run("print barcodes", () => new Promise(resolve => {
        mainWindow.webContents.print({ silent:false, printBackground:true, color:true }, (success, failureReason) => {
          if (success) resolve({ printed:true });
          else if (/cancel/i.test(failureReason || "")) resolve({ cancelled:true });
          else resolve({ error:failureReason || "The print job failed." });
        });
      }));
    } catch (error) { return { error:error.message }; }
  });
  ipcMain.handle("save-barcode-pdf", async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title:"Save Barcode Labels as PDF",
      defaultPath:`graduation-barcodes-${new Date().toISOString().slice(0, 10)}.pdf`,
      filters:[{ name:"PDF Document", extensions:["pdf"] }]
    });
    if (result.canceled) return { cancelled:true };
    try {
      return await operations.run("save barcode PDF", async () => {
        const pdf = await mainWindow.webContents.printToPDF({
          printBackground:true, preferCSSPageSize:true, pageSize:"A4", landscape:false
        });
        const temporary = `${result.filePath}.${crypto.randomUUID()}.tmp`;
        try {
          await fsp.writeFile(temporary, pdf, { flag:"wx" });
          await fsp.rename(temporary, result.filePath);
        } catch (error) { await fsp.rm(temporary, { force:true }); throw error; }
        return { destination:result.filePath, bytes:pdf.length };
      });
    } catch (error) { return { error:error.message }; }
  });
}).catch(error=>{
  console.error("Graduation Display failed to start:",error);
  dialog.showErrorBox("Graduation Display could not start",error?.stack||error?.message||String(error));
  app.quit();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", event => {
  if (!quitting && operations.status().busy) {
    event.preventDefault();
    dialog.showMessageBox(mainWindow, {
      type:"warning", title:"Operation in progress",
      message:`Wait for "${operations.status().type}" to finish or cancel it before closing Graduation Display.`
    });
    return;
  }
  quitting = true;
  if(automaticSnapshotTimer)clearInterval(automaticSnapshotTimer);
  server?.close();
});
