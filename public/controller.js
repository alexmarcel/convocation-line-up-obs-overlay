"use strict";
const $ = id => document.getElementById(id);
const OUTPUT_SETTINGS_KEY = "graduation-output-settings-v1";
let latestStatus = { devices:[], pending:[] };
let controllerManifest = null;
let audioPreview = null, audioPreviewButton = null;
let controllerAudio=null,controllerAudioFadeTimer=null,controllerAudioUnlocked=false;
let editingDeviceId=null;
const heroTimeline=new AudioTimeline.Timeline($("heroAudioTimeline"));let heroTimelineStudentId=null;
const connection = createGraduationConnection("controller", {
  open:() => {
    $("serverDot").classList.add("ready"); $("serverState").textContent="Server online";renderHero();
  },
  close:() => { $("serverDot").classList.remove("ready"); $("serverState").textContent="Reconnecting…";renderHero(); },
  message:(message) => {
    if (message.type === "SERVER_STATUS") { latestStatus=message.payload; renderStatus(); }
    if (message.type === "SHOW_STUDENT") void playControllerAnnouncement(message.payload.id);
    if (message.type === "CLEAR") stopControllerAnnouncement();
    if (message.type === "STATE_SNAPSHOT" && message.payload.state?.settings) applySettings(message.payload.state.settings);
    if (message.type === "SETTINGS") applySettings(message.payload);
  }
});
function renderManifest(manifest) {
  controllerManifest = manifest;
  heroTimelineStudentId=null;
  const missingPhotos = PhotoStatus.missingPhotosForManifest(manifest);
  $("studentCount").textContent=manifest?.counts?.students || 0; $("photoCount").textContent=manifest?.counts?.photos || 0; $("audioCount").textContent=manifest?.counts?.audio || 0;
  $("missingPhotoCount").textContent=missingPhotos.length;
  $("version").textContent=manifest ? `Library ${manifest.version}` : "No library imported";
  const unmatched=manifest?.unmatched||[];
  $("unmatched").innerHTML=unmatched.length?`<details class="warning unmatched-media-card"><summary><span><b>Unmatched media</b><small>${unmatched.length} file${unmatched.length===1?"":"s"} could not be matched to a student</small></span></summary><ul>${unmatched.map(file=>`<li>${escapeHtml(file)}</li>`).join("")}</ul></details>`:"";
  $("missingPhotoWarning").innerHTML=missingPhotos.length?`<p class="warning">${missingPhotos.length} student${missingPhotos.length===1?"":"s"} missing photos. <button id="reviewMissingPhotos" class="secondary">Review</button></p>`:"";
  document.getElementById("reviewMissingPhotos")?.addEventListener("click",openMissingPhotos);
  $("recordNamesBtn").disabled = !manifest;
  $("printBarcodesBtn").disabled = !manifest;
  $("manageLibraryBtn").disabled = !manifest;
  $("updateLibraryBtn").disabled = !manifest;
  $("exportLibraryCsvBtn").disabled = !manifest;
  $("exportPhotosBtn").disabled = !manifest?.counts?.photos;
  $("exportAudioBtn").disabled = !manifest?.counts?.audio;
  $("photoStat").disabled = !manifest?.counts?.photos;
  $("audioStat").disabled = !manifest?.counts?.audio;
  renderProjectorBackground();
  renderMainBackground();
  renderHero();
}
function renderMainBackground(){const asset=controllerManifest?.assets?.backgrounds?.main||null;$("uploadMainBackground").disabled=!controllerManifest;$("removeMainBackground").disabled=!asset;$("mainBackgroundStatus").textContent=asset?(asset.sourceName||"Standby background uploaded"):"No standby background uploaded";const preview=$("mainBackgroundPreview");preview.hidden=!asset;if(asset)preview.src=asset.url;else preview.removeAttribute("src")}
function projectorBackground(){
  const asset=controllerManifest?.assets?.backgrounds?.projector||null,value=controllerManifest?.presentation?.projectorBackground||{};
  return{asset,enabled:!!value.enabled&&!!asset,overlay:Math.max(0,Math.min(80,Number(value.overlay??35)))};
}
function renderProjectorBackground(){
  const {asset,enabled,overlay}=projectorBackground(),available=!!asset;
  $("uploadProjectorBackground").disabled=!controllerManifest;
  $("removeProjectorBackground").disabled=!available;
  $("useProjectorBackground").disabled=!available;$("useProjectorBackground").checked=enabled;
  $("projectorBackgroundOverlay").disabled=!available;$("projectorBackgroundOverlay").value=overlay;$("projectorBackgroundOverlayValue").textContent=`${overlay}%`;
  $("projectorBackgroundStatus").textContent=available?(asset.sourceName||"Student background uploaded"):"No student background uploaded";
  const preview=$("projectorBackgroundPreview");preview.hidden=!available;
  if(available)preview.src=asset.url;else preview.removeAttribute("src");
}
function openMissingPhotos(){
  $("missingPhotoSearch").value="";$("missingPhotoModal").hidden=false;renderMissingPhotos();
}
function renderMissingPhotos(){
  const missing=PhotoStatus.missingPhotosForManifest(controllerManifest),query=$("missingPhotoSearch").value.trim().toLowerCase(),fragment=document.createDocumentFragment();
  const filtered=missing.filter(id=>{const item=controllerManifest.students[id];return !query||id.toLowerCase().includes(query)||item.name.toLowerCase().includes(query)||item.group.toLowerCase().includes(query)});
  for(const id of filtered){const item=controllerManifest.students[id],row=document.createElement("div"),idNode=document.createElement("b"),details=document.createElement("div"),name=document.createElement("b"),group=document.createElement("small");row.className="missing-photo-row";idNode.textContent=id;name.textContent=item.name;group.textContent=item.group;details.append(name,group);row.append(idNode,details);fragment.append(row)}
  $("missingPhotoSummary").textContent=`${filtered.length} of ${missing.length} missing-photo students shown`;
  $("missingPhotoList").replaceChildren(fragment);
}
window.renderManifest = renderManifest;
window.addEventListener("recordings-published", event => renderManifest(event.detail));
function renderStatus() {
  const devices=latestStatus.devices || [], outputs=latestStatus.outputs || [], pending=latestStatus.pending || [];
  const roleIcon={controller:"MonitorCog",scanner:"ScanLine",projector:"Projector",obs:"RadioTower"},statusLabel={online:"Online",connecting:"Connecting",syncing:"Syncing",ready:"Ready","offline-ready":"Offline-ready","update-failed":"Update failed","insufficient-storage":"Insufficient storage"};
  $("devices").className=`devices connected-device-grid${devices.length?"":" empty"}`;
  const deviceCard=d=>{const healthy=["online","ready"].includes(d.sync),working=["connecting","syncing"].includes(d.sync),connected=d.connectedAt?new Date(d.connectedAt).toLocaleTimeString():"unknown",seen=d.lastSeen?new Date(d.lastSeen).toLocaleTimeString():"unknown",hasAudioState=["projector","obs"].includes(d.role),audioReady=hasAudioState&&d.audioUnlocked;return`<div class="row device-card"><span class="device-role-icon" data-lucide-icon="${roleIcon[d.role]||"MonitorSmartphone"}"></span><div><div class="device-name"><b>${escapeHtml(d.name)}</b><button class="device-icon-button" data-edit-device="${escapeHtml(d.stationId)}" title="Edit device name" aria-label="Edit ${escapeHtml(d.name)} name">✎</button></div><div class="muted">${escapeHtml(statusLabel[d.sync]||d.sync||"Connected")}${d.progress!=null&&d.sync==="syncing"?` · ${d.progress}%`:""}${hasAudioState?` · ${audioReady?"Audio enabled":"Audio not enabled"}`:""}</div><small class="device-health">Connected ${escapeHtml(connected)} · heartbeat ${escapeHtml(seen)}</small></div><div class="device-card-actions">${hasAudioState?`<span class="device-audio-state ${audioReady?"audio-enabled":"audio-muted"}" title="Remote audio status"><span data-lucide-icon="${audioReady?"Volume2":"VolumeX"}"></span><span>${audioReady?"Audio on":"Muted"}</span></span>`:""}<span class="dot${healthy?" ready":working?" syncing":""}"></span></div></div>`};
  const roleLabels={controller:"Controller",scanner:"Scanners",projector:"Projectors",obs:"OBS"};
  $("devices").innerHTML=devices.length?["controller","scanner","projector","obs"].map(role=>{const grouped=devices.filter(device=>device.role===role);return grouped.length?`<section class="device-group"><div class="device-group-heading"><span data-lucide-icon="${roleIcon[role]}">${roleLabels[role]}</span><b>${grouped.length}</b></div><div class="device-group-list">${grouped.map(deviceCard).join("")}</div></section>`:""}).join(""):"No remote devices";
  $("outputList").className=`devices${outputs.length?"":" empty"}`;
  $("clearRememberedOutputs").disabled=!outputs.length;
  $("outputList").innerHTML=outputs.length?outputs.map(output=>`<label class="row"><div><b>${escapeHtml(output.name)}</b><div class="muted">${escapeHtml(output.role)} · ${output.connected?escapeHtml(output.sync||"connected"):"offline"} · last seen ${output.lastSeen?new Date(output.lastSeen).toLocaleString():"never"}</div></div><span><input type="checkbox" data-required-output="${escapeHtml(output.stationId)}" ${output.required?"checked":""}> Required</span></label>`).join(""):"No Projector or OBS output has connected yet";
  $("pending").className=`pending${pending.length?"":" empty"}`;
  $("pending").innerHTML=pending.length ? pending.map(e=>`<div class="row"><div><b>${escapeHtml(e.id)}</b><div class="muted">${escapeHtml(e.stationId)} · ${new Date(e.timestamp).toLocaleString()}</div></div><div class="row-actions"><button data-id="${e.eventId}" data-choice="approve">Approve</button><button class="danger" data-id="${e.eventId}" data-choice="discard">Discard</button></div></div>`).join("") : "No pending scans";
  renderHero();
}
function renderHero(){
  const hero=$("liveHero");if(!hero)return;
  const state=latestStatus.state||{},outputs=latestStatus.outputs||[],required=outputs.filter(item=>item.required),currentId=state.currentStudentId,current=controllerManifest?.students?.[currentId];
  const readyOutputs=required.filter(item=>item.connected&&item.sync==="ready"&&item.libraryVersion===controllerManifest?.version).length;
  let mode="waiting",badge="Setup required",eyebrow="Current ceremony status",name="Import a ceremony library",details="Start a new ceremony or restore a backup to prepare the displays.";
  if(!$("serverDot").classList.contains("ready")){mode="blocked";badge="Reconnecting";name="Controller connection interrupted";details="Waiting for the local ceremony server to reconnect."}
  else if(controllerManifest){
    if(current){const outputsReady=required.length&&readyOutputs===required.length;mode=outputsReady?"live":"blocked";badge=outputsReady?"Live":"Output issue";eyebrow=`Now displaying · Student ${currentId}`;name=current.name;details=[current.group,current.marks,!outputsReady?`${readyOutputs}/${required.length} required outputs ready`:""].filter(Boolean).join(" · ")}
    else if(!required.length){mode="blocked";badge="Output required";name="Choose a required display";details="Connect Projector or OBS and designate at least one required output before scanning."}
    else if(readyOutputs<required.length){const syncing=required.some(item=>item.connected&&["connecting","syncing"].includes(item.sync));mode=syncing?"syncing":"blocked";badge=syncing?"Synchronizing":"Not ready";name=syncing?"Displays are synchronizing":"Required output unavailable";details=`${readyOutputs} of ${required.length} required output${required.length===1?"":"s"} ready.`}
    else{mode="ready";badge="Ready";name="Ready for the next student";details=`${readyOutputs} required output${readyOutputs===1?" is":"s are"} online and synchronized.`}
  }
  hero.className=`live-hero ${mode}`;$("liveHeroBadge").textContent=badge;$("liveHeroEyebrow").textContent=eyebrow;$("liveHeroName").textContent=name;$("liveHeroDetails").textContent=details;
  $("liveHeroOutputs").textContent=controllerManifest?`${readyOutputs}/${required.length} required outputs ready`:"No active library";
  const photo=current&&(controllerManifest.assets?.thumbnails?.[currentId]||controllerManifest.assets?.photos?.[currentId]),image=$("liveHeroPhoto"),placeholder=$("liveHeroPlaceholder");
  image.onerror=()=>{image.hidden=true;placeholder.hidden=false;placeholder.textContent=current?current.name.split(/\s+/).slice(0,2).map(part=>part[0]).join("").toUpperCase():badge};
  if(photo){image.hidden=false;image.src=photo.url;image.alt=`Photo of ${current.name}`;placeholder.hidden=true}
  else{image.hidden=true;image.removeAttribute("src");image.alt="";placeholder.hidden=false;placeholder.textContent=current?current.name.split(/\s+/).slice(0,2).map(part=>part[0]).join("").toUpperCase():badge}
  if(current){if(heroTimelineStudentId!==currentId){heroTimelineStudentId=currentId;void heroTimeline.play(controllerManifest.assets?.audio?.[currentId]?.url||"")}}
  else{heroTimelineStudentId=null;heroTimeline.reset()}
}
function decision(eventIds, decision){ if(eventIds.length) connection.send("QUEUE_DECISION",{eventIds,decision}); }
function applySettings(settings){
  const normalized=OutputSettings.normalize(settings);
  $("accent").value=normalized.accent || "#00d2ff"; $("audioTarget").value=normalized.audioTarget || "projector"; $("playAudioOnController").checked=normalized.playAudioOnController; $("audioFadeInSeconds").value=normalized.audioFadeInSeconds; $("audioFadeOutSeconds").value=normalized.audioFadeOutSeconds; $("studentTransitionStyle").value=normalized.studentTransitionStyle; $("studentTransitionSeconds").value=normalized.studentTransitionSeconds; $("studentTransitionSeconds").disabled=normalized.studentTransitionStyle==="none"; $("eventName").value=normalized.eventName || ""; $("hideProjectorHeader").checked=!!normalized.hideProjectorHeader;
  $("obsBackgroundMode").value=normalized.obsBackgroundMode;$("obsChromaColor").value=normalized.chroma;$("obsChromaColorLabel").hidden=normalized.obsBackgroundMode!=="chroma";$("obsChromaColor").disabled=normalized.obsBackgroundMode!=="chroma";
  const available=!!controllerManifest?.assets?.backgrounds?.projector;
  $("useProjectorBackground").checked=available&&normalized.useProjectorBackground;
  $("projectorBackgroundOverlay").value=normalized.projectorBackgroundOverlay;$("projectorBackgroundOverlayValue").textContent=`${normalized.projectorBackgroundOverlay}%`;
  $("automaticSnapshotsEnabled").checked=!!normalized.automaticSnapshotsEnabled;$("automaticSnapshotInterval").value=String(normalized.automaticSnapshotIntervalMinutes||5);$("automaticSnapshotInterval").disabled=!normalized.automaticSnapshotsEnabled;
  if(!normalized.playAudioOnController)stopControllerAnnouncement();else renderControllerAudioState();
}
function outputSettings(){return OutputSettings.normalize({accent:$("accent").value,audioTarget:$("audioTarget").value,playAudioOnController:$("playAudioOnController").checked,audioFadeInSeconds:$("audioFadeInSeconds").value,audioFadeOutSeconds:$("audioFadeOutSeconds").value,studentTransitionStyle:$("studentTransitionStyle").value,studentTransitionSeconds:$("studentTransitionSeconds").value,eventName:$("eventName").value.slice(0,120),hideProjectorHeader:$("hideProjectorHeader").checked,obsBackgroundMode:$("obsBackgroundMode").value,chroma:$("obsChromaColor").value,useProjectorBackground:$("useProjectorBackground").checked,projectorBackgroundOverlay:$("projectorBackgroundOverlay").value,automaticSnapshotsEnabled:$("automaticSnapshotsEnabled").checked,automaticSnapshotIntervalMinutes:Number($("automaticSnapshotInterval").value)})}
function sendOutputSettings(){const settings=outputSettings();localStorage.setItem(OUTPUT_SETTINGS_KEY,JSON.stringify({ceremonyId:controllerManifest?.ceremonyId||null,settings}));connection.send("SETTINGS",settings)}
async function persistProjectorBackgroundSettings(){
  const result=await window.graduationDesktop.setProjectorBackgroundSettings({enabled:$("useProjectorBackground").checked,overlay:Number($("projectorBackgroundOverlay").value)});
  if(result.error){$("projectorBackgroundMessage").textContent=`Could not save settings: ${result.error}`;return false}
  renderManifest(result.manifest);$("projectorBackgroundMessage").textContent="Background settings saved.";sendOutputSettings();return true;
}
function escapeHtml(value){ const div=document.createElement("div"); div.textContent=String(value); return div.innerHTML; }
function audioFileName(id,asset){return asset.sourceName||`${id}${asset.mime==="audio/mpeg"?".mp3":".wav"}`}
function stopAudioPreview(){
  if(audioPreview){audioPreview.pause();audioPreview.currentTime=0;audioPreview=null}
  if(audioPreviewButton){audioPreviewButton.textContent="Play";audioPreviewButton=null}
}
function renderControllerAudioState(kind){const enabled=$("playAudioOnController").checked,status=$("controllerAudioStatus"),button=$("enableControllerAudio");button.hidden=!enabled||controllerAudioUnlocked;if(!enabled){status.textContent="Controller audio disabled";status.className="controller-audio-status"}else if(kind==="playing"){status.textContent="Playing announcement";status.className="controller-audio-status ready"}else if(kind==="error"){status.className="controller-audio-status error"}else if(controllerAudioUnlocked){status.textContent="Controller audio ready";status.className="controller-audio-status ready"}else{status.textContent="Controller audio needs enabling";status.className="controller-audio-status warning-text"}}
function stopControllerAnnouncement(){if(controllerAudioFadeTimer!==null){clearInterval(controllerAudioFadeTimer);controllerAudioFadeTimer=null}if(controllerAudio){controllerAudio.pause();controllerAudio.removeAttribute("src");controllerAudio.load();controllerAudio=null}renderControllerAudioState()}
async function playControllerAnnouncement(id){
  stopControllerAnnouncement();if(!$("playAudioOnController").checked||!controllerAudioUnlocked)return;
  const asset=controllerManifest?.assets?.audio?.[id];if(!asset){$("controllerAudioStatus").textContent="No published audio for this student";renderControllerAudioState("error");return}
  stopAudioPreview();const settings=outputSettings(),fadeIn=settings.audioFadeInSeconds,fadeOut=settings.audioFadeOutSeconds,audio=new Audio(asset.url);controllerAudio=audio;audio.volume=fadeIn?0:1;
  const update=()=>{if(controllerAudio===audio)audio.volume=AudioFade.volumeAt(audio.currentTime,audio.duration,fadeIn,fadeOut)};
  audio.onended=()=>{if(controllerAudio===audio)stopControllerAnnouncement()};audio.onerror=()=>{if(controllerAudio===audio){stopControllerAnnouncement();$("controllerAudioStatus").textContent="Controller audio could not be decoded";renderControllerAudioState("error")}};
  try{await audio.play();if(controllerAudio!==audio)return;update();controllerAudioFadeTimer=setInterval(update,25);renderControllerAudioState("playing")}catch(error){if(controllerAudio===audio){stopControllerAnnouncement();controllerAudioUnlocked=false;$("controllerAudioStatus").textContent=error?.name==="NotAllowedError"?"Playback blocked — enable Controller audio":"Controller audio playback failed";renderControllerAudioState("error")}}
}
function renderAudioRecords(){
  if(!controllerManifest)return;
  stopAudioPreview();
  const allRecords=controllerManifest.order.filter(id=>controllerManifest.assets?.audio?.[id]),query=$("audioRecordsSearch").value.trim().toLowerCase();
  const records=allRecords.filter(id=>{
    const student=controllerManifest.students[id],asset=controllerManifest.assets.audio[id],fileName=audioFileName(id,asset);
    return !query||id.toLowerCase().includes(query)||student.name.toLowerCase().includes(query)||fileName.toLowerCase().includes(query);
  }),fragment=document.createDocumentFragment();
  for(const id of records){
    const student=controllerManifest.students[id],asset=controllerManifest.assets.audio[id],row=document.createElement("div"),idNode=document.createElement("b"),name=document.createElement("span"),file=document.createElement("span"),play=document.createElement("button");
    row.className="audio-record-row";idNode.textContent=id;name.textContent=student.name;file.textContent=audioFileName(id,asset);play.textContent="Play";play.className="secondary";play.dataset.audioId=id;
    row.append(idNode,name,file,play);fragment.append(row);
  }
  if(!records.length){const empty=document.createElement("div");empty.className="empty";empty.textContent="No matching audio records";fragment.append(empty)}
  $("audioRecordsList").replaceChildren(fragment);$("audioRecordsSummary").textContent=`${records.length} of ${allRecords.length} student audio record${allRecords.length===1?"":"s"} shown`;
}
function openAudioRecords(){
  if(!controllerManifest)return;
  $("audioRecordsSearch").value="";renderAudioRecords();$("audioRecordsModal").hidden=false;$("audioRecordsSearch").focus();
}
function photoFileName(id,asset){return asset.sourceName||`${id}.webp`}
function renderPhotoRecords(){
  if(!controllerManifest)return;
  const allRecords=controllerManifest.order.filter(id=>controllerManifest.assets?.photos?.[id]),query=$("photoRecordsSearch").value.trim().toLowerCase();
  const records=allRecords.filter(id=>{
    const student=controllerManifest.students[id],asset=controllerManifest.assets.photos[id],fileName=photoFileName(id,asset);
    return !query||id.toLowerCase().includes(query)||student.name.toLowerCase().includes(query)||fileName.toLowerCase().includes(query);
  }),fragment=document.createDocumentFragment();
  for(const id of records){
    const student=controllerManifest.students[id],asset=controllerManifest.assets.photos[id],row=document.createElement("div"),image=document.createElement("img"),idNode=document.createElement("b"),name=document.createElement("span"),file=document.createElement("span");
    row.className="photo-record-row";image.src=controllerManifest.assets.thumbnails?.[id]?.url||asset.url;image.alt="";image.setAttribute("aria-hidden","true");image.loading="lazy";image.onerror=()=>image.classList.add("photo-unavailable");
    idNode.textContent=id;name.textContent=student.name;file.textContent=photoFileName(id,asset);row.append(image,idNode,name,file);fragment.append(row);
  }
  if(!records.length){const empty=document.createElement("div");empty.className="empty";empty.textContent="No matching photo records";fragment.append(empty)}
  $("photoRecordsList").replaceChildren(fragment);$("photoRecordsSummary").textContent=`${records.length} of ${allRecords.length} student photo record${allRecords.length===1?"":"s"} shown`;
}
function openPhotoRecords(){
  if(!controllerManifest)return;
  $("photoRecordsSearch").value="";renderPhotoRecords();$("photoRecordsModal").hidden=false;$("photoRecordsSearch").focus();
}
$("pending").onclick=e=>{const button=e.target.closest("button[data-id]");if(button)decision([button.dataset.id],button.dataset.choice)};
$("outputList").onchange=e=>{const input=e.target.closest("[data-required-output]");if(input)connection.send("OUTPUT_REQUIRED",{stationId:input.dataset.requiredOutput,required:input.checked})};
$("devices").onclick=e=>{const edit=e.target.closest("[data-edit-device]");if(edit){const device=(latestStatus.devices||[]).find(item=>item.stationId===edit.dataset.editDevice);editingDeviceId=edit.dataset.editDevice;$("deviceNameInput").value=device?.name||"";$("deviceNameError").textContent="";$("deviceNameModal").hidden=false;$("deviceNameInput").focus();$("deviceNameInput").select()}};
function closeDeviceNameModal(){editingDeviceId=null;$("deviceNameModal").hidden=true}
function saveDeviceName(){const name=$("deviceNameInput").value.trim();if(!name){$("deviceNameError").textContent="Enter a device name.";return}connection.send("DEVICE_UPDATE",{stationId:editingDeviceId,name});closeDeviceNameModal()}
$("saveDeviceName").onclick=saveDeviceName;$("cancelDeviceName").onclick=closeDeviceNameModal;$("deviceNameInput").onkeydown=e=>{if(e.key==="Enter")saveDeviceName();else if(e.key==="Escape")closeDeviceNameModal()};
$("automaticSnapshotsEnabled").onchange=()=>{$("automaticSnapshotInterval").disabled=!$("automaticSnapshotsEnabled").checked;sendOutputSettings()};$("automaticSnapshotInterval").onchange=sendOutputSettings;
$("clearRememberedOutputs").onclick=()=>{if(confirm("Forget all Projector and OBS stations remembered for this ceremony? Connected stations will register again automatically."))connection.send("CLEAR_OUTPUTS")};
function closeResetEverything(){if($("confirmResetEverything").disabled&&$("resetEverythingMessage").textContent==="Resetting application…")return;$("resetEverythingModal").hidden=true}
$("openResetEverything").onclick=()=>{$("resetEverythingConfirmation").value="";$("resetEverythingMessage").textContent="";$("confirmResetEverything").disabled=true;$("cancelResetEverything").disabled=false;$("resetEverythingModal").hidden=false;$("resetEverythingConfirmation").focus()};
$("resetEverythingConfirmation").oninput=()=>{$("confirmResetEverything").disabled=$("resetEverythingConfirmation").value!=="RESET EVERYTHING"};
$("resetEverythingConfirmation").onkeydown=event=>{if(event.key==="Escape")closeResetEverything()};
$("cancelResetEverything").onclick=closeResetEverything;
$("confirmResetEverything").onclick=async()=>{const confirmation=$("resetEverythingConfirmation").value;if(confirmation!=="RESET EVERYTHING")return;$("confirmResetEverything").disabled=true;$("cancelResetEverything").disabled=true;$("resetEverythingConfirmation").disabled=true;$("resetEverythingMessage").textContent="Resetting application…";const result=await window.graduationDesktop.resetEverything(confirmation);if(result.error){$("resetEverythingMessage").textContent=`Reset failed: ${result.error}`;$("resetEverythingConfirmation").disabled=false;$("cancelResetEverything").disabled=false;$("confirmResetEverything").disabled=false}else $("resetEverythingMessage").textContent="Reset complete. Restarting…"};
$("approveAll").onclick=()=>decision((latestStatus.pending||[]).map(e=>e.eventId),"approve");
$("discardAll").onclick=()=>decision((latestStatus.pending||[]).map(e=>e.eventId),"discard");
$("clearBtn").onclick=()=>connection.send("CLEAR");
$("accent").oninput=sendOutputSettings;
$("audioTarget").onchange=sendOutputSettings;
$("playAudioOnController").onchange=()=>{if(!$("playAudioOnController").checked)stopControllerAnnouncement();else renderControllerAudioState();sendOutputSettings()};
$("confirmResetEverything").addEventListener("click",stopControllerAnnouncement,{capture:true});
$("enableControllerAudio").onclick=async()=>{try{const Context=window.AudioContext||window.webkitAudioContext;if(Context){const context=new Context(),oscillator=context.createOscillator(),gain=context.createGain();await context.resume();gain.gain.value=0;oscillator.connect(gain).connect(context.destination);oscillator.start();oscillator.stop(context.currentTime+.02);setTimeout(()=>context.close(),100)}controllerAudioUnlocked=true;renderControllerAudioState()}catch(error){controllerAudioUnlocked=false;$("controllerAudioStatus").textContent=`Could not enable Controller audio: ${error.message}`;renderControllerAudioState("error")}};
$("audioFadeInSeconds").onchange=()=>{applySettings(outputSettings());sendOutputSettings()};
$("audioFadeOutSeconds").onchange=()=>{applySettings(outputSettings());sendOutputSettings()};
$("studentTransitionStyle").onchange=()=>{$("studentTransitionSeconds").disabled=$("studentTransitionStyle").value==="none";sendOutputSettings()};
$("studentTransitionSeconds").onchange=()=>{applySettings(outputSettings());sendOutputSettings()};
$("eventName").oninput=sendOutputSettings;
$("hideProjectorHeader").onchange=sendOutputSettings;
$("obsBackgroundMode").onchange=()=>{const chroma=$("obsBackgroundMode").value==="chroma";$("obsChromaColorLabel").hidden=!chroma;$("obsChromaColor").disabled=!chroma;sendOutputSettings()};
$("obsChromaColor").oninput=sendOutputSettings;
$("uploadProjectorBackground").onclick=async()=>{
  $("uploadProjectorBackground").disabled=true;$("projectorBackgroundMessage").textContent="Optimizing and publishing background…";
  try{
    const result=await window.graduationDesktop.uploadProjectorBackground();
    if(result.error){renderProjectorBackground();$("projectorBackgroundMessage").textContent=`Background upload failed: ${result.error}`;return}
    if(result.canceled){renderProjectorBackground();$("projectorBackgroundMessage").textContent="";return}
    renderManifest(result.manifest);$("projectorBackgroundMessage").textContent="Projector background published. Connected projectors are synchronizing.";sendOutputSettings();
  }catch(error){renderProjectorBackground();$("projectorBackgroundMessage").textContent=`Background upload failed: ${error.message}`}
};
$("removeProjectorBackground").onclick=async()=>{
  if(!confirm("Remove the projector background image from this ceremony?"))return;
  $("removeProjectorBackground").disabled=true;$("projectorBackgroundMessage").textContent="Removing background…";
  try{
    const result=await window.graduationDesktop.removeProjectorBackground();
    if(result.error){renderProjectorBackground();$("projectorBackgroundMessage").textContent=`Background removal failed: ${result.error}`;return}
    renderManifest(result.manifest);$("projectorBackgroundMessage").textContent="Projector background removed.";sendOutputSettings();
  }catch(error){renderProjectorBackground();$("projectorBackgroundMessage").textContent=`Background removal failed: ${error.message}`}
};
$("useProjectorBackground").onchange=persistProjectorBackgroundSettings;
$("projectorBackgroundOverlay").oninput=()=>{$("projectorBackgroundOverlayValue").textContent=`${$("projectorBackgroundOverlay").value}%`;sendOutputSettings()};
$("projectorBackgroundOverlay").onchange=persistProjectorBackgroundSettings;
$("uploadMainBackground").onclick=async()=>{$("uploadMainBackground").disabled=true;$("mainBackgroundMessage").textContent="Optimizing and publishing standby background...";const result=await window.graduationDesktop.uploadMainBackground();if(result.error)$("mainBackgroundMessage").textContent=`Standby background upload failed: ${result.error}`;else if(!result.canceled){renderManifest(result.manifest);$("mainBackgroundMessage").textContent="Standby background published. Projectors are synchronizing."}renderMainBackground()};
$("removeMainBackground").onclick=async()=>{if(!confirm("Remove the cleared-display standby background?"))return;$("removeMainBackground").disabled=true;const result=await window.graduationDesktop.removeMainBackground();if(result.error)$("mainBackgroundMessage").textContent=`Could not remove standby background: ${result.error}`;else{renderManifest(result.manifest);$("mainBackgroundMessage").textContent="Standby background removed."}renderMainBackground()};
$("missingPhotoSearch").oninput=renderMissingPhotos;
$("closeMissingPhotos").onclick=()=>{$("missingPhotoModal").hidden=true};
$("audioStat").onclick=openAudioRecords;
$("audioRecordsSearch").oninput=renderAudioRecords;
$("photoStat").onclick=openPhotoRecords;
$("photoRecordsSearch").oninput=renderPhotoRecords;
$("closePhotoRecords").onclick=()=>{$("photoRecordsModal").hidden=true};
$("closeAudioRecords").onclick=()=>{stopAudioPreview();$("audioRecordsModal").hidden=true};
$("audioRecordsList").onclick=event=>{
  const button=event.target.closest("[data-audio-id]");if(!button||!controllerManifest)return;
  const id=button.dataset.audioId,asset=controllerManifest.assets.audio[id];
  if(audioPreviewButton===button&&!audioPreview?.paused){stopAudioPreview();return}
  stopControllerAnnouncement();stopAudioPreview();audioPreview=new Audio(asset.url);audioPreviewButton=button;button.textContent="Stop";
  audioPreview.onended=stopAudioPreview;audioPreview.onerror=()=>{stopAudioPreview();button.textContent="Unavailable"};audioPreview.play().catch(()=>{stopAudioPreview();button.textContent="Unavailable"});
};
document.addEventListener("keydown",event=>{
  if(event.key!=="Escape")return;
  if(!$("missingPhotoModal").hidden)$("missingPhotoModal").hidden=true;
  if(!$("audioRecordsModal").hidden){stopAudioPreview();$("audioRecordsModal").hidden=true}
  if(!$("photoRecordsModal").hidden)$("photoRecordsModal").hidden=true;
});
window.addEventListener("beforeunload",()=>{stopControllerAnnouncement();stopAudioPreview()});
$("importBtn").onclick=async()=>{
  if(controllerManifest&&!confirm("Start a new ceremony? This creates a new ceremony identity. Existing recording drafts remain isolated with the current ceremony."))return;
  $("importBtn").disabled=true;$("importStatus").textContent="Preparing new managed library…";const result=await window.graduationDesktop.importLibrary();$("importBtn").disabled=false;
  if(result.error){$("importStatus").textContent=`Import failed: ${result.error}`;return}if(!result.canceled){renderManifest(result.manifest);$("importStatus").textContent="New ceremony published. Connected devices are syncing."}
};
$("updateLibraryBtn").onclick=async()=>{
  $("updateLibraryBtn").disabled=true;$("importStatus").textContent="Preparing update reconciliation…";const result=await window.graduationDesktop.maintenanceReconcile();$("updateLibraryBtn").disabled=false;
  if(result.error){$("importStatus").textContent=`Update failed: ${result.error}`;return}if(!result.canceled){$("importStatus").textContent=`Update staged: ${result.summary.added.length} added, ${result.summary.changed.length} changed, ${result.summary.unchanged.length} unchanged, ${result.summary.retained.length} omitted students retained.`;await window.openMaintenanceStudio()}
};
$("exportLibraryCsvBtn").onclick=async()=>{const result=await window.graduationDesktop.exportLibraryCsv();if(result.error)$("importStatus").textContent=`CSV export failed: ${result.error}`;else if(!result.canceled)$("importStatus").textContent=`CSV exported to ${result.destination}`};
async function exportLibraryMedia(kind){
  const label=kind==="photos"?"Photos":"Audio",button=$(kind==="photos"?"exportPhotosBtn":"exportAudioBtn");
  button.disabled=true;$("importStatus").textContent=`Exporting ${label.toLowerCase()}…`;
  try{
    const result=await window.graduationDesktop.exportLibraryMedia(kind);
    if(result.error)$("importStatus").textContent=`${label} export failed: ${result.error}`;
    else if(result.canceled)$("importStatus").textContent=`${label} export cancelled.`;
    else $("importStatus").textContent=`Exported ${result.count} ${label.toLowerCase()} file${result.count===1?"":"s"} to ${result.destination}`;
  }catch(error){$("importStatus").textContent=`${label} export failed: ${error.message}`}
  finally{renderManifest(controllerManifest)}
}
$("exportPhotosBtn").onclick=()=>exportLibraryMedia("photos");
$("exportAudioBtn").onclick=()=>exportLibraryMedia("audio");
(async()=>{
  try {
    const info=await window.graduationDesktop.info();
    renderManifest(info.manifest);
    try{
      const saved=JSON.parse(localStorage.getItem(OUTPUT_SETTINGS_KEY)||"null");
      if(saved?.ceremonyId&&saved.ceremonyId===info.manifest?.ceremonyId){
        const background=projectorBackground(),settings=OutputSettings.normalize({...saved.settings,useProjectorBackground:background.enabled,projectorBackgroundOverlay:background.overlay});
        applySettings(settings);connection.send("SETTINGS",settings);
      }
    }catch{}
    const urls=info.addresses.flatMap(address=>["scanner","projector","obs"].map(role=>`<div class="url"><code>http://${address}:${info.port}/${role}</code><button data-copy="http://${address}:${info.port}/${role}">Copy</button></div>`));
    $("urls").className="";
    $("urls").innerHTML=urls.join("")||'<div class="empty">No LAN connection detected. Connect this controller to the ceremony network, then restart the app.</div>';
    $("urls").onclick=async e=>{
      const b=e.target.closest("[data-copy]");if(!b)return;
      const original=b.textContent;
      try{await window.graduationDesktop.copyText(b.dataset.copy);b.textContent="Copied"}
      catch{b.textContent="Copy failed"}
      setTimeout(()=>{b.textContent=original},1400);
    };
  } catch (error) {
    $("urls").className="empty";
    $("urls").textContent=`Could not load network addresses: ${error.message}. Restart the application.`;
  }
})();
