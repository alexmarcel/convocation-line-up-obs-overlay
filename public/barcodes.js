"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = "barcode-print-settings-v1";
  const numericIds = ["labelWidth","labelHeight","pageMargin","labelColumns","labelGapX","labelGapY","labelPadding"];
  let manifest = null, selected = new Set(), previewSequence = 0, applyingPreset = false;

  function defaults() {
    return {
      preset:"small", copies:1, width:60, height:36, margin:10, columns:3, gapX:5, gapY:5, padding:3,
      guide:"solid", showName:true, showId:true, showGroup:true, showMarks:true
    };
  }
  function loadSettings() {
    try { return { ...defaults(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") }; }
    catch { return defaults(); }
  }
  function readSettings() {
    return {
      preset:$("labelPreset").value,
      copies:Number($("labelCopies").value),
      width:Number($("labelWidth").value),
      height:Number($("labelHeight").value),
      margin:Number($("pageMargin").value),
      columns:Number($("labelColumns").value),
      gapX:Number($("labelGapX").value),
      gapY:Number($("labelGapY").value),
      padding:Number($("labelPadding").value),
      guide:$("cuttingGuide").value,
      showName:$("showLabelName").checked,
      showId:$("showLabelId").checked,
      showGroup:$("showLabelGroup").checked,
      showMarks:$("showLabelMarks").checked
    };
  }
  function writeSettings(settings) {
    $("labelPreset").value=settings.preset; $("labelCopies").value=settings.copies;
    $("labelWidth").value=settings.width; $("labelHeight").value=settings.height; $("pageMargin").value=settings.margin;
    $("labelColumns").value=settings.columns; $("labelGapX").value=settings.gapX; $("labelGapY").value=settings.gapY; $("labelPadding").value=settings.padding;
    $("cuttingGuide").value=settings.guide; $("showLabelName").checked=settings.showName; $("showLabelId").checked=settings.showId; $("showLabelGroup").checked=settings.showGroup; $("showLabelMarks").checked=settings.showMarks;
  }
  function saveSettings() { localStorage.setItem(STORAGE_KEY, JSON.stringify(readSettings())); }

  async function openStudio(requestedIds) {
    manifest = (await window.graduationDesktop.info()).manifest;
    if (!manifest) return;
    selected = new Set(requestedIds?.filter(id=>manifest.students[id])||manifest.order);
    const groups = [...new Set(manifest.order.map(id => manifest.students[id].group))].sort((a,b) => a.localeCompare(b));
    $("barcodeGroup").replaceChildren(new Option("All groups",""), ...groups.map(group => new Option(group,group)));
    writeSettings(loadSettings());
    $("barcodeStudio").hidden = false;
    renderStudents();
    await updatePreflight();
  }
  function closeStudio() {
    $("barcodeStudio").hidden = true;
    clearPrintDocument();
  }
  function filteredIds() {
    const query=$("barcodeSearch").value.trim().toLowerCase(), group=$("barcodeGroup").value;
    return manifest.order.filter(id => {
      const item=manifest.students[id];
      return (!query||id.toLowerCase().includes(query)||item.name.toLowerCase().includes(query))&&(!group||item.group===group);
    });
  }
  function renderStudents() {
    const fragment=document.createDocumentFragment();
    for(const id of filteredIds()){
      const item=manifest.students[id], row=document.createElement("label"), check=document.createElement("input"), details=document.createElement("div"), name=document.createElement("b"), meta=document.createElement("small"), idText=document.createElement("span");
      row.className="barcode-student"; check.type="checkbox"; check.checked=selected.has(id); check.dataset.id=id;
      name.textContent=item.name; meta.textContent=item.group; details.append(name,meta); idText.textContent=id; row.append(check,details,idText); fragment.append(row);
    }
    $("barcodeStudentList").replaceChildren(fragment);
  }
  function selectedIds() { return manifest.order.filter(id => selected.has(id)); }
  function layoutResult() {
    try { return { layout:BarcodeLayout.resolveLayout(readSettings()) }; }
    catch(error){ return { error:error.message }; }
  }
  async function updatePreflight() {
    saveSettings();
    const ids=selectedIds(), result=layoutResult(), output=$("barcodePreflight");
    if(result.error){ output.className="barcode-preflight error";output.textContent=result.error;toggleOutput(false);return; }
    const {layout}=result, estimate=BarcodeLayout.pageEstimate(ids.length,readSettings().copies,layout.capacity), warnings=BarcodeLayout.barcodeWarnings(ids,layout);
    const errors=[...layout.errors];
    if(!ids.length)errors.push("Select at least one student.");
    output.className=`barcode-preflight${errors.length?" error":warnings.length?" warning":""}`;
    output.replaceChildren();
    const summary=document.createElement("div");summary.textContent=`${estimate.students} students · ${estimate.labels} labels · ${estimate.pages} A4 pages · ${layout.columns} columns × ${layout.rows} rows`;
    output.append(summary);
    for(const text of [...errors,...warnings.slice(0,4)]){const line=document.createElement("div");line.textContent=text;output.append(line)}
    if(warnings.length>4){const line=document.createElement("div");line.textContent=`...and ${warnings.length-4} more density warnings.`;output.append(line)}
    toggleOutput(!errors.length);
    await renderPreview(ids[0],layout);
  }
  function toggleOutput(enabled){$("printBarcodeLabels").disabled=!enabled;$("saveBarcodePdf").disabled=!enabled}
  async function renderPreview(id,layout){
    const sequence=++previewSequence, preview=$("barcodePreview");
    if(!id){preview.textContent="Select a student to preview.";return}
    const result=await window.graduationDesktop.generateBarcodes([id]);
    if(sequence!==previewSequence)return;
    if(result.error||result.errors?.length){preview.textContent=result.error||result.errors[0].error;return}
    preview.replaceChildren(createLabel(id,result.barcodes[id],layout,readSettings(),true));
  }
  function createLabel(id,svg,layout,settings,preview=false){
    const item=manifest.students[id], label=document.createElement("article");
    label.className=`print-label guide-${settings.guide}`;
    label.style.width=`${layout.width}mm`;label.style.height=`${layout.height}mm`;label.style.padding=`${layout.padding}mm`;
    const availableHeight=Math.max(1,layout.height-(layout.padding*2));
    const barcode=document.createElement("div"),details=document.createElement("div");
    barcode.className="print-label-barcode";
    barcode.style.height=`${Math.max(7,Math.min(11,availableHeight*.34))}mm`;
    barcode.innerHTML=svg;
    details.className="print-label-details";
    const textLength=(settings.showName?item.name.length:0)+(settings.showId?id.length+4:0)+(settings.showGroup?item.group.length+9:0)+(settings.showMarks?item.marks.length+7:0);
    const textScale=Math.max(.42,Math.min(1,70/Math.max(70,textLength)));
    label.style.setProperty("--label-name-size",`${9*textScale}pt`);
    label.style.setProperty("--label-id-size",`${8*textScale}pt`);
    label.style.setProperty("--label-detail-size",`${7*textScale}pt`);
    label.append(barcode,details);
    if(settings.showName){const node=document.createElement("div");node.className="print-label-name";node.textContent=item.name;details.append(node)}
    if(settings.showId){const node=document.createElement("div");node.className="print-label-id";node.textContent=`ID: ${id}`;details.append(node)}
    if(settings.showGroup){
      const node=document.createElement("div");
      node.className="print-label-group";
      node.textContent=`Program: ${item.group}`;
      details.append(node);
    }
    if(settings.showMarks){const node=document.createElement("div");node.className="print-label-marks";node.textContent=`Marks: ${item.marks}`;details.append(node)}
    if(preview)label.setAttribute("aria-label","Label preview");
    return label;
  }
  async function buildPrintDocument(){
    const ids=selectedIds(), settings=readSettings(), result=layoutResult();
    if(result.error||result.layout.errors.length||!ids.length)throw new Error(result.error||result.layout.errors[0]||"Select at least one student.");
    const generated=await window.graduationDesktop.generateBarcodes(ids);
    if(generated.error)throw new Error(generated.error);
    if(generated.errors?.length)throw new Error(generated.errors.map(item=>item.error).join("\n"));
    const labels=[];
    for(const id of ids)for(let copy=0;copy<settings.copies;copy++)labels.push(createLabel(id,generated.barcodes[id],result.layout,settings));
    const area=$("barcodePrintArea"), fragment=document.createDocumentFragment();
    for(let start=0;start<labels.length;start+=result.layout.capacity){
      const page=document.createElement("section"),grid=document.createElement("div");
      page.className="barcode-page";grid.className="barcode-print-grid";
      grid.append(...labels.slice(start,start+result.layout.capacity));page.append(grid);fragment.append(page);
    }
    area.replaceChildren(fragment);
    $("barcodePrintStyle").textContent=`#barcodePrintArea .barcode-page{width:210mm;height:297mm;padding:${result.layout.margin}mm}#barcodePrintArea .barcode-print-grid{grid-template-columns:repeat(${result.layout.columns},${result.layout.width}mm);grid-auto-rows:${result.layout.height}mm;column-gap:${result.layout.gapX}mm;row-gap:${result.layout.gapY}mm}`;
    return {labels:labels.length,pages:Math.ceil(labels.length/result.layout.capacity)};
  }
  function clearPrintDocument(){$("barcodePrintArea").replaceChildren();$("barcodePrintStyle").textContent=""}
  async function output(kind){
    $("printBarcodeLabels").disabled=true;$("saveBarcodePdf").disabled=true;
    try{
      const summary=await buildPrintDocument();
      const result=kind==="print"?await window.graduationDesktop.printBarcodes():await window.graduationDesktop.saveBarcodePdf();
      if(result.error)throw new Error(result.error);
      if(!result.cancelled)$("barcodePreflight").textContent=kind==="print"?`Sent ${summary.labels} labels (${summary.pages} pages) to the printer.`:`Saved ${summary.labels} labels to ${result.destination}.`;
    }catch(error){$("barcodePreflight").className="barcode-preflight error";$("barcodePreflight").textContent=error.message}
    finally{clearPrintDocument();await updatePreflight()}
  }
  function applyPreset(){
    const name=$("labelPreset").value;
    if(name==="custom")return;
    const preset=BarcodeLayout.PRESETS[name];applyingPreset=true;
    $("labelWidth").value=preset.width;$("labelHeight").value=preset.height;$("pageMargin").value=preset.margin;$("labelColumns").value=preset.columns;$("labelGapX").value=preset.gapX;$("labelGapY").value=preset.gapY;$("labelPadding").value=preset.padding;
    applyingPreset=false;updatePreflight();
  }

  $("printBarcodesBtn").onclick=()=>openStudio();$("closeBarcodeStudio").onclick=closeStudio;
  window.openBarcodeStudioForIds=ids=>openStudio(ids);
  $("barcodeSearch").oninput=renderStudents;$("barcodeGroup").onchange=renderStudents;
  $("barcodeStudentList").onchange=event=>{const check=event.target.closest("input[data-id]");if(!check)return;check.checked?selected.add(check.dataset.id):selected.delete(check.dataset.id);updatePreflight()};
  $("selectAllBarcodes").onclick=()=>{selected=new Set(manifest.order);renderStudents();updatePreflight()};
  $("selectFilteredBarcodes").onclick=()=>{selected=new Set(filteredIds());renderStudents();updatePreflight()};
  $("clearBarcodeSelection").onclick=()=>{selected.clear();renderStudents();updatePreflight()};
  $("labelPreset").onchange=applyPreset;
  for(const id of numericIds)$(id).oninput=()=>{if(!applyingPreset){$("labelPreset").value="custom";updatePreflight()}};
  for(const id of ["labelCopies","cuttingGuide","showLabelName","showLabelId","showLabelGroup","showLabelMarks"])$(id).onchange=updatePreflight;
  $("printBarcodeLabels").onclick=()=>output("print");$("saveBarcodePdf").onclick=()=>output("pdf");
  document.addEventListener("keydown",event=>{if(!$("barcodeStudio").hidden&&event.key==="Escape")closeStudio()});
})();
