"use strict";

(() => {
  const $ = id => document.getElementById(id);
  let restoreToken = null;
  let manualOperation = false;
  const actionButtons = [$("exportBackup"), $("restoreBackup")];

  function setBusy(busy) {
    if(busy)$("backupPanel").open=true;
    for (const button of actionButtons) button.disabled = busy;
    $("backupProgress").hidden = !busy;
    if (!busy) $("backupProgressBar").style.width = "0";
  }
  function message(text, error = false) {
    $("backupMessage").textContent = text || "";
    $("backupMessage").style.color = error ? "var(--danger)" : "var(--muted)";
  }
  function formatBytes(value = 0) {
    if (value < 1024) return `${value} B`;
    const units = ["KB","MB","GB","TB"]; let size=value/1024, index=0;
    while (size >= 1024 && index < units.length - 1) { size/=1024; index++; }
    return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[index]}`;
  }
  function escapeHtml(value) { const div=document.createElement("div"); div.textContent=String(value); return div.innerHTML; }

  async function refreshSnapshots(provided) {
    const result = provided ? { snapshots:provided } : await window.graduationDesktop.listBackups();
    if (result.error) return message(result.error, true);
    const items = result.snapshots || [];
    $("snapshotList").className = `snapshots${items.length ? "" : " empty"}`;
    $("snapshotList").innerHTML = items.length ? items.map(snapshot => {
      if (!snapshot.valid) return `<div class="row"><div><b>${escapeHtml(snapshot.name)}</b><div class="snapshot-meta"><span>Invalid: ${escapeHtml(snapshot.error)}</span></div></div><div class="row-actions"><button class="danger" data-delete="${escapeHtml(snapshot.id)}">Delete</button></div></div>`;
      const meta = snapshot.metadata;
      return `<div class="row"><div><b>${new Date(meta.createdAt).toLocaleString()}</b><div class="snapshot-meta"><span>${escapeHtml(meta.reason)}</span><span>${meta.counts.students} students</span><span>${meta.counts.audio} audio</span><span>${meta.counts.drafts} drafts</span><span>${formatBytes(meta.totalBytes)}</span></div></div><div class="row-actions"><button data-restore="${escapeHtml(snapshot.id)}">Restore</button><button class="secondary" data-export="${escapeHtml(snapshot.id)}">Export</button><button class="danger" data-delete="${escapeHtml(snapshot.id)}">Delete</button></div></div>`;
    }).join("") : "No safety snapshots";
  }

  async function exportBackup() {
    manualOperation=true;setBusy(true); message("Preparing backup inventory...");
    const result = await window.graduationDesktop.exportBackup();
    manualOperation=false;setBusy(false);
    if (result.error) return message(result.error, true);
    if (!result.canceled) message(`Backup saved to ${result.destination} (${formatBytes(result.archiveBytes)}).`);
  }

  async function inspect(snapshotId) {
    manualOperation=true;setBusy(true); message("Validating backup contents and hashes...");
    const result = await window.graduationDesktop.inspectBackup(snapshotId);
    manualOperation=false;setBusy(false);
    if (result.error) return message(result.error, true);
    if (result.canceled) return;
    restoreToken = result.token;
    const meta = result.metadata;
    $("restoreDetails").innerHTML = `
      <div><span>Created</span><b>${new Date(meta.createdAt).toLocaleString()}</b></div>
      <div><span>Library version</span><b>${escapeHtml(meta.libraryVersion || "No published library")}</b></div>
      <div><span>Students</span><b>${meta.counts.students}</b></div>
      <div><span>Photos</span><b>${meta.counts.photos}</b></div>
      <div><span>Audio</span><b>${meta.counts.audio}</b></div>
      <div><span>Recording drafts</span><b>${meta.counts.drafts}</b></div>
      <div><span>Source app</span><b>${escapeHtml(meta.appVersion)}</b></div>
      <div><span>Restored size</span><b>${formatBytes(meta.totalBytes)}</b></div>`;
    $("restoreError").textContent = "";
    $("restorePreview").hidden = false;
  }

  async function restore() {
    if (!restoreToken) return;
    $("confirmRestore").disabled = true; $("cancelRestore").disabled = true;
    $("restoreError").textContent = "Creating safety snapshot and restoring...";
    $("restorePreview").hidden = true; manualOperation=true;setBusy(true);
    const result = await window.graduationDesktop.restoreBackup(restoreToken);
    manualOperation=false;setBusy(false); $("confirmRestore").disabled = false; $("cancelRestore").disabled = false;
    if (result.error) return message(result.error, true);
    restoreToken = null;
    window.renderManifest?.(result.manifest);
    await refreshSnapshots(result.snapshots);
    message(`Restored backup from ${new Date(result.metadata.createdAt).toLocaleString()}. Connected devices are synchronizing.`);
  }

  $("exportBackup").onclick = exportBackup;
  $("restoreBackup").onclick = () => inspect();
  $("confirmRestore").onclick = restore;
  $("cancelRestore").onclick = () => { restoreToken=null; $("restorePreview").hidden=true; };
  $("cancelBackup").onclick = () => window.graduationDesktop.cancelOperation();
  $("snapshotList").onclick = async event => {
    const restoreButton=event.target.closest("[data-restore]"), exportButton=event.target.closest("[data-export]"), deleteButton=event.target.closest("[data-delete]");
    if (restoreButton) return inspect(restoreButton.dataset.restore);
    if (exportButton) {
      manualOperation=true;setBusy(true);
      const result=await window.graduationDesktop.exportSnapshot(exportButton.dataset.export);
      manualOperation=false;setBusy(false);
      if (result.error) message(result.error,true); else if (!result.canceled) message(`Snapshot exported to ${result.destination}.`);
    }
    if (deleteButton && confirm("Delete this automatic safety snapshot?")) {
      const result=await window.graduationDesktop.deleteSnapshot(deleteButton.dataset.delete);
      if (result.error) message(result.error,true); else refreshSnapshots(result.snapshots);
    }
  };
  window.graduationDesktop.onBackupProgress(data => {
    if(data.automaticSnapshot&&!manualOperation){
      if(data.terminal)refreshSnapshots();
      return;
    }
    setBusy(true);
    $("backupProgressBar").style.width = `${data.percent || 0}%`;
    $("backupProgressText").textContent = `${data.phase} · ${data.percent || 0}% · ${formatBytes(data.processedBytes)} / ${formatBytes(data.totalBytes)}`;
  });
  window.addEventListener("library-updated", () => refreshSnapshots());
  window.addEventListener("recordings-published", () => refreshSnapshots());
  refreshSnapshots();
})();
