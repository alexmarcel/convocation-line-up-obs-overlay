"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {initialClientSync}=require("../src/server");

test("controller registers online without waiting for library synchronization",()=>{
  assert.equal(initialClientSync("controller"),"online");
  assert.equal(initialClientSync("controller","connecting"),"online");
});
test("display roles retain their actual synchronization state",()=>{
  assert.equal(initialClientSync("scanner"),"connecting");
  assert.equal(initialClientSync("projector","syncing"),"syncing");
  assert.equal(initialClientSync("obs","ready"),"ready");
});
