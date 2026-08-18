"use strict";

(()=>{
  const $=id=>document.getElementById(id);
  let view=null,editingId=null,busy=false;
  const message=text=>{$("maintenanceMessage").textContent=text||""};
  const effectiveMedia=(id,kind)=>{
    const change=view?.state?.media?.[kind]?.[id];
    if(change?.action==="remove")return false;
    if(change?.action==="replace")return true;
    return !!view?.manifest?.assets?.[kind]?.[id];
  };
  function render(){
    if(!view?.state)return;
    const {state,diff}=view,query=$("maintenanceSearch").value.trim().toLowerCase(),drafts=new Set(view.recording?.drafts||[]);
    const diffBox=$("maintenanceDiff");diffBox.replaceChildren();
    if(diff?.hasChanges){
      const summary=document.createElement("b");summary.textContent=`${diff.added.length} added · ${diff.changed.length} edited · ${diff.removed.length} removed · ${diff.photoChanges.length} photo changes · ${diff.audioChanges.length} audio changes${diff.reordered?" · reordered":""}`;diffBox.append(summary);
      for(const [label,ids]of [["Added",diff.added],["Edited",diff.changed],["Removed",diff.removed],["Photos",diff.photoChanges],["Audio",diff.audioChanges]]){
        if(!ids.length)continue;const line=document.createElement("small");line.textContent=`${label}: ${ids.join(", ")}`;diffBox.append(line);
      }
    }else diffBox.textContent="No staged changes";
    const fragment=document.createDocumentFragment();
    state.order.forEach((id,index)=>{
      const student=state.students[id];if(query&&![id,student.name,student.group,student.marks].some(value=>String(value).toLowerCase().includes(query)))return;
      const row=document.createElement("div"),identity=document.createElement("div"),details=document.createElement("div"),media=document.createElement("div"),actions=document.createElement("div");
      row.className="maintenance-row";identity.innerHTML=`<b>${escapeHtml(student.name)}</b><small>${escapeHtml(id)} · ${index+1}</small>`;details.innerHTML=`<span>${escapeHtml(student.group)}</span><small>${escapeHtml(student.marks)}</small>`;
      media.innerHTML=`<small>Photo: ${effectiveMedia(id,"photos")?"yes":"missing"}</small><small>Audio: ${effectiveMedia(id,"audio")?"yes":"missing"}</small><small>Draft: ${drafts.has(id)?"yes":"no"}</small>`;
      actions.className="maintenance-actions";actions.innerHTML=`<button class="secondary" data-maint="up" data-id="${escapeHtml(id)}" ${index===0?"disabled":""}>↑</button><button class="secondary" data-maint="down" data-id="${escapeHtml(id)}" ${index===state.order.length-1?"disabled":""}>↓</button><button class="secondary" data-maint="edit" data-id="${escapeHtml(id)}">Edit</button><button class="secondary" data-maint="photo" data-id="${escapeHtml(id)}">Photo</button><button class="secondary" data-maint="remove-photo" data-id="${escapeHtml(id)}">No photo</button><button class="secondary" data-maint="audio" data-id="${escapeHtml(id)}">Audio</button><button class="secondary" data-maint="remove-audio" data-id="${escapeHtml(id)}">No audio</button><button class="secondary" data-maint="print" data-id="${escapeHtml(id)}">Barcode</button><button class="danger" data-maint="remove" data-id="${escapeHtml(id)}">Remove</button>`;
      row.append(identity,details,media,actions);fragment.append(row);
    });
    if(!fragment.childNodes.length){const empty=document.createElement("div");empty.className="empty";empty.textContent="No matching students";fragment.append(empty)}
    $("maintenanceList").replaceChildren(fragment);
  }
  async function refresh(result){
    if(result?.error){message(result.error);return false}
    if(result?.state)view=result;else view=await window.graduationDesktop.maintenanceState();
    if(view.error){message(view.error);return false}
    $("manageLibraryBtn").textContent=view.state?"Manage library (staged)":"Manage library";render();return true;
  }
  async function open(){
    if(busy)return;busy=true;const result=await window.graduationDesktop.maintenanceStart();busy=false;
    if(!await refresh(result))return;$("maintenanceStudio").hidden=false;$("maintenanceSearch").value="";render();
  }
  function editorOptions(){
    const options=view.state.order.filter(id=>id!==editingId).map(id=>new Option(`${view.state.students[id].name} (${id})`,id));$("editorTarget").replaceChildren(...options);
  }
  function openEditor(id){
    editingId=id||null;const student=id?view.state.students[id]:{id:"",name:"",group:"",marks:""};
    $("studentEditorTitle").textContent=id?"Edit student":"Add student";$("editorStudentId").value=student.id;$("editorStudentName").value=student.name;$("editorStudentGroup").value=student.group;$("editorStudentMarks").value=student.marks;
    $("editorPosition").value="end";$("editorTargetLabel").hidden=true;$("studentEditorMessage").textContent="";editorOptions();$("studentEditorModal").hidden=false;$("editorStudentId").focus();
  }
  function editorData(){
    const position=$("editorPosition").value;
    return{student:{id:$("editorStudentId").value,name:$("editorStudentName").value,group:$("editorStudentGroup").value,marks:$("editorStudentMarks").value},placement:position==="end"?(editingId?undefined:{}):{position,targetId:$("editorTarget").value}};
  }
  async function saveEditor(publish){
    const data=editorData(),result=editingId?await window.graduationDesktop.maintenanceEdit({originalId:editingId,...data}):await window.graduationDesktop.maintenanceAdd(data);
    if(result.error){$("studentEditorMessage").textContent=result.error;return}
    $("studentEditorModal").hidden=true;await refresh(result);
    if(publish)await publishChanges();
  }
  async function publishChanges(){
    if(!view?.diff?.hasChanges){message("There are no staged changes to publish.");return}
    message("Creating safety snapshot and publishing…");const result=await window.graduationDesktop.maintenancePublish();
    if(result.error){message(result.error);return}
    window.renderManifest(result.manifest);view=null;$("manageLibraryBtn").textContent="Manage library";$("maintenanceStudio").hidden=true;message("");$("importStatus").textContent="Library changes published. Connected devices are synchronizing.";
  }
  $("manageLibraryBtn").onclick=open;
  $("closeMaintenance").onclick=()=>{$("maintenanceStudio").hidden=true};
  $("maintenanceSearch").oninput=render;
  $("addMaintenanceStudent").onclick=()=>openEditor();
  $("editorPosition").onchange=()=>{$("editorTargetLabel").hidden=$("editorPosition").value==="end"};
  $("cancelStudentEditor").onclick=()=>{$("studentEditorModal").hidden=true};
  $("saveStudent").onclick=()=>saveEditor(false);$("savePublishStudent").onclick=()=>saveEditor(true);
  $("saveMaintenanceDraft").onclick=()=>message("Working copy saved locally.");
  $("publishMaintenance").onclick=publishChanges;
  $("discardMaintenance").onclick=async()=>{if(!confirm("Discard every staged library change?"))return;const result=await window.graduationDesktop.maintenanceDiscard();if(result.error){message(result.error);return}view=null;$("manageLibraryBtn").textContent="Manage library";$("maintenanceStudio").hidden=true};
  $("reconcileMaintenance").onclick=async()=>{message("Preparing reconciliation…");const result=await window.graduationDesktop.maintenanceReconcile();if(!result.canceled&&await refresh(result)&&result.summary)message(`${result.summary.added.length} added, ${result.summary.changed.length} changed, ${result.summary.unchanged.length} unchanged, ${result.summary.retained.length} omitted students retained${result.summary.retained.length?`: ${result.summary.retained.join(", ")}`:""}. Remove retained students explicitly if required.`)};
  $("maintenanceList").onclick=async event=>{
    const button=event.target.closest("[data-maint]");if(!button)return;const id=button.dataset.id,action=button.dataset.maint;let result;
    if(action==="edit"){openEditor(id);return}
    if(action==="remove"){
      const consequences=[effectiveMedia(id,"photos")?"photo":null,effectiveMedia(id,"audio")?"published audio":null,(view.recording?.drafts||[]).includes(id)?"recording draft":null].filter(Boolean);
      if(!confirm(`Remove ${view.state.students[id].name} (${id})?${consequences.length?` This will also remove: ${consequences.join(", ")}.`:""} A safety snapshot is created before publication.`))return;
    }
    if(action==="print"){window.openBarcodeStudioForIds?.([id]);$("maintenanceStudio").hidden=true;return}
    if(action==="up"||action==="down")result=await window.graduationDesktop.maintenanceMove({id,direction:action});
    else if(action==="remove")result=await window.graduationDesktop.maintenanceRemoveStudent(id);
    else if(action==="photo"||action==="audio")result=await window.graduationDesktop.maintenanceImportMedia({id,kind:action==="photo"?"photos":"audio"});
    else if(action==="remove-photo"||action==="remove-audio")result=await window.graduationDesktop.maintenanceRemoveMedia({id,kind:action==="remove-photo"?"photos":"audio"});
    if(result&&!result.canceled)await refresh(result);
  };
  window.openMaintenanceStudio=open;
  window.graduationDesktop.maintenanceState().then(result=>{if(result?.state)$("manageLibraryBtn").textContent="Manage library (staged)"}).catch(()=>{});
})();
