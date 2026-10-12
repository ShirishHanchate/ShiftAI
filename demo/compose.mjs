// Cuts the raw recording (fast-forwarding slow spans) and mixes in narration at the mapped cue times.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { durationOf } from "./narration.mjs";

const { raw, cues, fast } = JSON.parse(fs.readFileSync("timeline.json", "utf8"));
const total = durationOf(raw);
const SPEED = 8;

// Build ordered spans: [start, end, speed]
const spans = [];
let t = 0;
for (const f of fast) {
  if (f.from > t) spans.push([t, f.from, 1]);
  const len = f.to - f.from;
  spans.push([f.from, f.to, Math.max(1, Math.min(SPEED, len / 1.5))]);
  t = f.to;
}
spans.push([t, total, 1]);

const mapTime = (x) => {
  let out = 0;
  for (const [a, b, s] of spans) {
    if (x >= b) out += (b - a) / s;
    else { if (x > a) out += (x - a) / s; break; }
  }
  return out;
};

const parts = spans.map(([a, b, s], i) =>
  `[0:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=(PTS-STARTPTS)/${s.toFixed(3)}[v${i}]`);
const concat = spans.map((_, i) => `[v${i}]`).join("") + `concat=n=${spans.length}:v=1:a=0,format=yuv420p[vout]`;
const inputs = ["-i", raw];
const audioLabels = [];
cues.forEach((c, i) => {
  inputs.push("-i", `audio/${c.key}.mp3`);
  const ms = Math.round(mapTime(c.t) * 1000);
  parts.push(`[${i + 1}:a]aresample=44100,adelay=${ms}|${ms}[a${i}]`);
  audioLabels.push(`[a${i}]`);
});
parts.push(concat);
parts.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:normalize=0[aout]`);

fs.mkdirSync("out", { recursive: true });
execFileSync(ffmpeg, [
  "-y", ...inputs, "-filter_complex", parts.join(";"),
  "-map", "[vout]", "-map", "[aout]",
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", "30",
  "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-shortest", "out/ShiftSync-AI-demo.mp4",
], { stdio: "inherit" });
console.log("output seconds:", durationOf("out/ShiftSync-AI-demo.mp4").toFixed(1));
