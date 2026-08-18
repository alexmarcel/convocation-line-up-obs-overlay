"use strict";

const bwipjs = require("bwip-js");

function validateBarcodeId(id) {
  const value = String(id ?? "");
  if (!value) throw new Error("Student ID is empty.");
  if (value.length > 128) throw new Error(`Student ID "${value.slice(0, 20)}..." is longer than 128 characters.`);
  if (!/^[\x20-\x7e]+$/.test(value)) throw new Error(`Student ID "${value}" contains characters unsupported by Code 128.`);
  return value;
}
function generateBarcodeSvg(id) {
  const text = validateBarcodeId(id);
  return bwipjs.toSVG({
    bcid:"code128",
    text,
    scale:2,
    height:12,
    includetext:false,
    paddingwidth:8,
    paddingheight:2,
    backgroundcolor:"FFFFFF"
  });
}
function generateBarcodeBatch(ids) {
  const barcodes = Object.create(null), errors = [];
  for (const id of ids) {
    try { barcodes[id] = generateBarcodeSvg(id); }
    catch (error) { errors.push({ id, error:error.message }); }
  }
  return { barcodes, errors };
}

module.exports = { validateBarcodeId, generateBarcodeSvg, generateBarcodeBatch };
