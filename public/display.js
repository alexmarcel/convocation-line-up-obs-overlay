"use strict";
const role=location.pathname.slice(1)||"projector",$=id=>document.getElementById(id);
let library=null,connected=false,currentAudio=null,currentAudioUrl="",currentAudioFadeTimer=null,audioUnlocked=false,deviceMuted=false,deviceName="",liveSettings=OutputSettings.normalize({audioTarget:"projector"}),liveSettingsReceived=false,projectorBackgroundUrl="",projectorBackgroundGeneration=0,mainBackgroundUrl="",mainBackgroundGeneration=0;
let synchronization=null,synchronizeAgain=false;
let stageTransitionGeneration=0,stageHasStudent=false;
let reportedAudioStatus="";
if(role==="obs")document.body.classList.add("obs");
if(role==="projector")document.body.classList.add("projector","display-cleared");
document.title=OutputSettings.windowTitle({},role);
$("roleTitle").textContent=role[0].toUpperCase()+role.slice(1)+" station";
$("scannerView").hidden=role!=="scanner";$("stageView").hidden=role==="scanner";
$("audioControls").hidden=role==="scanner";
const photoLoader=new SafePhotoLoader({
  image:role==="scanner"?$("confirmPhoto"):$("studentPhoto"),
  loadAsset:(kind,id)=>GraduationCache.assetUrl(library.manifest,kind,id)
});
const scannerTimeline=role==="scanner"?new AudioTimeline.Timeline($("scannerAudioTimeline")):null;
const connection=createGraduationConnection(role,{
  open:async()=>{connected=true;document.body.classList.remove("offline");setState("connecting","Connected");await synchronize();await sendOfflineQueue()},
  close:()=>{connected=false;cancelStageTransition();document.body.classList.add("offline");setState(library?"ready":"error",library?"Offline-ready":"Offline — no cached library")},
  message:async message=>{
    if(message.type==="LIBRARY_AVAILABLE")await synchronize();
    else if(message.type==="SHOW_STUDENT")await showStudent(message.payload.id,true);
    else if(message.type==="CLEAR")await clearStudent();
    else if(message.type==="SETTINGS"){liveSettingsReceived=true;applySettings(message.payload)}
    else if(message.type==="DEVICE_SETTINGS"){deviceName=String(message.payload.name||"").trim();deviceMuted=!!message.payload.muted;if(deviceName)localStorage.setItem(`graduation-station-name-${role}`,deviceName);document.title=OutputSettings.windowTitle(liveSettings,role,deviceName);if(deviceName)$("roleTitle").textContent=deviceName;if(deviceMuted)stopCurrentAudio();renderAudioRouting()}
    else if(message.type==="STATE_SNAPSHOT"){liveSettingsReceived=true;applySettings(message.payload.state.settings);if(message.payload.state.currentStudentId)await showStudent(message.payload.state.currentStudentId,false)}
    else if(message.type==="RESET_CEREMONY_CACHE"){await clearStudent();library=null;await GraduationCache.clearCeremonyCache();setState("error","No active ceremony","Waiting for the controller to import a library");connection.send("RESET_CEREMONY_CACHE_COMPLETE",{resetId:message.payload.resetId})}
    else if(message.type==="ACK"){const ack=$("ack");if(ack){ack.textContent=message.payload.ok?"Delivered to displays":message.payload.error;ack.className=`ack${message.payload.ok?"":" error"}`}}
    else if(message.type==="QUEUE_RESOLVED")await GraduationCache.dbDelete("offlineEvents",message.payload.eventId);
  }
});
function setState(kind,text,progress){$("stateDot").classList.toggle("ready",kind==="ready");$("stateText").textContent=text;$("syncMessage").textContent=progress||""}
function setAudioStatus(kind,text,showButton=false){
  if(role==="scanner")return;
  $("audioControls").hidden=kind==="ready"&&!showButton;
  $("audioControls").className=`audio-controls${kind?` ${kind}`:""}`;
  $("audioStatus").textContent=text;$("enableAudio").hidden=!showButton;
}
function renderAudioRouting(){
  if(role==="scanner")return;
  const report=()=>{const value=JSON.stringify({unlocked:audioUnlocked});if(value!==reportedAudioStatus&&connection.isOpen()){reportedAudioStatus=value;connection.send("AUDIO_STATUS",{unlocked:audioUnlocked})}};
  if(deviceMuted){$("audioControls").hidden=true;report();return}
  if(!OutputSettings.routesAudioTo(liveSettings,role)){$("audioControls").hidden=true;return}
  else if(audioUnlocked)setAudioStatus("ready","Audio ready",false);
  else setAudioStatus("","Enable audio before going live",true);
  report();
}
function stopCurrentAudio(){
  if(currentAudioFadeTimer!==null){clearInterval(currentAudioFadeTimer);currentAudioFadeTimer=null}
  if(currentAudio){currentAudio.pause();currentAudio.removeAttribute("src");currentAudio.load();currentAudio=null}
  if(currentAudioUrl){URL.revokeObjectURL(currentAudioUrl);currentAudioUrl=""}
}
async function playStudentAudio(id,generation){
  if(deviceMuted)return;
  if(!OutputSettings.routesAudioTo(liveSettings,role))return;
  const audioUrl=await GraduationCache.assetUrl(library.manifest,"audio",id);
  if(generation!==photoLoader.generation){if(audioUrl)URL.revokeObjectURL(audioUrl);return}
  if(!audioUrl){setAudioStatus("error","No published audio for this student",false);return}
  const fadeIn=liveSettings.audioFadeInSeconds,fadeOut=liveSettings.audioFadeOutSeconds;
  stopCurrentAudio();currentAudioUrl=audioUrl;currentAudio=new Audio(audioUrl);const audio=currentAudio;audio.volume=fadeIn?0:1;audio.muted=false;
  const updateVolume=()=>{if(currentAudio!==audio)return;audio.volume=AudioFade.volumeAt(audio.currentTime,audio.duration,fadeIn,fadeOut)};
  currentAudio.onended=()=>{if(currentAudioUrl===audioUrl){stopCurrentAudio();setAudioStatus("ready","Audio ready",false)}};
  currentAudio.onerror=()=>{if(currentAudioUrl===audioUrl){stopCurrentAudio();setAudioStatus("error","Audio could not be decoded",true)}};
  try{await currentAudio.play();updateVolume();currentAudioFadeTimer=setInterval(updateVolume,25);audioUnlocked=true;setAudioStatus("ready","Playing announcement",false);renderAudioRouting()}
  catch(error){stopCurrentAudio();setAudioStatus("error",error?.name==="NotAllowedError"?"Playback blocked - click Enable audio":`Playback failed: ${error?.message||"unknown error"}`,true)}
}
$("enableAudio").onclick=async()=>{
  audioUnlocked=true;
  try{
    const Context=window.AudioContext||window.webkitAudioContext;
    if(Context){const context=new Context();await context.resume();const oscillator=context.createOscillator(),gain=context.createGain();gain.gain.value=0;oscillator.connect(gain).connect(context.destination);oscillator.start();oscillator.stop(context.currentTime+.02);setTimeout(()=>context.close(),100)}
    setAudioStatus("ready","Audio ready - scan a test student",false);renderAudioRouting();
  }catch(error){audioUnlocked=false;setAudioStatus("error",`Could not enable audio: ${error.message}`,true)}
};
async function synchronize(){
  if(synchronization){synchronizeAgain=true;return synchronization}
  synchronization=(async()=>{do{synchronizeAgain=false;await performSynchronization()}while(synchronizeAgain)})().finally(()=>{synchronization=null});
  return synchronization;
}
async function performSynchronization(){
  try{
    cancelStageTransition();photoLoader.reset();
    setState("syncing","Synchronizing","Preparing library…");connection.send("SYNC_STATUS",{status:"syncing",progress:0,libraryVersion:null});
    const manifest=await GraduationCache.syncLibrary(role,(done,total)=>{const value=total?Math.round(done/total*100):100;setState("syncing","Synchronizing",`${done}/${total} assets · ${value}%`);connection.send("SYNC_STATUS",{status:"syncing",progress:value,libraryVersion:null})});
    library=await GraduationCache.cachedLibrary(role);await refreshProjectorBackground();await refreshMainBackground();setState("ready","Ready",`Library ${manifest.version}`);connection.send("SYNC_STATUS",{status:"ready",progress:100,libraryVersion:manifest.version});
  }catch(error){library=await GraduationCache.cachedLibrary(role);const storage=error?.name==="QuotaExceededError";setState(library?"ready":"error",library?"Offline-ready":storage?"Insufficient storage":"Update failed",error.message);connection.send("SYNC_STATUS",{status:storage?"insufficient-storage":"update-failed",progress:0,libraryVersion:library?.manifest?.version||null})}
}
const transitionDelay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
function transitionOptions(){return{style:liveSettings.studentTransitionStyle,seconds:liveSettings.studentTransitionSeconds}}
function cancelStageTransition(){stageTransitionGeneration++;if(role!=="scanner"){const card=$("stageCard");card.classList.remove("stage-exiting");if(stageHasStudent)card.classList.add("visible")}}
async function showStudent(id,playAudio){
  if(!library)return;const student=library.students[id];if(!student)return;
  if(role==="scanner"){
    const generation=photoLoader.begin();
    $("confirmName").textContent=student.name;$("confirmProgram").textContent=student.group;$("confirmMarks").textContent=student.marks;
    void photoLoader.load("thumbnails",id,generation);
    void scannerTimeline.play(library.manifest.assets?.audio?.[id]?.url||"");
  }else{
    const token=++stageTransitionGeneration,card=$("stageCard"),transition=transitionOptions();stopCurrentAudio();
    if(stageHasStudent&&playAudio&&transition.style!=="none"){
      card.classList.add("stage-exiting");card.classList.remove("visible");
      await transitionDelay(transition.seconds*1000);if(token!==stageTransitionGeneration)return;
    }
    if(token!==stageTransitionGeneration)return;
    const generation=photoLoader.begin();card.classList.remove("visible","stage-exiting");
    if(role==="projector")document.body.classList.remove("display-cleared");
    $("studentName").textContent=student.name;$("studentGroup").textContent=student.group;$("studentMarks").textContent=student.marks;
    void photoLoader.load("photos",id,generation);
    stageHasStudent=true;if(transition.style!=="none")void card.offsetWidth;card.classList.add("visible");
    if(token===stageTransitionGeneration&&generation===photoLoader.generation&&playAudio)await playStudentAudio(id,generation);
  }
}
async function clearStudent(){
  stopCurrentAudio();scannerTimeline?.reset();
  if(role==="scanner"){photoLoader.reset();return}
  const token=++stageTransitionGeneration,card=$("stageCard"),transition=transitionOptions();
  if(stageHasStudent&&transition.style!=="none"){card.classList.add("stage-exiting");card.classList.remove("visible");await transitionDelay(transition.seconds*1000);if(token!==stageTransitionGeneration)return}
  photoLoader.reset();card.classList.remove("visible","stage-exiting");stageHasStudent=false;if(role==="projector")document.body.classList.add("display-cleared");
}
function showUnknownStudent(id){
  photoLoader.begin();
  scannerTimeline?.unavailable();
  $("confirmName").textContent="STUDENT NOT FOUND";
  $("confirmProgram").textContent=`Scanned ID: ${id}`;
  $("confirmMarks").textContent="";
  $("ack").textContent="No matching student record";
  $("ack").className="ack error";
}
async function applySettings(settings={}){
  const normalized=OutputSettings.normalize(settings);
  liveSettings=normalized;
  document.body.classList.remove("student-transition-fade","student-transition-fade-rise","student-transition-none");document.body.classList.add(`student-transition-${normalized.studentTransitionStyle}`);document.documentElement.style.setProperty("--student-transition-duration",`${normalized.studentTransitionSeconds}s`);
  document.title=OutputSettings.windowTitle(normalized,role,deviceName);
  document.documentElement.style.setProperty("--accent",normalized.accent||"#00d2ff");
  if(role==="projector"){
    $("roleTitle").textContent=deviceName||String(normalized.eventName||"").trim()||"Projector station";
    $("roleHeader").hidden=!!normalized.hideProjectorHeader;
    await refreshProjectorBackground(normalized);
  }
  if(role==="obs"){
    document.documentElement.style.setProperty("--obs-chroma",normalized.chroma);
    document.body.classList.toggle("obs-chroma",normalized.obsBackgroundMode==="chroma");
  }
  renderAudioRouting();
  await GraduationCache.dbPut("settings","live",normalized);
}
function clearProjectorBackground(){
  projectorBackgroundGeneration++;
  if(projectorBackgroundUrl)URL.revokeObjectURL(projectorBackgroundUrl);
  projectorBackgroundUrl="";document.documentElement.style.removeProperty("--projector-bg-image");document.body.classList.remove("projector-background");
}
async function refreshProjectorBackground(settings){
  if(role!=="projector")return;
  const generation=++projectorBackgroundGeneration;
  const stored=settings||await GraduationCache.dbGet("settings","live");
  const ceremony=library?.manifest?.presentation?.projectorBackground||{};
  const normalized=OutputSettings.normalize(stored||{useProjectorBackground:!!ceremony.enabled,projectorBackgroundOverlay:ceremony.overlay});
  document.documentElement.style.setProperty("--projector-bg-overlay",String(normalized.projectorBackgroundOverlay/100));
  if(!normalized.useProjectorBackground||!library?.manifest?.assets?.backgrounds?.projector){clearProjectorBackground();return}
  const url=await GraduationCache.assetUrl(library.manifest,"backgrounds","projector");
  if(generation!==projectorBackgroundGeneration){if(url)URL.revokeObjectURL(url);return}
  if(!url){clearProjectorBackground();return}
  if(projectorBackgroundUrl)URL.revokeObjectURL(projectorBackgroundUrl);
  projectorBackgroundUrl=url;document.documentElement.style.setProperty("--projector-bg-image",`url("${url}")`);document.body.classList.add("projector-background");
}
function clearMainBackground(){
  mainBackgroundGeneration++;
  if(mainBackgroundUrl)URL.revokeObjectURL(mainBackgroundUrl);
  mainBackgroundUrl="";document.documentElement.style.removeProperty("--main-bg-image");document.body.classList.remove("main-background");
}
async function refreshMainBackground(){
  if(role!=="projector")return;
  const generation=++mainBackgroundGeneration;
  const ceremony=library?.manifest?.presentation?.mainBackground||{};
  if(!ceremony.enabled||!library?.manifest?.assets?.backgrounds?.main){clearMainBackground();return}
  const url=await GraduationCache.assetUrl(library.manifest,"backgrounds","main");
  if(generation!==mainBackgroundGeneration){if(url)URL.revokeObjectURL(url);return}
  if(!url){clearMainBackground();return}
  if(mainBackgroundUrl)URL.revokeObjectURL(mainBackgroundUrl);
  mainBackgroundUrl=url;document.documentElement.style.setProperty("--main-bg-image",`url("${url}")`);document.body.classList.add("main-background");
}
async function queueScan(id){const event={eventId:GraduationCrypto.randomId(),id,timestamp:new Date().toISOString()};await GraduationCache.dbPut("offlineEvents",event.eventId,event);$("ack").textContent="Queued offline — controller approval required";return event}
async function sendOfflineQueue(){if(role!=="scanner")return;const events=(await GraduationCache.dbEntries("offlineEvents")).map(([,value])=>value);if(events.length)connection.send("QUEUED_SCANS",{events})}
if(role==="scanner"){
  const input=$("scanInput"),searchBox=$("scannerSearch"),resultList=$("scannerResults");
  let searchResults=[],activeResult=0;
  const closeResults=()=>{searchResults=[];activeResult=0;resultList.hidden=true;resultList.replaceChildren();input.setAttribute("aria-expanded","false");input.removeAttribute("aria-activedescendant")};
  const setActiveResult=index=>{
    if(!searchResults.length)return;
    activeResult=(index+searchResults.length)%searchResults.length;
    for(const [position,node]of [...resultList.querySelectorAll("[role=option]")].entries())node.setAttribute("aria-selected",String(position===activeResult));
    const active=$(`scanner-result-${activeResult}`);input.setAttribute("aria-activedescendant",active.id);active.scrollIntoView({block:"nearest"});
  };
  const renderResults=()=>{
    const query=input.value;
    if(!query.trim()||!library){closeResults();return}
    searchResults=ScannerSearch.searchStudents(library,query,10);activeResult=0;
    const fragment=document.createDocumentFragment();
    if(!searchResults.length){
      const empty=document.createElement("div");empty.className="scanner-result-empty";empty.textContent="No matching students";fragment.append(empty);
    }else for(const [index,result]of searchResults.entries()){
      const option=document.createElement("div"),identity=document.createElement("div"),name=document.createElement("b"),program=document.createElement("small"),id=document.createElement("span");
      option.id=`scanner-result-${index}`;option.className="scanner-result";option.setAttribute("role","option");option.setAttribute("aria-selected",String(index===0));option.dataset.index=String(index);
      name.textContent=result.student.name;program.textContent=result.student.group;id.textContent=result.id;identity.append(name,program);option.append(identity,id);fragment.append(option);
    }
    resultList.replaceChildren(fragment);resultList.hidden=false;input.setAttribute("aria-expanded","true");
    if(searchResults.length)input.setAttribute("aria-activedescendant","scanner-result-0");else input.removeAttribute("aria-activedescendant");
  };
  const submitId=async id=>{
    const value=String(id||"").trim();input.value="";closeResults();if(!value||!library)return;
    const known=!!library.students[value];if(known)await showStudent(value,false);else showUnknownStudent(value);
    const event={eventId:GraduationCrypto.randomId(),timestamp:new Date().toISOString()};
    if(connected)connection.send("SCAN",{id:value},event);else if(known)await queueScan(value);
    input.focus();
  };
  input.addEventListener("input",renderResults);
  input.addEventListener("keydown",event=>{
    if(event.key==="ArrowDown"&&searchResults.length){event.preventDefault();setActiveResult(activeResult+1)}
    else if(event.key==="ArrowUp"&&searchResults.length){event.preventDefault();setActiveResult(activeResult-1)}
    else if(event.key==="Escape"){event.preventDefault();closeResults()}
    else if(event.key==="Enter"){
      event.preventDefault();
      const query=input.value.trim(),exactId=library?.students?.[query]?query:null;
      submitId(exactId||searchResults[activeResult]?.id||query);
    }
  });
  resultList.addEventListener("pointerdown",event=>event.preventDefault());
  resultList.addEventListener("click",event=>{const option=event.target.closest("[data-index]");if(option)submitId(searchResults[Number(option.dataset.index)]?.id)});
  searchBox.addEventListener("focusout",()=>setTimeout(()=>{if(!searchBox.contains(document.activeElement))closeResults()},0));
  document.addEventListener("click",event=>{if(!searchBox.contains(event.target)){closeResults();input.focus()}});
  setInterval(()=>{if(document.activeElement===document.body)input.focus()},1000);input.focus();
}
(async()=>{renderAudioRouting();const cachedSettings=await GraduationCache.dbGet("settings","live");if(cachedSettings&&!liveSettingsReceived)await applySettings(cachedSettings);library=await GraduationCache.cachedLibrary(role);if(library){await refreshProjectorBackground(cachedSettings);await refreshMainBackground();setState("ready","Offline-ready",`Cached library ${library.manifest.version}`)}})();
window.addEventListener("beforeunload",()=>{cancelStageTransition();stopCurrentAudio();photoLoader.reset();clearProjectorBackground();clearMainBackground()});
