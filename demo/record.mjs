// Drives the running app with Playwright, recording video + a timeline of narration cues and fast-forward spans.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { NARRATION } from "./narration.mjs";

const BASE = "http://localhost:3000";
const DUR = JSON.parse(fs.readFileSync("audio/durations.json", "utf8"));
const W = 1440, H = 900;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: "raw", size: { width: W, height: H } },
  colorScheme: "light",
});
await context.addInitScript(() => {
  window.__cap = (text) => {
    let el = document.getElementById("__demo_cap");
    if (!el) {
      el = document.createElement("div");
      el.id = "__demo_cap";
      el.style.cssText =
        "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:1100px;z-index:2147483647;" +
        "background:rgba(15,23,42,.88);color:#fff;font:500 19px/1.45 system-ui,sans-serif;padding:12px 22px;border-radius:12px;" +
        "box-shadow:0 8px 30px rgba(0,0,0,.25);text-align:center;pointer-events:none";
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
    el.style.display = text ? "block" : "none";
  };
});

const page = await context.newPage();
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const cues = []; // { key, t }
const fast = []; // { from, to }
let caption = "";
let cueEnd = 0;

const setCap = async (text) => {
  caption = text;
  await page.evaluate((t) => window.__cap?.(t), text).catch(() => {});
};
const goto = async (url) => {
  await page.goto(BASE + url, { waitUntil: "networkidle" }).catch(() => {});
  await setCap(caption);
};
const pause = (s) => page.waitForTimeout(s * 1000);
/** Start a narration cue; waits for the previous one to finish first. */
async function cue(key) {
  const wait = cueEnd - now();
  if (wait > 0) await pause(wait);
  cues.push({ key, t: now() });
  cueEnd = now() + DUR[key] + 0.6;
  await setCap(NARRATION[key]);
}
const finishCue = async () => { const w = cueEnd - now(); if (w > 0) await pause(w); };
/** Run a slow operation and mark it to be fast-forwarded in the final cut. */
async function fastForward(fn) {
  await finishCue();
  const from = now();
  await setCap("⏩  Fast-forwarded while Sarvam works…");
  await fn();
  fast.push({ from, to: now() });
  cueEnd = now();
}
const scrollBy = async (dy, steps = 6) => {
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await pause(0.12); }
};
const shot = (name) => page.screenshot({ path: `shots/${name}.png` }).catch(() => {});
fs.mkdirSync("shots", { recursive: true });

async function card(title, subtitle) {
  await page.setContent(`<html><body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
    background:radial-gradient(circle at 30% 20%,#1e3a8a,#0f172a 60%);color:#fff;font-family:system-ui,sans-serif">
    <div style="font-size:72px;font-weight:800;letter-spacing:-1px">${title}</div>
    <div style="margin-top:18px;font-size:26px;opacity:.85;max-width:1000px;text-align:center;line-height:1.5">${subtitle}</div></body></html>`);
  await setCap(caption);
}

try {
  // 0 · Intro
  await card("ShiftSync AI", "Voice-first shift handover for 24×7 IT operations<br><span style='opacity:.7;font-size:20px'>Sarvam AI · Supabase · Next.js</span>");
  await cue("intro");

  // 1 · Dashboard
  await goto("/");
  await cue("dashboard");
  await pause(2.5);
  await page.getByLabel("Search incidents").fill("payments");
  await pause(2);
  await page.getByLabel("Search incidents").fill("");
  await pause(1);
  await scrollBy(300);
  await shot("01-dashboard");
  await finishCue();

  // 2 · Incident detail
  await goto("/incidents/INC-1042");
  await cue("detail");
  await pause(3);
  await scrollBy(600, 10);
  await shot("02-detail");
  await finishCue();

  // 3 · Voice handover via uploaded recording → Sarvam STT
  await goto("/handover");
  await cue("handover");
  await pause(1.5);
  await page.locator('input[type="file"]').setInputFiles(path.resolve("audio/handover.wav"));
  await pause(2);
  await page.getByRole("button", { name: /Transcribe with Sarvam/ }).click();
  await page.getByLabel("Handover transcript").waitFor({ timeout: 90_000 });
  await page.waitForFunction(
    () => (document.querySelector('textarea[aria-label="Handover transcript"]')?.value ?? "").length > 50,
    null, { timeout: 90_000 });
  await pause(1);
  await shot("03-transcript");
  await page.getByLabel("Handover transcript").scrollIntoViewIfNeeded();
  await finishCue();

  await cue("transcript");
  await finishCue();

  // 4 · Extraction
  await page.getByRole("button", { name: /Generate Handover Draft/ }).click();
  await cue("extracting");
  await fastForward(async () => {
    await page.getByRole("button", { name: /Approve/ }).first().waitFor({ timeout: 180_000 });
  });
  await pause(1);

  // 5 · Review + confirm
  await page.getByRole("button", { name: /Approve/ }).first().scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, -150);
  await cue("review");
  await pause(2);
  await shot("04-review");
  await scrollBy(700, 10);
  await pause(1);
  const approve = page.getByRole("button", { name: /Approve$/ });
  const n = await approve.count();
  for (let i = 0; i < n; i++) {
    const b = approve.nth(i);
    if (await b.isEnabled()) { await b.scrollIntoViewIfNeeded(); await b.click(); await pause(0.8); }
  }
  // Tick any explicit "resolved" confirmation boxes so Confirm is enabled.
  for (const box of await page.getByRole("checkbox").all()) {
    if (!(await box.isChecked().catch(() => true))) await box.check().catch(() => {});
  }
  const confirmBtn = page.getByRole("button", { name: /Confirm handover/ });
  await confirmBtn.scrollIntoViewIfNeeded();
  await finishCue();
  await shot("05-before-confirm");
  await confirmBtn.click();
  await cue("confirmed");
  await page.waitForTimeout(4000);
  await shot("06-confirmed");
  await finishCue();

  // 6 · Persisted history
  await goto("/incidents/INC-1042");
  await cue("history");
  await scrollBy(1400, 14);
  await shot("07-history");
  await finishCue();

  // 7 · Incoming shift briefing (+ Auto Handover)
  await goto("/briefing");
  await cue("briefing");
  await fastForward(async () => {
    await pause(1);
    await page.waitForFunction(() => !document.body.innerText.includes("Reading tickets, history"), null, { timeout: 180_000 }).catch(() => {});
    await pause(1);
  });
  await setCap(NARRATION.briefing);
  await pause(3);
  await shot("08-auto-handover");
  await cue("briefing2");
  await scrollBy(1500, 18);
  await shot("09-briefing");
  await finishCue();

  // 8 · Ask ShiftSync
  await goto("/assistant");
  await cue("assistant");
  await page.getByLabel("Question").fill("Why is INC-1044 still unresolved?");
  await pause(1);
  await page.getByRole("button", { name: "Send" }).click();
  await fastForward(async () => {
    await pause(1);
    await page.waitForFunction(() => !document.body.innerText.includes("Checking incident records"), null, { timeout: 120_000 }).catch(() => {});
    await pause(1.5);
  });
  await setCap(NARRATION.assistant);
  await pause(5);
  await shot("10-agent");
  await cue("readonly");
  await page.getByLabel("Question").fill("Close INC-1043 now");
  await page.getByRole("button", { name: "Send" }).click();
  await fastForward(async () => {
    await pause(1);
    await page.waitForFunction(() => !document.body.innerText.includes("Checking incident records"), null, { timeout: 120_000 }).catch(() => {});
    await pause(1.5);
  });
  await setCap(NARRATION.readonly);
  await pause(5);
  await shot("11-readonly");

  // 9 · Handover log
  await goto("/handovers");
  await cue("log");
  await pause(3);
  const first = page.locator('a[href^="/handovers/"]').first();
  if (await first.count()) { await first.click(); await page.waitForLoadState("networkidle"); await setCap(caption); }
  await scrollBy(800, 10);
  await shot("12-log");
  await finishCue();

  // 10 · Outro
  await card("ShiftSync AI", "Speak → Transcribe → Extract → Human review → Atomic confirm → Briefing → Ask<br><span style='opacity:.7;font-size:20px'>42 automated tests · audit trail · secrets server-side only</span>");
  await cue("outro");
  await finishCue();
  await pause(1);
} catch (e) {
  console.error("FAILED:", e);
  await shot("zz-failure");
  process.exitCode = 1;
} finally {
  const video = page.video();
  await context.close();
  await browser.close();
  const raw = await video.path();
  fs.writeFileSync("timeline.json", JSON.stringify({ raw, cues, fast }, null, 2));
  console.log(JSON.stringify({ raw, cues, fast }, null, 2));
}
