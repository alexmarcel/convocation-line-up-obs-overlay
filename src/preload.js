"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("graduationDesktop", {
  info:() => ipcRenderer.invoke("app-info"),
  copyText:(value) => ipcRenderer.invoke("copy-text", value),
  resetEverything:(confirmation) => ipcRenderer.invoke("reset-everything",confirmation),
  importLibrary:() => ipcRenderer.invoke("import-library"),
  maintenanceState:() => ipcRenderer.invoke("maintenance-state"),
  maintenanceStart:() => ipcRenderer.invoke("maintenance-start"),
  maintenanceAdd:(data) => ipcRenderer.invoke("maintenance-add",data),
  maintenanceEdit:(data) => ipcRenderer.invoke("maintenance-edit",data),
  maintenanceRemoveStudent:(id) => ipcRenderer.invoke("maintenance-remove-student",id),
  maintenanceMove:(data) => ipcRenderer.invoke("maintenance-move",data),
  maintenanceImportMedia:(data) => ipcRenderer.invoke("maintenance-import-media",data),
  maintenanceRemoveMedia:(data) => ipcRenderer.invoke("maintenance-remove-media",data),
  maintenanceReconcile:() => ipcRenderer.invoke("maintenance-reconcile"),
  maintenancePublish:() => ipcRenderer.invoke("maintenance-publish"),
  maintenanceDiscard:() => ipcRenderer.invoke("maintenance-discard"),
  exportLibraryCsv:() => ipcRenderer.invoke("export-library-csv"),
  exportLibraryMedia:(kind) => ipcRenderer.invoke("export-library-media",kind),
  recordingStatus:() => ipcRenderer.invoke("recording-status"),
  saveRecording:(data) => ipcRenderer.invoke("save-recording", data),
  readRecording:(id) => ipcRenderer.invoke("read-recording", id),
  deleteRecording:(id) => ipcRenderer.invoke("delete-recording", id),
  publishRecordings:() => ipcRenderer.invoke("publish-recordings")
  ,listBackups:() => ipcRenderer.invoke("list-backups")
  ,exportBackup:() => ipcRenderer.invoke("export-backup")
  ,inspectBackup:(snapshotId) => ipcRenderer.invoke("inspect-backup", snapshotId)
  ,restoreBackup:(token) => ipcRenderer.invoke("restore-backup", token)
  ,exportSnapshot:(id) => ipcRenderer.invoke("export-snapshot", id)
  ,deleteSnapshot:(id) => ipcRenderer.invoke("delete-snapshot", id)
  ,cancelOperation:() => ipcRenderer.invoke("cancel-operation")
  ,onBackupProgress:(callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("backup-progress", listener);
    return () => ipcRenderer.removeListener("backup-progress", listener);
  }
  ,generateBarcodes:(ids) => ipcRenderer.invoke("generate-barcodes", ids)
  ,printBarcodes:() => ipcRenderer.invoke("print-barcodes")
  ,saveBarcodePdf:() => ipcRenderer.invoke("save-barcode-pdf")
  ,uploadProjectorBackground:() => ipcRenderer.invoke("upload-projector-background")
  ,removeProjectorBackground:() => ipcRenderer.invoke("remove-projector-background")
  ,setProjectorBackgroundSettings:(data) => ipcRenderer.invoke("set-projector-background-settings",data)
  ,uploadMainBackground:() => ipcRenderer.invoke("upload-main-background")
  ,removeMainBackground:() => ipcRenderer.invoke("remove-main-background")
});
