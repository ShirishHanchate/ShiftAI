# ShiftSync AI: Technical Design Document

| | |
| --- | --- |
| **Project** | ShiftSync AI. Voice-first shift handover for 24×7 IT operations |
| **Hackathon track** | ShiftAI |
| **Repository** | https://github.com/ShirishHanchate/ShiftAI |
| **Live demo** | https://shift-ai-rouge.vercel.app/ (no login needed) |
| **Demo video** | _see README → "For judges"_ |
| **Stack** | Next.js 16 (App Router) · TypeScript · Tailwind v4 · shadcn/ui · Zod 4 · Supabase Postgres · Sarvam AI (STT `saaras:v4`, LLM `sarvam-105b`, TTS `bulbul:v3`) |

---

## 1. Project overview

### 1.1 Problem

In 24×7 IT operations (NOC, SRE, support desks), live incidents change hands at every shift change. Today that handover is a rushed call, a chat message or a half-filled spreadsheet, which causes four problems:

- **Context is lost.** Who rolled back what, which approval is pending, and who owns the next update.
- **Records go stale.** The ticketing system is not updated because typing up the handover takes too long.
- **Nobody is accountable.** No one can later say what was handed over, by whom, or what changed.
- **Shifts start blind.** The incoming engineer has to piece the situation together from tickets, email and chat.

### 1.2 Solution

ShiftSync lets the outgoing engineer **speak** the handover. The system turns that speech into **structured, evidence-backed incident updates**, and a human **reviews and confirms** them before anything is saved. Confirmed changes are written **atomically with a full audit trail**. The incoming engineer receives a **prioritised briefing** and can **ask questions by voice**.

| Capability | AI used | Design principle |
| --- | --- | --- |
| Voice handover capture (English plus 8 Indian languages, or auto-detect) | Sarvam `saaras:v4` STT | Browser-side chunking into ≤25 s 16 kHz WAV segments |
| Structured extraction (per-incident status, actions, owners, blockers, deadlines) | Sarvam `sarvam-105b` | **Every fact needs a verifiable transcript quote.** The model proposes and the human decides |
| Human review and atomic confirm | – | Single Postgres transaction, idempotent, with optimistic concurrency and audit |
| Incoming-shift briefing | Deterministic ranking (no LLM) | Explainable priority rules |
| Auto Handover (no handover recorded?) | `sarvam-105b` over tickets, history, email and chat | Read-only and grounded. Unknown IDs are dropped |
| Ask ShiftSync (voice copilot) | STT → `sarvam-105b` → `bulbul:v3` TTS | Read-only by construction. Cites incident IDs |

### 1.3 What makes it different

1. **An anti-hallucination safety layer.** The LLM output is not trusted. The server checks every quote against the transcript, every incident ID against the database, and every person against the transcript or roster. It never lets "resolved" through silently.
2. **Human-in-the-loop with real transactional guarantees.** AI drafts, a person approves, and Postgres enforces the result through row locks, version checks, idempotency and audit.
3. **Voice end to end, in Indian languages**, using one sovereign AI provider (Sarvam) for STT, the LLM and TTS.
4. **It works even when nobody hands over.** Auto Handover reconstructs the shift from tickets and communications.

---

## 2. System architecture

### 2.1 Component diagram

```mermaid
flowchart LR
  subgraph Browser["Browser (React 19 client components)"]
    REC["MediaRecorder / file upload"] --> SEG["audio.ts: decode → mono 16 kHz → ≤25 s WAV segments"]
    UI["Pages: Incidents · Voice Handover · Incoming Shift · Ask ShiftSync · Handover Log"]
  end

  subgraph Server["Next.js route handlers (Node runtime, server-only secrets)"]
    T["/api/voice/transcribe"]
    X["/api/handovers/extract"]
    C["/api/handovers/confirm"]
    B["/api/briefings/current"]
    A["/api/handovers/auto"]
    Q["/api/agent/ask"]
    S["/api/voice/speak"]
    SAFE["extraction.ts safety layer"]
    PRIO["briefing.ts deterministic prioritiser"]
    LLM["llm.ts: chatJson() Zod-validated, bounded retries"]
  end

  subgraph Sarvam["Sarvam AI"]
    STT["saaras:v4 STT"]
    CHAT["sarvam-105b"]
    TTS["bulbul:v3 TTS"]
  end

  subgraph DB["Supabase Postgres (RLS on, no public policies)"]
    I[(incidents)]
    H[(handovers)]
    AU[(incident_audit_log)]
    CM[(incident_communications)]
    RPC["confirm_handover() plpgsql"]
  end

  SEG --> T --> STT
  UI --> X & C & B & A & Q & S
  X --> LLM --> CHAT
  X --> SAFE
  A --> LLM
  Q --> LLM
  S --> TTS
  C --> RPC --> I & H & AU
  B --> PRIO
  B & A & Q & X --> I
  A & Q --> CM
```

### 2.2 Main flow: voice handover → confirmed update

```mermaid
sequenceDiagram
  autonumber
  actor Out as Outgoing engineer
  participant UI as Browser
  participant API as Next.js API
  participant SV as Sarvam
  participant PG as Supabase Postgres

  Out->>UI: Speak / upload handover
  UI->>UI: Decode, resample 16 kHz, split ≤25 s WAV
  loop each segment
    UI->>API: POST /api/voice/transcribe
    API->>SV: saaras:v4
    SV-->>API: text
    API-->>UI: transcript segment
  end
  Out->>UI: Edit transcript, click Generate
  UI->>API: POST /api/handovers/extract
  API->>PG: read active incidents (candidates)
  API->>SV: sarvam-105b (schema in prompt)
  SV-->>API: JSON draft
  API->>API: Zod validate → safety layer (IDs, quotes, owners, resolution)
  API-->>UI: matched / unmatched / flagged draft (nothing written)
  Out->>UI: Approve / reject / edit per incident
  UI->>API: POST /api/handovers/confirm (idempotencyKey, decisions, expectedUpdatedAt)
  API->>API: merge (add-only), request hash
  API->>PG: rpc confirm_handover(p_handover, p_updates)
  Note over PG: ONE transaction: idempotency check → SELECT … FOR UPDATE →<br/>updated_at version check → apply + history → audit rows
  PG-->>API: handover id (201) / replay (200) / 409 / 404
  API-->>UI: Result + link to handover record
```

### 2.3 Extraction safety pipeline

```mermaid
flowchart TD
  M[Raw model text] --> P{Parse JSON?}
  P -- no --> R1[Retry with different reasoning / temperature] --> P2{Parse + Zod OK?}
  P2 -- no --> E502[502: malformed output rejected]
  P -- yes --> Z{Zod schema valid?}
  Z -- no --> R1
  Z -- yes --> ID{Incident ID exists<br/>and confidence high?}
  ID -- no --> UN[Move to Unmatched: reviewer assigns or discards]
  ID -- yes --> Q{Evidence quote found<br/>in transcript? ≥80% token match}
  Q -- no --> FL[Flag as unverified, do not pre-fill]
  Q -- yes --> OW{Owner named in that<br/>action's own quote / roster?}
  OW -- no --> STRIP[Strip owner and warn reviewer]
  OW -- yes --> RS{Status = Resolved?}
  RS -- yes --> EXP{Explicit high-confidence<br/>statement?}
  EXP -- no --> KEEP[Keep current status, add warning]
  EXP -- yes --> TICK[Requires separate 'I confirm resolved' tick]
  RS -- no --> OK[Pre-filled proposal]
```

### 2.4 Incoming-shift flow

```mermaid
flowchart LR
  open[Open /briefing] --> AH[POST /api/handovers/auto]
  AH --> D1[(incidents + audit + recent handovers + communications in window)]
  D1 --> L[sarvam-105b summary + top-3 priorities]
  L --> G[Ground: drop unknown IDs, keep sources]
  open --> BR[GET /api/briefings/current]
  BR --> D2[(incidents + confirmed handovers)]
  D2 --> PR["Deterministic ranking:<br/>severity → overdue → blockers → nearest deadline → recency"]
  G & PR --> V[Briefing UI + Listen TTS + Ask follow-ups]
```

### 2.5 Data model

```mermaid
erDiagram
  incidents ||--o{ incident_audit_log : "changes"
  handovers ||--o{ incident_audit_log : "produced"
  incidents ||--o{ incident_communications : "has"
  incidents {
    text id PK "INC-####"
    text title
    text severity "SEV1..SEV4"
    text status
    text owner
    jsonb pending_actions "description, owner, dueAt, status"
    text[] actions_completed
    text[] blockers
    timestamptz next_update_at
    jsonb update_history
    timestamptz updated_at "optimistic version"
  }
  handovers {
    uuid id PK
    text idempotency_key UK
    text request_hash
    text original_transcript
    text edited_transcript
    jsonb review "per-incident decisions"
  }
  incident_audit_log {
    bigint id PK
    text incident_id FK
    uuid handover_id FK
    text[] changed_fields
    jsonb previous_values
    jsonb new_values
  }
  incident_communications {
    bigint id PK
    text incident_id FK
    text channel "email / chat / ticket_comment"
    text author
    text body
  }
```

All four tables have **Row Level Security enabled with no policies**. Only the server's secret key can read or write them, and the browser never talks to Supabase directly.

---

## 3. Setup and deployment

### 3.1 Prerequisites
- Node.js ≥ 20, npm
- A Supabase project (free tier is fine)
- A Sarvam AI API key (https://dashboard.sarvam.ai)

### 3.2 Local setup

```bash
git clone https://github.com/ShirishHanchate/ShiftAI.git
cd ShiftAI
npm install
cp .env.example .env.local        # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SARVAM_API_KEY
```

1. **Create the schema.** Paste `supabase/setup.sql` into the Supabase **SQL Editor** and run it. Alternatively, set `SUPABASE_DB_URL` and run `npm run db:migrate`.
2. **Seed fictional data:** `npm run seed`. It is idempotent, and `npm run seed -- --reset` restores the original data.
3. **Run:** `npm run dev`, then open http://localhost:3000. The microphone requires localhost or HTTPS.
4. **Health check:** `GET /api/health` returns configuration and database status as booleans only.

### 3.3 Deploy to Vercel

1. Import the GitHub repository in Vercel (framework: Next.js, no build overrides needed).
2. Add **Environment Variables** for Production and Preview: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SARVAM_API_KEY`. They stay server-side, and none use the `NEXT_PUBLIC_` prefix.
3. Deploy. The schema and seed are run once from a local machine as in §3.2.
4. Verify with `https://<your-app>.vercel.app/api/health`, which should report `"status":"ok"`.

CLI alternative:
```bash
vercel link
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add SARVAM_API_KEY production
vercel --prod
```

### 3.4 Quality commands

```bash
npm test               # 42 unit/integration tests, no network
npm run test:coverage  # same with coverage report
npm run check:safety   # extraction safety rules on adversarial model output
npm run typecheck && npm run lint && npm run build
npm run e2e            # LIVE end-to-end against a running app (real Supabase + Sarvam)
```

---

## 4. Code walkthrough

```
src/
  app/                      Next.js App Router
    page.tsx                Incidents dashboard
    handover/               Voice Handover (record → transcribe → extract → review → confirm)
    briefing/               Incoming Shift (Auto Handover + priority briefing)
    assistant/              Ask ShiftSync (voice copilot)
    handovers/              Handover log + detail (original vs edited transcript, decisions)
    incidents/[id]/         Incident detail + audit trail
    api/                    Route handlers (thin: validate → call lib → map errors)
  lib/                      All business logic (server-only unless noted)
  components/               UI (shadcn/ui + Base UI)
  types/                    Shared TypeScript domain types
supabase/                   SQL migrations + one-shot setup.sql
scripts/                    seed, migrate, live checks, e2e
tests/                      Node test runner suites (mocked Sarvam/Supabase + embedded Postgres)
demo/                       Reproducible demo-video generator (Playwright + ffmpeg)
```

| Module | Responsibility |
| --- | --- |
| `lib/sarvam.ts` | Thin REST client for STT, chat and TTS. Uses timeouts and maps Sarvam errors (401/403, 429, 5xx, timeout) to typed `ApiError`s. Never logs keys or audio |
| `lib/llm.ts` | `chatJson()` takes a Zod schema and a list of attempts. It extracts the outermost JSON object, validates it, and retries with different reasoning or temperature settings. Malformed output is never returned. Supports `text` mode (schema in the prompt) and strict `json_schema` mode |
| `lib/extraction.ts` | Builds the extraction prompt from the transcript and candidate incidents, then runs the **safety post-processing**: ID verification, evidence quote matching (normalised exact match or ≥80% token coverage), owner support (full name in the transcript, or the first name of a known roster person), bounded due dates, and the resolution guard. It returns a `HandoverDraft` and writes nothing |
| `lib/handovers.ts` | `mergeIncidentChanges()` is a pure, **add-only** merge. Omitted values are never erased, blockers or actions are removed only by explicit choice, and it produces an audit diff. `requestHash()` and `confirmHandover()` call the `confirm_handover` RPC and map SQL error codes (`SS409`, `SS404`, `SS412`) to HTTP status codes |
| `supabase/migrations/0002_*.sql` | `confirm_handover(p_handover, p_updates)` runs in **one plpgsql transaction**: idempotency lookup (same key and same hash → replay, different hash → 409), `SELECT … FOR UPDATE` per incident, an `updated_at` version check, then writing the update and history and inserting audit rows. Any exception rolls back everything |
| `lib/briefing.ts` | A pure, deterministic prioritiser (`comparePriority`, `compareActions`, `isOverdue`). Unknown deadlines are never treated as overdue. AI recommendations come from the latest approving handover and are shown separately |
| `lib/auto-handover.ts` | Builds a compact payload from incidents, audit, handovers and communications within a time window. The LLM summarises it, and `groundAutoHandover()` drops any incident IDs that don't exist |
| `lib/agent.ts` | The read-only copilot. `extractIncidentIds()` normalises "inc 1042" and similar forms. Context retrieval follows up on the previous turn's incidents, and the model replies in a sectioned plain-text format parsed by `parseAgentReply()`, which is Zod-validated. `finalizeAnswer()` flags fabricated IDs. The module imports **query functions only** |
| `lib/audio.ts` (client) | Decodes any recorded or uploaded format, downmixes to mono, resamples to 16 kHz, splits into ≤25 s segments, encodes WAV, and detects silence |
| `lib/audio-upload.ts` | Server-side upload validation: size, magic bytes, WAV duration (≤30 s) and language whitelist |
| `lib/validation.ts` | Zod schemas for every API body and query |
| `lib/api.ts` | A uniform error envelope `{ error: { code, message, details? } }`. Unknown errors become safe 500s |
| `lib/env.ts` | Lazy required-env access with `ConfigError`, and `configStatus()` booleans for `/api/health` |

### 4.1 Testing strategy

There are **42 automated tests** using the Node built-in test runner and `tsx`, and they need **no network**:

- **`tests/api.test.ts`** runs route handlers end to end, with `fetch` mocked at the Supabase (PostgREST) and Sarvam boundaries. It covers validation (400), unknown incidents (404), DB failure (503), stale versions (409), idempotent replay, extraction never writing, read-only agent enforcement, Sarvam 403/429/timeout mapping, and audio over 30 s.
- **`tests/confirm-db.test.ts`** runs the **real migration SQL and `confirm_handover()`** inside embedded Postgres (PGlite). It covers atomic rollback on stale or unknown incidents, replay, and key reuse with a different body.
- **`tests/extraction-safety.test.ts`** feeds adversarial model output (fabricated quotes, invented IDs and owners, ambiguous "resolved") through the safety layer.
- **`tests/merge.test.ts`** checks add-only merge semantics and the audit diff.
- **`tests/briefing.test.ts`** checks priority ordering, overdue logic and recommendation separation.

Coverage (`npm run test:coverage`) is **≈93% lines, ≈82% branches, ≈89% functions** across the modules exercised. Live verification scripts (`npm run e2e`, `live:*`) exercise the real Supabase and Sarvam services.

---

## 5. Assumptions and limitations

**Assumptions**
- Single-tenant demo for one operations team. Access control is out of scope for the hackathon, and all data access is server-side with the secret key.
- Incident data, people, emails and chat are **fictional seed data** (`src/data/*`). A production version would connect to the team's ticketing system (for example Jira or ServiceNow) and mail or chat.
- A handover mentions incidents by ID ("INC 1042") or a recognisable description. Anything the model cannot match confidently goes to *Unmatched* for the reviewer.
- The human reviewer is the source of truth. The AI only proposes.
- Times are stored and shown in UTC.

**Limitations and future work**
- No authentication or roles yet. The next step would be Supabase Auth or SSO, with per-team RLS policies.
- STT uses Sarvam's synchronous API with browser-side chunking, not real-time streaming.
- Extraction takes about 25–35 s because `sarvam-105b` is a reasoning model. A future version could stream partial drafts.
- Communications come from a seeded table, not a live mailbox or Slack.

---

## 6. Security and privacy

- Secrets exist only in server environment variables. There are no `NEXT_PUBLIC_` variables, and `.env*` files are git-ignored. `.env.example` contains placeholders only.
- Supabase RLS is enabled on every table with no public policies.
- Raw audio and API keys are never logged. `/api/health` returns booleans, not values.
- All inputs are Zod-validated. Uploads are checked for size, type, magic bytes and duration.
- LLM output is treated as untrusted input: it is validated, grounded and human-confirmed before any write.
