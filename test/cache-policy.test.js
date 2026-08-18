"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Policy=require("../public/cache-policy");

test("projector backgrounds reuse the existing IndexedDB settings store",()=>{
  assert.equal(Policy.storeForKind("backgrounds"),"settings");
  assert.equal(Policy.keyForAsset("backgrounds","abc"),"background:abc");
  assert.equal(Policy.isAssetKey("backgrounds","background:abc"),true);
  assert.equal(Policy.isAssetKey("backgrounds","live"),false);
});
test("student media retain their existing cache stores and hash keys",()=>{
  assert.equal(Policy.storeForKind("photos"),"photos");
  assert.equal(Policy.keyForAsset("audio","abc"),"abc");
});
test("each display role has an independent synchronization marker",()=>{
  assert.equal(Policy.manifestKeyForRole("scanner"),"activeManifest:scanner");
  assert.equal(Policy.manifestKeyForRole("projector"),"activeManifest:projector");
  assert.equal(Policy.manifestKeyForRole("obs"),"activeManifest:obs");
  assert.notEqual(Policy.manifestKeyForRole("scanner"),Policy.manifestKeyForRole("projector"));
});
test("role policies include every asset needed by that display",()=>{
  assert.deepEqual(Policy.kindsForRole("scanner"),["thumbnails"]);
  assert.deepEqual(Policy.kindsForRole("projector"),["photos","audio","backgrounds"]);
  assert.deepEqual(Policy.kindsForRole("obs"),["photos","audio"]);
});
