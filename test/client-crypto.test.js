"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {randomId,sha256Hex}=require("../public/client-crypto");

test("HTTP-safe client IDs are UUID-shaped and unique",()=>{
  const first=randomId(),second=randomId();
  assert.match(first,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first,second);
});

test("browser SHA-256 fallback matches standard vectors",()=>{
  assert.equal(sha256Hex(new TextEncoder().encode("abc")),"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256Hex(new Uint8Array()),"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});
