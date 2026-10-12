import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeIncidentChanges } from "../src/lib/handovers";
import { buildSeedIncidents } from "../src/data/seed-incidents";
import type { IncidentChanges } from "../src/lib/validation";

const now = new Date("2026-10-12T06:00:00Z");
const inc = () => buildSeedIncidents(now).find((i) => i.id === "INC-1042")!;

const noChanges: IncidentChanges = {
  currentSituation: null,
  actionsCompletedAdd: [],
  pendingActionsAdd: [],
  completeExistingActions: [],
  blockersAdd: [],
  blockersCleared: [],
  owner: null,
  nextUpdateAt: null,
  status: null,
  resolutionConfirmed: false,
};

test("empty approval changes nothing (omitted values are never erased)", () => {
  const r = mergeIncidentChanges(inc(), noChanges);
  assert.deepEqual(r.changedFields, []);
  assert.equal(r.next.owner, "Asha Rao");
  assert.equal(r.next.blockers.length, 1);
  assert.equal(r.next.summary, inc().summary);
});

test("additions are appended and de-duplicated", () => {
  const r = mergeIncidentChanges(inc(), {
    ...noChanges,
    actionsCompletedAdd: ["Rolled back gateway config", "paged payments on-call and opened bridge call"],
    pendingActionsAdd: [{ description: "Confirm error rate below 0.5%", owner: null, dueAt: null }],
  });
  assert.equal(r.next.actions_completed.length, 3, "duplicate (case-insensitive) completed action not re-added");
  assert.equal(r.next.pending_actions.at(-1)?.description, "Confirm error rate below 0.5%");
  assert.deepEqual(r.changedFields.sort(), ["actionsCompleted", "pendingActions"]);
});

test("existing pending action is completed only when explicitly ticked", () => {
  const r = mergeIncidentChanges(inc(), { ...noChanges, completeExistingActions: ["Roll back 18:40 UTC gateway config push"] });
  const rollback = r.next.pending_actions.find((a) => a.description.startsWith("Roll back"));
  assert.equal(rollback?.status, "completed");
  assert.ok(r.next.actions_completed.includes("Roll back 18:40 UTC gateway config push"));
  assert.equal(r.next.pending_actions.find((a) => a.description.startsWith("Engage"))?.status, "pending");
});

test("blockers are removed only when explicitly cleared", () => {
  const r = mergeIncidentChanges(inc(), { ...noChanges, blockersAdd: ["Waiting on vendor"] });
  assert.equal(r.next.blockers.length, 2);
  const cleared = mergeIncidentChanges(inc(), { ...noChanges, blockersCleared: [inc().blockers[0]] });
  assert.equal(cleared.next.blockers.length, 0);
  assert.deepEqual(cleared.previousValues.blockers, inc().blockers);
});

test("status/owner/next update change only when provided; audit captures before/after", () => {
  const r = mergeIncidentChanges(inc(), { ...noChanges, status: "Monitoring", owner: "Mei Lin", nextUpdateAt: "2026-10-12T07:00:00Z" });
  assert.equal(r.next.status, "Monitoring");
  assert.equal(r.previousValues.status, "Investigating");
  assert.equal(r.newValues.owner, "Mei Lin");
  assert.equal(r.next.next_update_at, "2026-10-12T07:00:00.000Z");
  assert.match(r.historyNote, /Investigating → Monitoring/);
});
