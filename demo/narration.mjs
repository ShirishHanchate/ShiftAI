// Generates narration MP3s via the app's own Sarvam TTS endpoint and records their durations.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";

const BASE = "http://localhost:3000";
export const NARRATION = {
  intro: "This is ShiftSync AI, a voice-first shift handover tool for twenty-four by seven IT operations, built on Sarvam AI and Supabase.",
  dashboard: "The incidents dashboard shows live incidents from Supabase. It has severity counts, search and filters. Let's open the payments incident, INC 1042.",
  detail: "Each incident shows its current situation, pending actions with owners and deadlines, blockers, and a full update history.",
  handover: "At the end of the shift, the outgoing engineer records the handover. Here we upload a spoken recording. The browser splits the audio into short segments, and Sarvam's Saaras speech-to-text model transcribes it.",
  transcript: "The transcript can be edited. Next, Sarvam's one-hundred-and-five-billion-parameter model extracts structured updates for each incident.",
  extracting: "Extraction never writes to the database. Every proposed fact has to be backed by a quote that the server finds in the transcript.",
  review: "The engineer reviews each proposed update, with its evidence quotes. Invented owners are stripped, and nothing is marked resolved without an explicit statement. We approve the updates and confirm.",
  confirmed: "Confirmation runs as one Postgres transaction. It uses row locks, optimistic concurrency checks and an idempotency key, and writes an audit row for every change.",
  history: "Back on the incident, the change history shows each field before and after, linked to the handover and its original transcript.",
  briefing: "For the incoming shift, Auto Handover writes a handover from tickets, history, emails and chat, even when nobody recorded one.",
  briefing2: "Below that is a deterministic priority briefing, showing overdue items, blockers, upcoming follow-ups and owner gaps. AI recommendations are kept separate from recorded facts.",
  assistant: "Ask ShiftSync is a read-only voice copilot. It answers from the database records and cites incident IDs. Answers can be played back as speech using Sarvam's Bulbul voice.",
  readonly: "If you ask it to change something, it explains that it is read-only. Only a human-confirmed handover can change an incident.",
  log: "The handover log keeps every confirmed handover, with the original and edited transcript and every review decision.",
  outro: "ShiftSync AI is built with Next.js, Supabase and Sarvam AI, and has forty-two automated tests. Thank you for watching.",
};
// Spoken handover used as the "recorded" audio for the STT demo.
export const SPOKEN_HANDOVER =
  "Shift handover from the night shift. Incident INC 1042, the payments API errors. Asha rolled back the gateway config and the error rate is down to about one percent. " +
  "Asha will give the next update in thirty minutes. Incident INC 1043, the Kafka consumer lag has fully drained. Mei Lin needs to scale the consumers back down to six pods.";

export function durationOf(file) {
  let out = "";
  try { execFileSync(ffmpeg, ["-i", file], { stdio: "pipe" }); } catch (e) { out = String(e.stderr); }
  const m = out.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
}

async function tts(text, file) {
  const res = await fetch(`${BASE}/api/voice/speak`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

if (process.argv[1].endsWith("narration.mjs")) {
  fs.mkdirSync("audio", { recursive: true });
  const durations = {};
  for (const [k, text] of Object.entries(NARRATION)) {
    const f = `audio/${k}.mp3`;
    if (!fs.existsSync(f)) await tts(text, f);
    durations[k] = durationOf(f);
    console.log(k, durations[k].toFixed(1));
  }
  if (!fs.existsSync("audio/handover.wav")) {
    await tts(SPOKEN_HANDOVER, "audio/handover-src.mp3");
    execFileSync(ffmpeg, ["-y", "-i", "audio/handover-src.mp3", "-ac", "1", "-ar", "16000", "audio/handover.wav"], { stdio: "pipe" });
  }
  console.log("handover.wav", durationOf("audio/handover.wav").toFixed(1));
  fs.writeFileSync("audio/durations.json", JSON.stringify(durations, null, 2));
}
