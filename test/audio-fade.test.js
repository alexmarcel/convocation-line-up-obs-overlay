"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{volumeAt}=require("../public/audio-fade");

test("audio fade envelope supports disabled and independent fades",()=>{
  assert.equal(volumeAt(0,4,0,0),1);
  assert.equal(volumeAt(.5,4,1,0),.5);
  assert.equal(volumeAt(3.5,4,0,1),.5);
});
test("overlapping fades use the quieter envelope without extending audio",()=>{
  assert.equal(volumeAt(1,2,2,2),.5);
  assert.equal(volumeAt(1.5,2,2,2),.25);
  assert.equal(volumeAt(2,2,2,2),0);
});
test("audio fade envelope clamps times and tolerates unknown duration",()=>{
  assert.equal(volumeAt(-1,4,1,1),0);
  assert.equal(volumeAt(20,4,1,1),0);
  assert.equal(volumeAt(.5,NaN,1,1),.5);
});
