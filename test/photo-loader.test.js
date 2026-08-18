"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const SafePhotoLoader = require("../src/photo-loader");

function fakeImage(decode = async () => {}) {
  const classes=new Set();
  return {
    src:"",onload:null,onerror:null,decode,
    classList:{add:value=>classes.add(value),remove:value=>classes.delete(value),contains:value=>classes.has(value)},
    removeAttribute(name){if(name==="src")this.src="";}
  };
}

test("missing and corrupt photos keep the slot hidden", async () => {
  const revoked=[],missingImage=fakeImage();
  const missing=new SafePhotoLoader({image:missingImage,loadAsset:async()=>"",revoke:url=>revoked.push(url)});
  assert.equal(await missing.load("photos","1",missing.begin()),false);
  assert.equal(missingImage.classList.contains("photo-unavailable"),true);
  const corruptImage=fakeImage(async()=>{throw new Error("decode")});
  const corrupt=new SafePhotoLoader({image:corruptImage,loadAsset:async()=>"blob:bad",revoke:url=>revoked.push(url)});
  assert.equal(await corrupt.load("photos","1",corrupt.begin()),false);
  assert.equal(corruptImage.classList.contains("photo-unavailable"),true);
  assert.ok(revoked.includes("blob:bad"));
});

test("valid photos reveal only after decode and active URLs are revoked on change", async () => {
  let releaseDecode;
  const image=fakeImage(()=>new Promise(resolve=>{releaseDecode=resolve}));
  const revoked=[],loader=new SafePhotoLoader({image,loadAsset:async()=>"blob:one",revoke:url=>revoked.push(url)});
  const generation=loader.begin(),loading=loader.load("photos","1",generation);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(image.classList.contains("photo-unavailable"),true);
  releaseDecode();assert.equal(await loading,true);
  assert.equal(image.classList.contains("photo-unavailable"),false);
  loader.begin();
  assert.ok(revoked.includes("blob:one"));
  assert.equal(image.classList.contains("photo-unavailable"),true);
});

test("a delayed earlier lookup cannot replace a newer student's photo", async () => {
  const pending={};
  const image=fakeImage(),revoked=[];
  const loader=new SafePhotoLoader({
    image,
    loadAsset:(_kind,id)=>new Promise(resolve=>{pending[id]=resolve}),
    revoke:url=>revoked.push(url)
  });
  const first=loader.begin(),firstLoad=loader.load("photos","old",first);
  await new Promise(resolve=>setImmediate(resolve));
  const second=loader.begin(),secondLoad=loader.load("photos","new",second);
  await new Promise(resolve=>setImmediate(resolve));
  pending.new("blob:new");assert.equal(await secondLoad,true);
  pending.old("blob:old");assert.equal(await firstLoad,false);
  assert.equal(image.src,"blob:new");
  assert.ok(revoked.includes("blob:old"));
});
