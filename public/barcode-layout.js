"use strict";
(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BarcodeLayout = api;
})(typeof window !== "undefined" ? window : null, function() {
  const A4 = Object.freeze({ width:210, height:297 });
  const PRESETS = Object.freeze({
    small:{ width:60, height:36, margin:10, gapX:5, gapY:5, columns:3, padding:3 },
    medium:{ width:92, height:50, margin:10, gapX:6, gapY:6, columns:2, padding:4 },
    large:{ width:92, height:65, margin:10, gapX:6, gapY:7, columns:2, padding:5 }
  });
  function finite(value, name, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
    return number;
  }
  function resolveLayout(settings = {}) {
    const presetName = settings.preset || "small";
    const base = PRESETS[presetName] || PRESETS.small;
    const source = presetName === "custom" ? settings : base;
    const layout = {
      paper:"A4", preset:presetName,
      width:finite(source.width ?? base.width, "Label width", 20, 190),
      height:finite(source.height ?? base.height, "Label height", 20, 277),
      margin:finite(source.margin ?? base.margin, "Page margin", 0, 30),
      gapX:finite(source.gapX ?? base.gapX, "Horizontal gap", 0, 30),
      gapY:finite(source.gapY ?? base.gapY, "Vertical gap", 0, 30),
      columns:Math.trunc(finite(source.columns ?? base.columns, "Columns", 1, 8)),
      padding:finite(source.padding ?? base.padding, "Label padding", 1, 15)
    };
    return { ...layout, ...calculateLayout(layout) };
  }
  function calculateLayout(layout) {
    const usableWidth=A4.width-2*layout.margin, usableHeight=A4.height-2*layout.margin;
    const occupiedWidth=layout.columns*layout.width+Math.max(0,layout.columns-1)*layout.gapX;
    const rows=Math.floor((usableHeight+layout.gapY)/(layout.height+layout.gapY)), errors=[];
    if(occupiedWidth>usableWidth+0.001)errors.push(`Labels require ${occupiedWidth.toFixed(1)} mm but only ${usableWidth.toFixed(1)} mm is available.`);
    if(rows<1)errors.push("No label row fits within the printable A4 height.");
    if(layout.padding*2>=layout.width||layout.padding*2>=layout.height)errors.push("Label padding leaves no printable label area.");
    return {usableWidth,usableHeight,occupiedWidth,rows:Math.max(0,rows),capacity:Math.max(0,rows*layout.columns),errors};
  }
  function pageEstimate(studentCount,copies,capacity){const count=Math.max(0,Math.trunc(Number(studentCount)||0));const copyCount=Math.max(1,Math.min(10,Math.trunc(Number(copies)||1)));const labels=count*copyCount;return{students:count,copies:copyCount,labels,pages:capacity>0?Math.ceil(labels/capacity):0}}
  function code128ModuleWidth(id,labelWidth,padding){return(labelWidth-2*padding)/(11*String(id).length+55)}
  function barcodeWarnings(ids,layout,minimumModuleMm=0.25){return ids.filter(id=>code128ModuleWidth(id,layout.width,layout.padding)<minimumModuleMm).map(id=>`ID "${id}" may print too densely to scan reliably at ${layout.width} mm.`)}
  function orderedSelection(order,selected,students,query="",group=""){const set=selected instanceof Set?selected:new Set(selected||[]);const normalized=String(query).trim().toLowerCase();return order.filter(id=>{const student=students[id];return set.has(id)&&(!normalized||id.toLowerCase().includes(normalized)||student.name.toLowerCase().includes(normalized))&&(!group||student.group===group)})}
  return {A4,PRESETS,resolveLayout,calculateLayout,pageEstimate,code128ModuleWidth,barcodeWarnings,orderedSelection};
});
