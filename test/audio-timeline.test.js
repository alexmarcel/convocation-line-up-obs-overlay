"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {formatTime,progress}=require("../public/audio-timeline");
test("audio timeline formats elapsed and total seconds",()=>{
  assert.equal(formatTime(0),"0:00");assert.equal(formatTime(65.9),"1:05");assert.equal(formatTime(Number.NaN),"0:00");
});
test("audio timeline progress is bounded and rejects invalid durations",()=>{
  assert.equal(progress(5,10),50);assert.equal(progress(-1,10),0);assert.equal(progress(12,10),100);assert.equal(progress(2,0),0);
});
