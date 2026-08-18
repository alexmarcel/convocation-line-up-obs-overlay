"use strict";

(() => {
  const $ = id => document.getElementById(id);
  let manifest = null, status = { drafts:[], published:[], total:0 }, filteredIds = [], position = 0;
  let stream, audioContext, sourceNode, processorNode, meterNode, silentGain;
  let chunks = [], capturedSamples = null, capturedRate = 48000, recording = false, startedAt = 0, timerHandle, meterHandle, preview;
  const studio = $("recordingStudio");
  const drafts = () => new Set(status.drafts || []);
  const published = () => new Set(status.published || []);
  const currentId = () => filteredIds[position];
  const student = () => manifest?.students?.[currentId()];

  async function openStudio() {
    const info = await window.graduationDesktop.info();
    manifest = info.manifest;
    if (!manifest) return;
    status = await window.graduationDesktop.recordingStatus();
    studio.hidden = false;
    applyFilter(false);
    await initializeMicrophones();
  }

  async function closeStudio() {
    if (recording) stopRecording();
    preview?.pause();
    await stopMicrophone();
    studio.hidden = true;
  }

  async function initializeMicrophones() {
    setMessage("Requesting microphone permission...");
    try {
      const temporary = await navigator.mediaDevices.getUserMedia({ audio:true });
      temporary.getTracks().forEach(track => track.stop());
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "audioinput");
      $("microphoneSelect").innerHTML = devices.length
        ? devices.map((device, index) => `<option value="${escapeAttribute(device.deviceId)}">${escapeHtml(device.label || `Microphone ${index + 1}`)}</option>`).join("")
        : '<option value="">No microphone found</option>';
      if (devices.length) await selectMicrophone(devices[0].deviceId);
      else setMessage("No microphone was found.", true);
    } catch (error) { setMessage(`Microphone unavailable: ${error.message}`, true); }
  }

  async function selectMicrophone(deviceId) {
    await stopMicrophone();
    if (!deviceId) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio:{
        deviceId:{ exact:deviceId }, echoCancellation:false, noiseSuppression:false, autoGainControl:false
      }});
      audioContext = new AudioContext();
      capturedRate = audioContext.sampleRate;
      sourceNode = audioContext.createMediaStreamSource(stream);
      meterNode = audioContext.createAnalyser();
      meterNode.fftSize = 1024;
      processorNode = audioContext.createScriptProcessor(4096, 1, 1);
      silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      sourceNode.connect(meterNode);
      sourceNode.connect(processorNode);
      processorNode.connect(silentGain);
      silentGain.connect(audioContext.destination);
      processorNode.onaudioprocess = event => {
        if (recording) chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      monitorLevel();
      setMessage("Microphone ready. Press Record or Space.");
      renderStudent();
    } catch (error) { setMessage(`Could not open microphone: ${error.message}`, true); }
  }

  async function stopMicrophone() {
    cancelAnimationFrame(meterHandle);
    stream?.getTracks().forEach(track => track.stop());
    processorNode?.disconnect(); sourceNode?.disconnect(); meterNode?.disconnect(); silentGain?.disconnect();
    if (audioContext && audioContext.state !== "closed") await audioContext.close();
    stream = audioContext = sourceNode = processorNode = meterNode = silentGain = null;
    $("microphoneLevel").style.width = "0";
  }

  function monitorLevel() {
    if (!meterNode) return;
    const data = new Float32Array(meterNode.fftSize);
    meterNode.getFloatTimeDomainData(data);
    let peak = 0;
    for (const value of data) peak = Math.max(peak, Math.abs(value));
    $("microphoneLevel").style.width = `${Math.min(100, peak * 240)}%`;
    meterHandle = requestAnimationFrame(monitorLevel);
  }

  function startRecording() {
    const id = currentId();
    if (!id || !stream || recording || drafts().has(id)) return;
    capturedSamples = null; chunks = []; recording = true; startedAt = performance.now();
    renderStudent();
    setMessage("Recording... speak the student name.");
    updateTimer();
  }

  function stopRecording() {
    if (!recording) return;
    recording = false;
    clearTimeout(timerHandle);
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    capturedSamples = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) { capturedSamples.set(chunk, offset); offset += chunk.length; }
    chunks = [];
    renderStudent();
    setMessage(capturedSamples.length ? "Captured. Play it back, then Save & Next." : "No audio was captured.", !capturedSamples.length);
  }

  function updateTimer() {
    if (!recording) return;
    const seconds = (performance.now() - startedAt) / 1000;
    $("recordingTimer").textContent = formatTime(seconds);
    if (seconds >= 20) stopRecording();
    else timerHandle = setTimeout(updateTimer, 80);
  }

  async function playCurrent() {
    preview?.pause();
    if (capturedSamples?.length) {
      const context = new AudioContext({ sampleRate:capturedRate });
      const buffer = context.createBuffer(1, capturedSamples.length, capturedRate);
      buffer.copyToChannel(capturedSamples, 0);
      const node = context.createBufferSource();
      node.buffer = buffer; node.connect(context.destination); node.start();
      node.onended = () => context.close();
      return;
    }
    const id = currentId();
    if (!drafts().has(id)) return;
    const result = await window.graduationDesktop.readRecording(id);
    if (result.error) return setMessage(result.error, true);
    preview = new Audio(URL.createObjectURL(new Blob([result.bytes], { type:"audio/wav" })));
    preview.play().catch(error => setMessage(error.message, true));
  }

  async function saveAndNext() {
    if (!capturedSamples?.length || recording) return;
    $("saveNext").disabled = true;
    setMessage("Processing and saving draft...");
    const result = await window.graduationDesktop.saveRecording({ id:currentId(), samples:capturedSamples, sampleRate:capturedRate });
    if (result.error) { renderStudent(); return setMessage(result.error, true); }
    status = result.status; capturedSamples = null;
    if (position < filteredIds.length - 1) position++;
    applyFilter(false);
    setMessage(`Saved ${result.result.duration.toFixed(1)} second draft.`);
  }

  async function redoCurrent() {
    const id = currentId();
    if (!id || recording) return;
    if (drafts().has(id)) {
      const result = await window.graduationDesktop.deleteRecording(id);
      if (result.error) return setMessage(result.error, true);
      status = result.status;
    }
    capturedSamples = null;
    renderProgress(); renderStudent();
    setMessage("Previous draft removed. Press Record to replace it.");
  }

  async function publishRecordings() {
    $("publishRecordings").disabled = true;
    setMessage("Publishing recordings to the ceremony library...");
    const result = await window.graduationDesktop.publishRecordings();
    if (result.error) { renderProgress(); return setMessage(result.error, true); }
    manifest = result.manifest; status = result.status;
    renderProgress(); renderStudent();
    window.dispatchEvent(new CustomEvent("recordings-published", { detail:manifest }));
    setMessage("Published. Output devices are synchronizing changed audio.");
  }

  function applyFilter(keepPosition) {
    const oldId = currentId(), query = $("recordingSearch").value.trim().toLowerCase(), filter = $("recordingFilter").value, draftIds = drafts();
    filteredIds = (manifest?.order || []).filter(id => {
      const item = manifest.students[id];
      const matches = !query || id.toLowerCase().includes(query) || item.name.toLowerCase().includes(query);
      return matches && (filter === "all" || (filter === "recorded" ? draftIds.has(id) : !draftIds.has(id)));
    });
    if (keepPosition) position = Math.min(position, Math.max(0, filteredIds.length - 1));
    else position = Math.max(0, filteredIds.indexOf(oldId));
    capturedSamples = null;
    renderProgress(); renderStudent();
  }

  function navigate(delta) {
    if (!filteredIds.length || recording) return;
    position = Math.max(0, Math.min(filteredIds.length - 1, position + delta));
    capturedSamples = null; renderStudent();
  }

  function renderProgress() {
    const draftIds = drafts();
    $("draftCount").textContent = draftIds.size;
    $("missingCount").textContent = Math.max(0, (manifest?.order?.length || 0) - draftIds.size);
    $("recordingTotal").textContent = manifest?.order?.length || 0;
    $("recordingPosition").textContent = filteredIds.length ? `${position + 1} / ${filteredIds.length}` : "0 / 0";
    $("publishRecordings").disabled = draftIds.size === 0;
  }

  function renderStudent() {
    const id = currentId(), item = student(), hasDraft = drafts().has(id), isPublished = published().has(id);
    $("recordingStudentName").textContent = item?.name || "No matching student";
    $("recordingStudentMarks").textContent = item?.marks || "";
    $("recordingStudentDetails").textContent = item ? `ID ${id} · ${item.group}` : "Change the search or filter.";
    $("recordingBadge").textContent = hasDraft ? (isPublished ? "Recorded · published version exists" : "Recorded draft") : "Missing";
    $("recordingBadge").className = `recording-badge${hasDraft ? " recorded" : ""}${isPublished ? " published" : ""}`;
    $("recordButton").disabled = !item || !stream || hasDraft || recording;
    $("stopButton").disabled = !recording;
    $("playRecording").disabled = !hasDraft && !capturedSamples;
    $("redoRecording").disabled = !hasDraft && !capturedSamples;
    $("saveNext").disabled = !capturedSamples || recording;
    $("previousStudent").disabled = position <= 0;
    $("skipStudent").disabled = position >= filteredIds.length - 1;
    if (!recording) $("recordingTimer").textContent = "00:00.0";
  }

  function setMessage(message, error = false) {
    $("recordingMessage").textContent = message;
    $("recordingMessage").style.color = error ? "var(--danger)" : "var(--muted)";
  }
  function formatTime(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2,"0")}:${(seconds % 60).toFixed(1).padStart(4,"0")}`; }
  function escapeHtml(value) { const div=document.createElement("div"); div.textContent=value; return div.innerHTML; }
  function escapeAttribute(value) { return escapeHtml(value).replaceAll('"', "&quot;"); }

  $("recordNamesBtn").onclick = openStudio;
  $("closeStudio").onclick = closeStudio;
  $("microphoneSelect").onchange = event => selectMicrophone(event.target.value);
  $("recordingSearch").oninput = () => applyFilter(false);
  $("recordingFilter").onchange = () => applyFilter(false);
  $("recordButton").onclick = startRecording;
  $("stopButton").onclick = stopRecording;
  $("playRecording").onclick = playCurrent;
  $("redoRecording").onclick = redoCurrent;
  $("saveNext").onclick = saveAndNext;
  $("previousStudent").onclick = () => navigate(-1);
  $("skipStudent").onclick = () => navigate(1);
  $("publishRecordings").onclick = publishRecordings;
  document.addEventListener("keydown", event => {
    if (studio.hidden || ["INPUT","SELECT","TEXTAREA"].includes(event.target.tagName)) return;
    if (event.code === "Space") { event.preventDefault(); recording ? stopRecording() : startRecording(); }
    else if (event.key === "Enter") saveAndNext();
    else if (event.key === "ArrowLeft") navigate(-1);
    else if (event.key === "ArrowRight") navigate(1);
    else if (event.key === "Delete") redoCurrent();
    else if (event.key === "Escape") closeStudio();
  });
})();
