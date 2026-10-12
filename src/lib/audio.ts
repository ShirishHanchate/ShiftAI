/**
 * Browser-side audio helpers.
 *
 * Sarvam's synchronous speech-to-text API accepts at most 30 s per request and
 * recommends 16 kHz mono 16-bit WAV for best accuracy. A recorded handover is
 * usually longer, so we decode it, resample to 16 kHz mono, and split it into
 * ≤25 s WAV segments (preferring to cut at quiet moments) that are transcribed
 * sequentially and joined.
 */

export const TARGET_SAMPLE_RATE = 16_000;
export const MAX_SEGMENT_SECONDS = 25;
const MIN_SEGMENT_SECONDS = 15;

export function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

/** Decode any browser-supported audio blob to 16 kHz mono Float32 samples. */
export async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const buf = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(buf.slice(0));
  } finally {
    void ctx.close();
  }
  const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded; // multi-channel input is down-mixed to the single output channel
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/** Split samples into segments ≤ MAX_SEGMENT_SECONDS, cutting at the quietest point near the end of each window. */
export function splitSamples(samples: Float32Array, rate = TARGET_SAMPLE_RATE): Float32Array[] {
  const maxLen = MAX_SEGMENT_SECONDS * rate;
  const minLen = MIN_SEGMENT_SECONDS * rate;
  const win = Math.floor(rate * 0.05); // 50 ms energy windows
  const segments: Float32Array[] = [];
  let start = 0;
  while (samples.length - start > maxLen) {
    let bestCut = start + maxLen;
    let bestEnergy = Infinity;
    for (let pos = start + minLen; pos + win <= start + maxLen; pos += win) {
      let e = 0;
      for (let i = pos; i < pos + win; i++) e += samples[i] * samples[i];
      if (e < bestEnergy) {
        bestEnergy = e;
        bestCut = pos + Math.floor(win / 2);
      }
    }
    segments.push(samples.subarray(start, bestCut));
    start = bestCut;
  }
  if (samples.length - start > rate * 0.3) segments.push(samples.subarray(start));
  return segments;
}

/** Encode mono Float32 samples as a 16-bit PCM WAV blob. */
export function encodeWav(samples: Float32Array, rate = TARGET_SAMPLE_RATE): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** Peak level of a segment, used to skip silent chunks rather than sending them to the API. */
export function peakLevel(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  return peak;
}

export async function prepareSegments(blob: Blob): Promise<{ segments: Blob[]; durationSeconds: number; silent: boolean }> {
  const samples = await decodeToMono16k(blob);
  const durationSeconds = samples.length / TARGET_SAMPLE_RATE;
  const parts = splitSamples(samples);
  const audible = parts.filter((p) => peakLevel(p) > 0.01);
  return { segments: audible.map((p) => encodeWav(p)), durationSeconds, silent: audible.length === 0 };
}
