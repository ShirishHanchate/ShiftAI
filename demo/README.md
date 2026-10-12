# Demo video generator

These scripts record the hackathon demo video from the **running app**. Nothing is mocked: real Supabase and real Sarvam calls are made.

| Script | What it does |
| --- | --- |
| `narration.mjs` | Generates the narration MP3s and a spoken handover WAV through the app's own `/api/voice/speak` (Sarvam `bulbul:v3`) |
| `record.mjs` | Uses Playwright to drive the UI through the full flow. It uploads the spoken handover, runs Sarvam STT, extracts, reviews, confirms, then shows the briefing, the agent and the log. It records the video, captions and a timeline |
| `benefits.mjs` | Adds the narrated "Why it matters" section before the closing card |
| `compose.mjs` | Fast-forwards the slow model waits, mixes the narration in at the cue times, and writes `out/ShiftSync-AI-demo.mp4` |

```bash
npm run dev                       # in the project root, with .env.local configured
cd demo
npm i --no-save playwright@1.55.0 ffmpeg-static@5.2.0
npx playwright install chromium
node narration.mjs && node record.mjs && node compose.mjs
```

> Running `record.mjs` **confirms a real handover** in your database, just as a user would. Run `npm run seed -- --reset` afterwards to restore the sample data.
