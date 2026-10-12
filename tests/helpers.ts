/**
 * Test helpers: fake configuration + a programmable global fetch mock that
 * intercepts BOTH Supabase (PostgREST) and Sarvam calls. No network access.
 */
process.env.SUPABASE_URL = "http://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.SARVAM_API_KEY = "test-sarvam-key";

export interface Call {
  url: string;
  method: string;
  body: unknown;
}

type Handler = (url: URL, init: RequestInit & { method: string }) => Response | Promise<Response>;

const realFetch = globalThis.fetch;
export const calls: Call[] = [];
let handler: Handler = () => json({ error: "no handler" }, 500);

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function mockFetch(h: Handler) {
  handler = h;
  calls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    let body: unknown = init.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        /* keep string */
      }
    }
    calls.push({ url: url.href, method, body });
    return handler(url, { ...init, method });
  }) as typeof fetch;
}

export function restoreFetch() {
  globalThis.fetch = realFetch;
}

/** Sarvam chat completion response wrapping a JSON object as message content. */
export function sarvamChat(content: unknown, finishReason = "stop") {
  return json({
    id: "chat-test",
    object: "chat.completion",
    model: "sarvam-105b",
    choices: [{ index: 0, finish_reason: finishReason, message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) } }],
  });
}

/** PostgREST row(s) for the incidents table from API-shaped incidents. */
export function incidentRow(i: import("../src/types/incident").Incident) {
  return {
    id: i.id,
    title: i.title,
    description: i.description,
    severity: i.severity,
    status: i.status,
    affected_service: i.affectedService,
    summary: i.summary,
    actions_completed: i.actionsCompleted,
    pending_actions: i.pendingActions,
    blockers: i.blockers,
    owner: i.owner,
    next_update_at: i.nextUpdateAt,
    created_at: i.createdAt,
    updated_at: i.updatedAt,
    update_history: i.updateHistory,
    is_sample_data: true,
  };
}
