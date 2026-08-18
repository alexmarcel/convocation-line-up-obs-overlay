"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareRecording, encodeWav, processRecording } = require("../src/wav");

function spokenSamples(sampleRate = 8000) {
  const samples = new Float32Array(sampleRate * 2);
  for (let index = sampleRate * 0.5; index < sampleRate * 1.5; index++) samples[index] = Math.sin(index / 8) * 0.2;
  return samples;
}

test("prepareRecording trims silence, retains padding, and normalizes conservatively", () => {
  const prepared = prepareRecording(spokenSamples(), 8000);
  assert.ok(prepared.duration > 1.1 && prepared.duration < 1.3);
  assert.ok(prepared.gain <= 4);
  const peak = Math.max(...prepared.samples.map(Math.abs));
  assert.ok(peak > 0.79 && peak <= 0.89);
});

test("prepareRecording rejects silent and very short input", () => {
  assert.throws(() => prepareRecording(new Float32Array(8000), 8000), /silent/);
  const short = new Float32Array(8000);
  short.fill(0.2, 4000, 4400);
  assert.throws(() => prepareRecording(short, 8000), /too short/);
});

test("encodeWav writes a valid mono PCM WAV header", () => {
  const wav = encodeWav(new Float32Array([0, 0.5, -0.5]), 48000);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 48000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), 6);
});

test("processRecording returns processed metadata and WAV bytes", () => {
  const result = processRecording(spokenSamples(8000), 8000);
  assert.ok(result.wav.length > 44);
  assert.ok(result.duration > 1);
});
