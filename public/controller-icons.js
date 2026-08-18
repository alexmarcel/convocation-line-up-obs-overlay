import createElement from "/vendor/lucide/createElement.js";
import RefreshCw from "/vendor/lucide/icons/refresh-cw.js";
import CirclePlus from "/vendor/lucide/icons/circle-plus.js";
import LibraryBig from "/vendor/lucide/icons/library-big.js";
import Settings from "/vendor/lucide/icons/settings.js";
import FileSpreadsheet from "/vendor/lucide/icons/file-spreadsheet.js";
import Images from "/vendor/lucide/icons/images.js";
import AudioLines from "/vendor/lucide/icons/audio-lines.js";
import Mic from "/vendor/lucide/icons/mic.js";
import Barcode from "/vendor/lucide/icons/barcode.js";
import MonitorX from "/vendor/lucide/icons/monitor-x.js";
import Link from "/vendor/lucide/icons/link.js";
import MonitorSmartphone from "/vendor/lucide/icons/monitor-smartphone.js";
import SlidersHorizontal from "/vendor/lucide/icons/sliders-horizontal.js";
import BadgeCheck from "/vendor/lucide/icons/badge-check.js";
import DatabaseBackup from "/vendor/lucide/icons/database-backup.js";
import History from "/vendor/lucide/icons/history.js";
import ListChecks from "/vendor/lucide/icons/list-checks.js";
import MonitorCog from "/vendor/lucide/icons/monitor-cog.js";
import ScanLine from "/vendor/lucide/icons/scan-line.js";
import Projector from "/vendor/lucide/icons/projector.js";
import RadioTower from "/vendor/lucide/icons/radio-tower.js";
import Volume2 from "/vendor/lucide/icons/volume-2.js";
import VolumeX from "/vendor/lucide/icons/volume-x.js";

const icons={RefreshCw,CirclePlus,LibraryBig,Settings,FileSpreadsheet,Images,AudioLines,Mic,Barcode,MonitorX,Link,MonitorSmartphone,SlidersHorizontal,BadgeCheck,DatabaseBackup,History,ListChecks,MonitorCog,ScanLine,Projector,RadioTower,Volume2,VolumeX};
const assignments=[
  ["#updateLibraryBtn","RefreshCw"],["#importBtn","CirclePlus"],["#manageLibraryBtn","Settings"],
  ["#exportLibraryCsvBtn","FileSpreadsheet"],["#exportPhotosBtn","Images"],["#exportAudioBtn","AudioLines"],
  ["#recordNamesBtn","Mic"],["#printBarcodesBtn","Barcode"],["#clearBtn","MonitorX"],
  [".grid>.panel:nth-child(1)>h2","LibraryBig"],[".grid>.panel:nth-child(2)>h2","Link"],
  [".grid>.panel:nth-child(3)>h2","MonitorSmartphone"],[".grid>.panel:nth-child(4)>h2","SlidersHorizontal"],
  [".grid>.panel:nth-child(5)>h2","BadgeCheck"],[".grid>.panel:nth-child(6) .topbar h2","DatabaseBackup"],
  [".grid>.panel:nth-child(6)>h2","History"],[".grid>.panel:nth-child(7) .topbar h2","ListChecks"]
];
for(const[selector,name]of assignments)document.querySelector(selector)?.setAttribute("data-lucide-icon",name);
function render(node=document){
  const elements=[];
  if(node instanceof Element&&node.matches("[data-lucide-icon]"))elements.push(node);
  elements.push(...node.querySelectorAll?.("[data-lucide-icon]")||[]);
  for(const element of elements){
    if(element.querySelector(":scope > .lucide"))continue;
    const icon=icons[element.dataset.lucideIcon];if(!icon)continue;
    const svg=createElement(icon);svg.classList.add("lucide");svg.setAttribute("aria-hidden","true");svg.setAttribute("focusable","false");element.prepend(svg);
  }
}
render();
new MutationObserver(records=>{for(const record of records)render(record.target)}).observe(document.body,{subtree:true,childList:true});
