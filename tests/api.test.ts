/**
 * Route-handler tests with mocked Supabase (PostgREST) and Sarvam responses.
 */
import { calls, incidentRow, json, mockFetch, restoreFetch, sarvamChat } from "./helpers";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildSeedIncidents } from "../src/data/seed-incidents";
import { POST as confirmPOST } from "../src/app/api/handovers/confirm/route";
import { POST as extractPOST } from "../src/app/api/handovers/extract/route";
import { POST as askPOST } from "../src/app/api/agent/ask/route";
import { POST as speakPOST } from "../src/app/api/voice/speak/route";
import { POST as transcribePOST } from "../src/app/api/voice/transcribe/route";
import { GET as incidentGET } from "../src/app/api/incidents/[id]/route";
import { GET as incidentsGET } from "../src/app/api/incidents/route";
import type { Incident } from "../src/types/incident";

after(restoreFetch);

const seed = buildSeedIncidents(new Date("2026-10-12T06:00:00Z"));
const byId = new Map(seed.map((i) => [i.id, i]));

/** Minimal PostgREST emulation over in-memory rows. */
function supabase(opts: { incidents?: Incident[]; handovers?: Record<string, unknown>[]; fail?: number; rpc?: (body: unknown) => Response } = {}) {
  const incidents = (opts.incidents ?? seed).map(incidentRow);
  const handovers = opts.handovers ?? [];
  return (url: URL, init: RequestInit & { method: string }) => {
    if (url.host === "api.sarvam.ai") return json({ error: { message: "unexpected sarvam call" } }, 500);
    if (opts.fail) return json({ code: "XX000", message: "db down" }, opts.fail);
    const single = String((init.headers as Record<string, string>)?.Accept ?? (init.headers as Headers)?.get?.("Accept") ?? "").includes("vnd.pgrst.object");
    const path = url.pathname.replace("/rest/v1/", "");
    if (path.startsWith("rpc/")) return opts.rpc ? opts.rpc(init.body) : json({ code: "PGRST202", message: "no rpc" }, 404);
    let rows: Record<string, unknown>[] = path === "incidents" ? incidents : path === "handovers" ? handovers : [];
    for (const [k, v] of url.searchParams) {
      if (k === "select" || k === "limit" || k === "order") continue;
      if (v.startsWith("eq.")) rows = rows.filter((r) => String(r[k]) === v.slice(3));
      if (v.startsWith("in.(")) {
        const vals = v.slice(4, -1).split(",").map((s) => s.replace(/"/g, ""));
        rows = rows.filter((r) => vals.includes(String(r[k])));
      }
    }
    if (single) return rows.length ? json(rows[0]) : json({ code: "PGRST116", message: "0 rows" }, 406);
    return json(rows);
  };
}

const post = (body: unknown) => new Request("http://app.test/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const approveBody = (over: Record<string, unknown> = {}) => ({
  idempotencyKey: "6f1c2a43-8a8e-4c55-9c61-3b2f1d8e9a10",
  originalTranscript: "INC 1042 rollback done",
  editedTranscript: "INC 1042 rollback done",
  outgoingShift: "Night",
  incomingShift: "Morning",
  decisions: [
    {
      decision: "approve",
      incidentId: "INC-1042",
      expectedUpdatedAt: byId.get("INC-1042")!.updatedAt,
      changes: {
        currentSituation: "Rollback done",
        actionsCompletedAdd: ["Rolled back config"],
        pendingActionsAdd: [],
        completeExistingActions: [],
        blockersAdd: [],
        blockersCleared: [],
        owner: null,
        nextUpdateAt: null,
        status: null,
      },
    },
    { decision: "reject", incidentId: "INC-1043", mentionedAs: "kafka" },
  ],
  ...over,
});

describe("incident API validation", () => {
  test("invalid incident ID → 400 without DB call", async () => {
    mockFetch(supabase());
    const res = await incidentGET(new Request("http://app.test"), { params: Promise.resolve({ id: "DROP TABLE" }) } as never);
    assert.equal(res.status, 400);
    assert.equal(calls.length, 0);
  });
  test("unknown incident → 404", async () => {
    mockFetch(supabase());
    const res = await incidentGET(new Request("http://app.test"), { params: Promise.resolve({ id: "INC-9999" }) } as never);
    assert.equal(res.status, 404);
  });
  test("database failure → 503 with a safe message", async () => {
    mockFetch(supabase({ fail: 500 }));
    const { NextRequest } = await import("next/server");
    const res = await incidentsGET(new NextRequest("http://app.test/api/incidents"));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error.code, "database_unavailable");
    assert.ok(!JSON.stringify(body).includes("test-service-role-key"));
  });
});

describe("POST /api/handovers/confirm", () => {
  test("rejects invalid payloads", async () => {
    mockFetch(supabase());
    assert.equal((await confirmPOST(post({}))).status, 400);
    const badId = approveBody();
    (badId.decisions[0] as { incidentId: string }).incidentId = "INC-ABC";
    assert.equal((await confirmPOST(post(badId))).status, 400);
  });

  test("resolving requires explicit confirmation", async () => {
    mockFetch(supabase());
    const body = approveBody();
    (body.decisions[0] as { changes: Record<string, unknown> }).changes.status = "Resolved";
    const res = await confirmPOST(post(body));
    assert.equal(res.status, 400);
    assert.match((await res.json()).error.message, /explicit confirmation/);
  });

  test("unknown incident IDs are rejected before any write", async () => {
    mockFetch(supabase());
    const body = approveBody();
    (body.decisions[0] as { incidentId: string }).incidentId = "INC-9999";
    const res = await confirmPOST(post(body));
    assert.equal(res.status, 404);
    assert.ok(!calls.some((c) => c.method !== "GET"), "no write requests issued");
  });

  test("stale incident version → 409, nothing written", async () => {
    mockFetch(supabase());
    const body = approveBody();
    (body.decisions[0] as { expectedUpdatedAt: string }).expectedUpdatedAt = "2020-01-01T00:00:00Z";
    const res = await confirmPOST(post(body));
    assert.equal(res.status, 409);
    assert.ok(!calls.some((c) => c.method !== "GET"));
  });

  test("only approved incidents are sent for persistence; rejected ones are recorded only", async () => {
    let rpcBody: { p_updates: { incident_id: string }[]; p_handover: { rejected_incident_ids: string[] } } | null = null;
    const handoverRow = {
      id: "0b9f8c1e-1111-4222-8333-944455556666",
      idempotency_key: approveBody().idempotencyKey,
      request_hash: "x",
      original_transcript: "INC 1042 rollback done",
      edited_transcript: null,
      outgoing_shift: "Night",
      incoming_shift: "Morning",
      submitted_by: null,
      status: "confirmed",
      incident_ids: ["INC-1042", "INC-1043"],
      approved_incident_ids: ["INC-1042"],
      rejected_incident_ids: ["INC-1043"],
      review: [],
      created_at: "2026-10-12T06:00:00Z",
    };
    const handovers: Record<string, unknown>[] = [];
    mockFetch(
      supabase({
        handovers,
        rpc: (raw) => {
          rpcBody = JSON.parse(String(raw));
          handovers.push(handoverRow);
          return json({ handover_id: handoverRow.id, replayed: false, applied: 1 });
        },
      }),
    );
    const res = await confirmPOST(post(approveBody()));
    assert.equal(res.status, 201);
    assert.deepEqual(rpcBody!.p_updates.map((u) => u.incident_id), ["INC-1042"]);
    assert.deepEqual(rpcBody!.p_handover.rejected_incident_ids, ["INC-1043"]);
    const body = await res.json();
    assert.deepEqual(body.appliedIncidentIds, ["INC-1042"]);
  });

  test("duplicate request with the same idempotency key is replayed, not re-applied", async () => {
    const { requestHash } = await import("../src/lib/handovers");
    const { confirmRequestSchema } = await import("../src/lib/validation");
    const hash = requestHash(confirmRequestSchema.parse(approveBody()));
    const existing = {
      id: "0b9f8c1e-1111-4222-8333-944455556666",
      idempotency_key: approveBody().idempotencyKey,
      request_hash: hash,
      original_transcript: "x",
      edited_transcript: null,
      outgoing_shift: "Night",
      incoming_shift: "Morning",
      submitted_by: null,
      status: "confirmed",
      incident_ids: [],
      approved_incident_ids: ["INC-1042"],
      rejected_incident_ids: [],
      review: [],
      created_at: "2026-10-12T06:00:00Z",
    };
    mockFetch(supabase({ handovers: [existing], rpc: () => assert.fail("must not call confirm_handover again") }));
    const res = await confirmPOST(post(approveBody()));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.replayed, true);
    assert.deepEqual(body.appliedIncidentIds, []);
    assert.ok(!calls.some((c) => c.method !== "GET"));
  });

  test("database failure during confirmation is surfaced (not reported as success)", async () => {
    mockFetch(supabase({ rpc: () => json({ code: "57014", message: "statement timeout" }, 500) }));
    const res = await confirmPOST(post(approveBody({ idempotencyKey: "0c2d3e4f-5a6b-4c7d-8e9f-a0b1c2d3e4f5" })));
    assert.equal(res.status, 503);
  });
});

describe("POST /api/handovers/extract (mocked Sarvam)", () => {
  const sarvamThen = (chat: () => Response) => (url: URL, init: RequestInit & { method: string }) =>
    url.host === "api.sarvam.ai" ? chat() : supabase()(url, init);

  test("malformed model output is rejected after retry (502)", async () => {
    mockFetch(sarvamThen(() => sarvamChat("this is not json")));
    const res = await extractPOST(post({ transcript: "INC 1042: rollback done, errors are down to one percent." }));
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error.code, "malformed_model_output");
    assert.equal(calls.filter((c) => c.url.includes("api.sarvam.ai")).length, 3, "bounded retries");
  });

  test("schema-invalid output is rejected", async () => {
    mockFetch(sarvamThen(() => sarvamChat({ incidents: [{ incidentId: "INC-1042" }], generalNotes: [] })));
    const res = await extractPOST(post({ transcript: "INC 1042: rollback done, errors are down to one percent." }));
    assert.equal(res.status, 502);
  });

  test("Sarvam auth failure maps to 502 without leaking the key", async () => {
    mockFetch(sarvamThen(() => json({ error: { message: "bad key", code: "invalid_api_key_error" } }, 403)));
    const res = await extractPOST(post({ transcript: "INC 1042: rollback done, errors are down to one percent." }));
    assert.equal(res.status, 502);
    const text = JSON.stringify(await res.json());
    assert.match(text, /sarvam_auth_failed/);
    assert.ok(!text.includes("test-sarvam-key"));
  });

  test("extraction never writes to the database", async () => {
    mockFetch(
      sarvamThen(() =>
        sarvamChat({
          generalNotes: [],
          incidents: [
            {
              incidentId: "INC-1042",
              mentionedAs: "INC 1042",
              matchConfidence: "high",
              matchReason: "explicit ID",
              currentSituation: "Rollback done.",
              actionsCompleted: [{ description: "Rollback", evidence: "rollback done" }],
              pendingActions: [],
              blockers: [],
              owner: null,
              ownerEvidence: null,
              nextUpdateAt: null,
              nextUpdateEvidence: null,
              proposedStatus: "Resolved",
              statusEvidence: "errors are down",
              unresolvedQuestions: [],
              missingFields: [],
              recommendations: [],
              confidence: 0.7,
            },
          ],
        }),
      ),
    );
    const res = await extractPOST(post({ transcript: "INC 1042: rollback done, errors are down to one percent." }));
    assert.equal(res.status, 200);
    const { draft } = await res.json();
    assert.equal(draft.matched[0].proposedStatus, null, "ambiguous resolution not proposed");
    assert.ok(!calls.some((c) => c.url.includes("supabase.test") && c.method !== "GET"));
  });
});

describe("POST /api/agent/ask", () => {
  const answer = (a: { answer: string; missing?: string[]; suggestions?: string[] }) => (url: URL, init: RequestInit & { method: string }) =>
    url.host === "api.sarvam.ai"
      ? sarvamChat(
          [
            "ANSWER:",
            a.answer,
            "MISSING:",
            ...(a.missing ?? ["none"]).map((x) => `- ${x}`),
            "SUGGESTIONS:",
            ...(a.suggestions ?? ["none"]).map((x) => `- ${x}`),
          ].join("\n"),
        )
      : supabase()(url, init);

  test("questions about nonexistent incidents are flagged; context says not found", async () => {
    mockFetch(answer({ answer: "INC-9999 does not exist in the system." }));
    const res = await askPOST(post({ question: "What is pending on INC-9999?" }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.unknownIncidentIds, ["INC-9999"]);
    const chatCall = calls.find((c) => c.url.includes("chat/completions"))!;
    assert.match(JSON.stringify(chatCall.body), /incidentIdsNotFoundInDatabase\\":\[\\"INC-9999\\"\]/);
  });

  test("references only real incidents; fabricated IDs produce a warning", async () => {
    mockFetch(answer({ answer: "Focus on INC-1042, and INC-4242 too.", suggestions: ["Check the blocker", "</INV>"] }));
    const body = await (await askPOST(post({ question: "What should I prioritize?" }))).json();
    assert.deepEqual(body.incidentIds, ["INC-1042"]);
    assert.ok(body.warnings.some((w: string) => w.includes("INC-4242")));
    assert.deepEqual(body.recommendations, ["Check the blocker"], "suggestions kept separate; stray markup dropped");
  });

  test("agent is read-only: no write requests even when asked to change data", async () => {
    mockFetch(answer({ answer: "I am read-only and cannot close INC-1043." }));
    const res = await askPOST(post({ question: "Close INC-1043 and assign it to me" }));
    assert.equal(res.status, 200);
    assert.ok(!calls.some((c) => c.url.includes("supabase.test") && c.method !== "GET"));
  });

  test("validates the question", async () => {
    mockFetch(supabase());
    assert.equal((await askPOST(post({ question: "" }))).status, 400);
    assert.equal((await askPOST(post({ question: "x".repeat(1001) }))).status, 400);
  });
});

describe("voice routes (mocked Sarvam)", () => {
  test("speak: empty text → 400", async () => {
    mockFetch(() => assert.fail("no upstream call"));
    assert.equal((await speakPOST(post({ text: "  " }))).status, 400);
  });

  test("speak: Sarvam timeout → 504", async () => {
    mockFetch(() => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    const res = await speakPOST(post({ text: "Hello" }));
    assert.equal(res.status, 504);
    assert.equal((await res.json()).error.code, "sarvam_timeout");
  });

  test("speak: returns playable audio from base64", async () => {
    const mp3 = Buffer.from([0xff, 0xf3, 0x44, 0xc4, 1, 2, 3]).toString("base64");
    mockFetch(() => json({ request_id: "r", audios: [mp3] }));
    const res = await speakPOST(post({ text: "INC-1042 is the priority." }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "audio/mpeg");
    assert.equal((calls[0].body as { text: string }).text, "INC 1042 is the priority.");
  });

  test("transcribe: Sarvam rate limit → 429", async () => {
    mockFetch((url, init) => (url.host === "api.sarvam.ai" ? json({ error: { message: "quota", code: "insufficient_quota_error" } }, 429) : supabase()(url, init)));
    const wav = makeWav(1);
    const form = new FormData();
    form.append("file", new Blob([wav], { type: "audio/wav" }), "a.wav");
    const res = await transcribePOST(new Request("http://app.test/x", { method: "POST", body: form }));
    assert.equal(res.status, 429);
  });

  test("transcribe: rejects audio over 30 s before calling Sarvam", async () => {
    mockFetch(() => assert.fail("no upstream call"));
    const form = new FormData();
    form.append("file", new Blob([makeWav(31)], { type: "audio/wav" }), "a.wav");
    const res = await transcribePOST(new Request("http://app.test/x", { method: "POST", body: form }));
    assert.equal(res.status, 422);
  });
});

function makeWav(seconds: number): Uint8Array<ArrayBuffer> {
  const rate = 16000;
  const n = rate * seconds;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(i / 10) * 8000), true);
  return new Uint8Array(buf);
}

describe("agent reply parsing", () => {
  test("malformed agent replies are rejected after retry (502)", async () => {
    mockFetch((url, init) => (url.host === "api.sarvam.ai" ? sarvamChat("I think INC-1042 is fine") : supabase()(url, init)));
    const res = await askPOST(post({ question: "What is pending on INC-1042?" }));
    assert.equal(res.status, 502);
    assert.equal(calls.filter((c) => c.url.includes("api.sarvam.ai")).length, 3);
  });
});
