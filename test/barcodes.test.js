"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateBarcodeId, generateBarcodeSvg, generateBarcodeBatch } = require("../src/barcodes");

test("Code 128 SVG generation supports numeric and printable alphanumeric IDs", () => {
  for(const id of ["001234","A-100/2","ID_42"]){
    const svg=generateBarcodeSvg(id);
    assert.match(svg,/^<svg/);
    assert.match(svg,/<path/);
  }
});

test("barcode validation rejects empty, oversized, and non-ASCII IDs", () => {
  assert.throws(()=>validateBarcodeId(""),/empty/);
  assert.throws(()=>validateBarcodeId("x".repeat(129)),/longer than 128/);
  assert.throws(()=>validateBarcodeId("学生-1"),/unsupported/);
});

test("batch generation reports invalid entries without losing valid barcodes", () => {
  const result=generateBarcodeBatch(["100","学生"]);
  assert.match(result.barcodes["100"],/^<svg/);
  assert.equal(result.errors.length,1);
  assert.equal(result.errors[0].id,"学生");
});
