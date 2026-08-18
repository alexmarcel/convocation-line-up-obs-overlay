"use strict";

function prepareRecording(samples, sampleRate, options = {}) {
  if (!(samples instanceof Float32Array)) samples = new Float32Array(samples);
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error("Invalid recording sample rate.");
  if (!samples.length) throw new Error("No microphone audio was captured.");
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak < (options.minimumPeak || 0.005)) throw new Error("The recording is silent. Check the selected microphone.");

  const threshold = Math.max(options.silenceThreshold || 0.008, peak * 0.04);
  let first = 0, last = samples.length - 1;
  while (first < samples.length && Math.abs(samples[first]) < threshold) first++;
  while (last > first && Math.abs(samples[last]) < threshold) last--;
  const spokenSeconds = (last - first + 1) / sampleRate;
  if (spokenSeconds < (options.minimumSpeechSeconds || 0.15)) throw new Error("The recording is too short.");

  const padding = Math.round(sampleRate * (options.paddingSeconds || 0.12));
  const start = Math.max(0, first - padding);
  const end = Math.min(samples.length, last + padding + 1);
  const trimmed = samples.slice(start, end);
  const targetPeak = options.targetPeak || 0.88;
  const gain = Math.min(options.maximumGain || 4, targetPeak / peak);
  for (let index = 0; index < trimmed.length; index++) trimmed[index] = Math.max(-1, Math.min(1, trimmed[index] * gain));
  return { samples:trimmed, sampleRate, peak, gain, duration:trimmed.length / sampleRate };
}

function encodeWav(samples, sampleRate) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    buffer.writeInt16LE(value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff), 44 + index * 2);
  }
  return buffer;
}

function processRecording(samples, sampleRate, options) {
  const prepared = prepareRecording(samples, sampleRate, options);
  return { ...prepared, wav:encodeWav(prepared.samples, prepared.sampleRate) };
}

module.exports = { prepareRecording, encodeWav, processRecording };
