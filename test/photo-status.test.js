"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateMissingPhotos, missingPhotosForManifest } = require("../src/photo-status");

test("missing-photo calculation preserves CSV order", () => {
  assert.deepEqual(calculateMissingPhotos(["3","1","2"],{"1":{}, "2":{}},{"1":{}, "2":{}}),["3"]);
  assert.deepEqual(calculateMissingPhotos(["3","1","2"],{},{}),["3","1","2"]);
  assert.deepEqual(calculateMissingPhotos(["3","1"],{"3":{}},{"3":{}}),["1"]);
});

test("manifest helper uses declared metadata in order and derives it for older manifests", () => {
  const current={order:["2","1"],students:{"1":{},"2":{}},missingPhotos:["1"],assets:{photos:{},thumbnails:{}}};
  assert.deepEqual(missingPhotosForManifest(current),["1"]);
  const older={order:["2","1"],students:{"1":{},"2":{}},assets:{photos:{"2":{}},thumbnails:{"2":{}}}};
  assert.deepEqual(missingPhotosForManifest(older),["1"]);
});
