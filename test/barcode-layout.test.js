"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PRESETS, resolveLayout, pageEstimate, code128ModuleWidth, barcodeWarnings, orderedSelection } = require("../src/barcode-layout");

test("A4 presets resolve to valid capacities", () => {
  const small=resolveLayout({preset:"small"}), medium=resolveLayout({preset:"medium"}), large=resolveLayout({preset:"large"});
  assert.deepEqual(small.errors, []);
  assert.equal(small.columns, 3);
  assert.equal(small.capacity, 18);
  assert.equal(medium.capacity, 10);
  assert.equal(large.capacity, 6);
  assert.deepEqual(PRESETS.small, { width:60, height:36, margin:10, gapX:5, gapY:5, columns:3, padding:3 });
});

test("custom layouts reject overflow and invalid dimensions", () => {
  const overflow=resolveLayout({preset:"custom",width:100,height:40,margin:10,gapX:5,gapY:5,columns:2,padding:3});
  assert.match(overflow.errors[0], /require 205.0 mm/);
  assert.throws(()=>resolveLayout({preset:"custom",width:10,height:40,margin:10,gapX:5,gapY:5,columns:2,padding:3}), /Label width/);
});

test("page estimates include copies and handle empty selections", () => {
  assert.deepEqual(pageEstimate(20,2,18), {students:20,copies:2,labels:40,pages:3});
  assert.deepEqual(pageEstimate(0,1,18), {students:0,copies:1,labels:0,pages:0});
  assert.equal(pageEstimate(2,99,18).copies, 10);
});

test("selection preserves CSV order while applying search and group filters", () => {
  const students={
    "2":{name:"Beta",group:"Blue"},
    "1":{name:"Alpha",group:"Red"},
    "3":{name:"Gamma",group:"Blue"}
  };
  assert.deepEqual(orderedSelection(["2","1","3"],new Set(["1","3"]),students),["1","3"]);
  assert.deepEqual(orderedSelection(["2","1","3"],new Set(["2","3"]),students,"gam","Blue"),["3"]);
});

test("density warnings identify labels with modules below the minimum width", () => {
  const layout=resolveLayout({preset:"small"});
  assert.ok(code128ModuleWidth("123",layout.width,layout.padding)>0.25);
  assert.equal(barcodeWarnings(["123","X".repeat(40)],layout).length,1);
});
