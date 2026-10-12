/**
 * LIVE check of the long-recording path: splits a 16-bit PCM WAV of any length into
 * ≤25 s segments with the SAME functions the browser uses (src/lib/audio.ts), then
 * transcribes each segment through the running app's /api/voice/transcribe endpoint.
 *
 *   npm run dev            # in another terminal
 *   npm run live:transcribe -- path/to/handover.wav [http://localhost:3000]
 */
import { readFileSync } from "node:fs";
import { encodeWav, peakLevel, splitSamples, TARGET_SAMPLE_RATE } from "../src/lib/audio";

const [file, base = "http://localhost:3000"] = process.argv.slice(2);
if (!file) {
  console.error("Usage: npm run live:transcribe -- <file.wav> [baseUrl]");
  process.exit(1);
}

function readPcm16Mono(path: string): Float32Array {
  const buf = readFileSync(path);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = 12;
  let rate = 0;
  let channels = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      channels = view.getUint16(offset + 10, true);
      rate = view.getUint32(offset + 12, true);
    }
    if (id === "data") {
      if (rate !== TARGET_SAMPLE_RATE || channels !== 1) throw new Error(`Expected 16 kHz mono WAV, got ${rate} Hz / ${channels}ch`);
      const out = new Float32Array(size / 2);
      for (let i = 0; i < out.length; i++) out[i] = view.getInt16(offset + 8 + i * 2, true) / 0x8000;
      return out;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("No data chunk found");
}

(async () => {
  const samples = readPcm16Mono(file);
  const segments = splitSamples(samples).filter((s) => peakLevel(s) > 0.01);
  console.log(`Audio ${(samples.length / TARGET_SAMPLE_RATE).toFixed(1)}s → ${segments.length} segment(s): ${segments.map((s) => (s.length / TARGET_SAMPLE_RATE).toFixed(1) + "s").join(", ")}`);
  const parts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const form = new FormData();
    form.append("file", encodeWav(segments[i]), `part-${i + 1}.wav`);
    form.append("languageCode", "en-IN");
    const t = Date.now();
    const res = await fetch(`${base}/api/voice/transcribe`, { method: "POST", body: form });
    const body = await res.json();
    if (!res.ok) {
      console.error(`Segment ${i + 1} failed: HTTP ${res.status} ${body?.error?.message}`);
      process.exit(1);
    }
    console.log(`Segment ${i + 1}: ${((Date.now() - t) / 1000).toFixed(1)}s — ${body.transcript}`);
    parts.push(body.transcript);
  }
  console.log(`\nFULL TRANSCRIPT:\n${parts.join(" ")}`);
})();
