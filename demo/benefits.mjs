// Records a narrated "Why it matters" benefits section and splices it in before the outro card.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import ffmpeg from "ffmpeg-static";
import { durationOf } from "./narration.mjs";

const BASE = "http://localhost:3000";
const CLIPS = {
  b1: "Why does this matter? Today, a shift handover takes each engineer around ten minutes. They write notes, update every ticket by hand, and walk the next shift through each incident. Details still get lost, and the incoming engineer starts the shift half blind.",
  b2: "With ShiftSync, the outgoing engineer simply speaks for about a minute. The AI drafts every ticket update with evidence, and the engineer reviews and confirms in a few clicks. That brings the handover from about ten minutes down to around two.",
  b3: "Tickets stay up to date, every change is audited, and nothing depends on memory. Even if nobody records a handover, Auto Handover builds one from tickets, emails and chat. And the incoming engineer gets a prioritised briefing they can simply ask questions of. That is zero-friction shift handover.",
};

async function tts(text, file) {
  if (fs.existsSync(file)) return;
  const res = await fetch(`${BASE}/api/voice/speak`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}
const dur = {};
for (const [k, text] of Object.entries(CLIPS)) { await tts(text, `audio/${k}.mp3`); dur[k] = durationOf(`audio/${k}.mp3`); }
console.log(dur);

const HTML = `<html><head><style>
  *{box-sizing:border-box} body{margin:0;height:100vh;background:radial-gradient(circle at 30% 20%,#1e3a8a,#0f172a 60%);color:#fff;
  font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:56px 80px;display:flex;flex-direction:column;gap:30px}
  .r{opacity:0;transform:translateY(16px);transition:all .7s ease} .r.on{opacity:1;transform:none}
  h1{margin:0;font-size:52px;font-weight:800;letter-spacing:-1px} h1 span{color:#93c5fd}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:28px}
  .card{border-radius:20px;padding:28px 32px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12)}
  .before{border-color:rgba(248,113,113,.45)} .after{border-color:rgba(52,211,153,.55);background:rgba(16,185,129,.10)}
  .lbl{font-size:16px;letter-spacing:2px;text-transform:uppercase;opacity:.75}
  .big{font-size:64px;font-weight:800;margin:6px 0 4px} .before .big{color:#fca5a5} .after .big{color:#6ee7b7}
  ul{margin:10px 0 0;padding-left:22px;font-size:21px;line-height:1.6;opacity:.92}
  .chips{display:flex;flex-wrap:wrap;gap:14px}
  .chip{font-size:20px;padding:12px 20px;border-radius:999px;background:rgba(147,197,253,.14);border:1px solid rgba(147,197,253,.35)}
  .zero{margin-top:auto;text-align:center;font-size:44px;font-weight:800;padding:22px;border-radius:20px;
    background:linear-gradient(90deg,#2563eb,#10b981)}
</style></head><body>
  <h1 class="r" id="t">Why it matters: <span>shift handover, without the friction</span></h1>
  <div class="cols">
    <div class="card before r" id="before"><div class="lbl">Today · manual handover</div><div class="big">~10 min</div>
      <ul><li>Typing notes and updating every ticket by hand</li><li>Verbal walk-through, so context lives in people's heads</li><li>Stale tickets, missed owners and deadlines</li></ul></div>
    <div class="card after r" id="after"><div class="lbl">With ShiftSync AI</div><div class="big">~2 min</div>
      <ul><li>Speak for about 1 min, in English or Indian languages</li><li>AI drafts evidence-checked ticket updates</li><li>Review and confirm in a few clicks</li></ul></div>
  </div>
  <div class="chips r" id="chips">
    <div class="chip">✅ Tickets always up to date</div><div class="chip">🧾 Full audit trail</div>
    <div class="chip">🧠 No reliance on memory</div><div class="chip">⚡ Auto Handover when nobody records one</div>
    <div class="chip">🎯 Prioritised incoming-shift briefing</div><div class="chip">🎙️ Ask questions by voice</div>
  </div>
  <div class="zero r" id="zero">Zero-friction shift handover for 24×7 operations</div>
</body></html>`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: "raw-benefits", size: { width: 1440, height: 900 } } });
const page = await ctx.newPage();
const t0 = Date.now();
await page.setContent(HTML);
const on = (...ids) => page.evaluate((ids) => ids.forEach((i) => document.getElementById(i).classList.add("on")), ids);
const wait = (s) => page.waitForTimeout(s * 1000);
const startPad = 0.5;
await wait(0.2);
const tStart = (Date.now() - t0) / 1000 + startPad; // narration starts here (raw time)
await wait(startPad);
await on("t", "before");
await wait(dur.b1 + 0.5);
await on("after");
await wait(dur.b2 + 0.5);
await on("chips");
await wait(dur.b3 * 0.75);
await on("zero");
await wait(dur.b3 * 0.25 + 1.5);
const video = page.video();
await ctx.close(); await browser.close();
const raw = await video.path();

// Benefits clip: narration clips placed back to back (0.5 s gaps), aligned with the reveals.
const d1 = Math.round(tStart * 1000), d2 = Math.round((tStart + dur.b1 + 0.5) * 1000), d3 = Math.round((tStart + dur.b1 + dur.b2 + 1.0) * 1000);
execFileSync(ffmpeg, ["-y", "-i", raw, "-i", "audio/b1.mp3", "-i", "audio/b2.mp3", "-i", "audio/b3.mp3", "-filter_complex",
  `[0:v]fps=30,format=yuv420p[v];[1:a]aresample=44100,adelay=${d1}|${d1}[a1];[2:a]aresample=44100,adelay=${d2}|${d2}[a2];[3:a]aresample=44100,adelay=${d3}|${d3}[a3];[a1][a2][a3]amix=inputs=3:normalize=0,apad[a]`,
  "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2", "-shortest", "out/benefits.mp4"], { stdio: "pipe" });

// Splice: main [0, outro) + benefits + main [outro, end)
const { cues, fast } = JSON.parse(fs.readFileSync("timeline.json", "utf8"));
let saved = 0;
const outroRaw = cues.find((c) => c.key === "outro").t;
for (const f of fast) if (f.to <= outroRaw) { const len = f.to - f.from; const s = Math.max(1, Math.min(8, len / 1.5)); saved += len - len / s; }
const cut = (outroRaw - saved - 0.15).toFixed(3);
const main = "out/ShiftSync-AI-demo.mp4";
const enc = ["-c:v", "libx264", "-crf", "20", "-r", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2"];
execFileSync(ffmpeg, ["-y", "-i", main, "-t", cut, ...enc, "out/part1.mp4"], { stdio: "pipe" });
execFileSync(ffmpeg, ["-y", "-ss", cut, "-i", main, ...enc, "out/part3.mp4"], { stdio: "pipe" });
execFileSync(ffmpeg, ["-y", "-i", "out/part1.mp4", "-i", "out/benefits.mp4", "-i", "out/part3.mp4", "-filter_complex",
  "[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[v][a]", "-map", "[v]", "-map", "[a]", ...enc, "-movflags", "+faststart", "out/ShiftSync-AI-demo-v2.mp4"], { stdio: "pipe" });
console.log("cut at", cut, "final seconds:", durationOf("out/ShiftSync-AI-demo-v2.mp4").toFixed(1));
