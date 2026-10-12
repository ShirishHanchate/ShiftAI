/**
 * Runs the real Supabase migrations in an embedded Postgres (PGlite) and exercises
 * confirm_handover(): atomicity, idempotency, concurrency and rejection behaviour.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

let db: PGlite;
const T0 = "2026-10-12T05:00:00.123Z";

before(async () => {
  db = new PGlite();
  for (const f of ["0001_incidents.sql", "0002_handovers_audit.sql"]) {
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  }
  await db.exec(`
    insert into incidents (id, title, severity, status, affected_service, owner, blockers, updated_at) values
      ('INC-1042', 'Payments', 'SEV1', 'Investigating', 'payments', 'Asha Rao', '["approval"]', '${T0}'),
      ('INC-1043', 'Kafka lag', 'SEV2', 'Monitoring', 'kafka', 'Mei Lin', '[]', '${T0}');
  `);
});

const handover = (key: string, hash = "h") => ({
  idempotency_key: key,
  request_hash: hash,
  original_transcript: "orig",
  edited_transcript: "edited",
  outgoing_shift: "Night",
  incoming_shift: "Morning",
  submitted_by: "Tester",
  status: "confirmed",
  incident_ids: ["INC-1042", "INC-1043"],
  approved_incident_ids: ["INC-1042"],
  rejected_incident_ids: ["INC-1043"],
  review: [],
});

const update = (id: string, expected: string, status = "Monitoring") => ({
  incident_id: id,
  expected_updated_at: expected,
  changed_fields: ["status"],
  previous_values: { status: "Investigating" },
  new_values: { status },
  next: {
    status,
    summary: "Rollback done",
    owner: "Asha Rao",
    next_update_at: null,
    actions_completed: ["Rolled back config"],
    pending_actions: [],
    blockers: ["approval"],
    history_entry: { author: "Tester", source: "handover", note: "Status Investigating → Monitoring" },
  },
});

const confirm = (h: object, u: object[]) =>
  db.query<{ r: { handover_id: string; replayed: boolean; applied: number } }>("select confirm_handover($1, $2) as r", [h, u]);
const row = async (id: string) =>
  (await db.query<{ status: string; updated_at: Date; n: number }>("select status, updated_at, jsonb_array_length(update_history) n from incidents where id = $1", [id])).rows[0];
const count = async (table: string) => Number((await db.query<{ c: number }>(`select count(*)::int c from ${table}`)).rows[0].c);

test("approved update is applied with audit + history; rejected incident untouched", async () => {
  const res = await confirm(handover("k1"), [update("INC-1042", T0)]);
  assert.equal(res.rows[0].r.applied, 1);
  assert.equal(res.rows[0].r.replayed, false);
  assert.equal((await row("INC-1042")).status, "Monitoring");
  assert.equal((await row("INC-1042")).n, 1);
  const rejected = await row("INC-1043");
  assert.equal(rejected.status, "Monitoring");
  assert.equal(rejected.n, 0, "rejected incident gets no history entry");
  assert.equal(new Date(rejected.updated_at).toISOString(), T0, "rejected incident not modified");
  const audit = await db.query<{ incident_id: string; changed_fields: string[] }>("select incident_id, changed_fields from incident_audit_log");
  assert.deepEqual(audit.rows, [{ incident_id: "INC-1042", changed_fields: ["status"] }]);
  const h = await db.query<{ original_transcript: string; edited_transcript: string }>("select original_transcript, edited_transcript from handovers");
  assert.equal(h.rows[0].original_transcript, "orig", "original transcript preserved");
});

test("duplicate submission (same key) replays without applying twice", async () => {
  const before = await count("incident_audit_log");
  const res = await confirm(handover("k1"), [update("INC-1042", T0)]);
  assert.equal(res.rows[0].r.replayed, true);
  assert.equal(res.rows[0].r.applied, 0);
  assert.equal(await count("incident_audit_log"), before);
  assert.equal(await count("handovers"), 1);
  assert.equal((await row("INC-1042")).n, 1, "no duplicate history entry");
});

test("same key with a different body is rejected", async () => {
  await assert.rejects(confirm(handover("k1", "different"), []), (e: { code?: string }) => e.code === "SS409");
});

test("stale incident version rolls back the whole handover", async () => {
  const handoversBefore = await count("handovers");
  // INC-1043 is valid, INC-1042's expected version is stale (it changed in the first test).
  await assert.rejects(
    confirm(handover("k2"), [update("INC-1043", T0, "Resolved"), update("INC-1042", T0)]),
    (e: { code?: string }) => e.code === "SS412",
  );
  assert.equal(await count("handovers"), handoversBefore, "no handover row persisted");
  assert.equal((await row("INC-1043")).status, "Monitoring", "earlier update in the same request was rolled back");
});

test("unknown incident rolls back everything", async () => {
  const before = await count("handovers");
  await assert.rejects(confirm(handover("k3"), [update("INC-9999", T0)]), (e: { code?: string }) => e.code === "SS404");
  assert.equal(await count("handovers"), before);
});

test("handover with only rejections is stored without touching incidents", async () => {
  const auditBefore = await count("incident_audit_log");
  const res = await confirm({ ...handover("k4"), status: "no_changes", approved_incident_ids: [] }, []);
  assert.equal(res.rows[0].r.applied, 0);
  assert.equal(await count("incident_audit_log"), auditBefore);
});

test("schema rejects invalid incident IDs and statuses", async () => {
  await assert.rejects(db.exec(`insert into incidents (id,title,severity,status,affected_service) values ('BAD-1','t','SEV1','Open','s')`));
  await assert.rejects(db.exec(`insert into incidents (id,title,severity,status,affected_service) values ('INC-7777','t','SEV1','Closed','s')`));
});
