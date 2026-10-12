import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBriefing, isOverdue } from "../src/lib/briefing";
import { buildSeedIncidents } from "../src/data/seed-incidents";
import type { Incident } from "../src/types/incident";
import type { HandoverRecord } from "../src/types/handover";

const NOW = Date.parse("2026-10-12T06:00:00Z");
const base = (over: Partial<Incident>): Incident => ({
  id: "INC-2000",
  title: "t",
  description: "",
  severity: "SEV3",
  status: "Investigating",
  affectedService: "svc",
  summary: "",
  actionsCompleted: [],
  pendingActions: [],
  blockers: [],
  owner: "Someone",
  nextUpdateAt: null,
  createdAt: "2026-10-12T00:00:00.000Z",
  updatedAt: "2026-10-12T01:00:00.000Z",
  updateHistory: [],
  ...over,
});

test("unknown deadlines are never overdue", () => {
  assert.equal(isOverdue(null, NOW), false);
  assert.equal(isOverdue("not a date", NOW), false);
  assert.equal(isOverdue("2026-10-12T05:59:00Z", NOW), true);
  assert.equal(isOverdue("2026-10-12T06:01:00Z", NOW), false);

  const b = buildBriefing([base({ id: "INC-2001", pendingActions: [{ description: "x", owner: null, dueAt: null, status: "pending" }] })], [], NOW);
  assert.equal(b.stats.overdueActions, 0);
  assert.equal(b.stats.overdueFollowUps, 0);
  assert.equal(b.incidents[0].pendingActions[0].overdue, false);
  assert.ok(b.incidents[0].missingInformation.some((m) => /without a due time/.test(m)));
});

test("priority: severity, then overdue, then blockers, then nearest deadline, then recency", () => {
  const incidents = [
    base({ id: "INC-3001", severity: "SEV2", updatedAt: "2026-10-12T05:00:00.000Z" }),
    base({ id: "INC-3002", severity: "SEV2", blockers: ["waiting on DBA"] }),
    base({ id: "INC-3003", severity: "SEV2", nextUpdateAt: "2026-10-12T05:30:00.000Z" }), // overdue follow-up
    base({ id: "INC-3004", severity: "SEV1" }),
    base({ id: "INC-3005", severity: "SEV2", pendingActions: [{ description: "a", owner: null, dueAt: "2026-10-12T07:00:00.000Z", status: "pending" }] }),
    base({ id: "INC-3006", severity: "SEV2", updatedAt: "2026-10-12T02:00:00.000Z" }),
    base({ id: "INC-3007", severity: "SEV1", status: "Resolved" }),
  ];
  const order = buildBriefing(incidents, [], NOW).incidents.map((i) => i.id);
  assert.deepEqual(order, ["INC-3004", "INC-3003", "INC-3002", "INC-3005", "INC-3001", "INC-3006"]);
});

test("resolved incidents are excluded from the active list", () => {
  const b = buildBriefing(buildSeedIncidents(new Date(NOW)), [], NOW);
  assert.ok(!b.incidents.some((i) => i.status === "Resolved"));
  assert.equal(b.stats.active, 7);
});

test("next action = overdue first, then earliest due; gaps are flagged", () => {
  const b = buildBriefing(
    [
      base({
        id: "INC-4001",
        owner: null,
        pendingActions: [
          { description: "later", owner: "A", dueAt: "2026-10-12T09:00:00.000Z", status: "pending" },
          { description: "late", owner: "B", dueAt: "2026-10-12T05:00:00.000Z", status: "pending" },
          { description: "done", owner: "C", dueAt: "2026-10-12T04:00:00.000Z", status: "completed" },
        ],
      }),
      base({ id: "INC-4002" }),
    ],
    [],
    NOW,
  );
  const a = b.incidents.find((i) => i.id === "INC-4001")!;
  assert.equal(a.nextAction?.description, "late");
  assert.equal(a.nextAction?.overdue, true);
  assert.equal(a.pendingActions.length, 2, "completed actions are not pending");
  assert.deepEqual(b.withoutOwner, ["INC-4001"]);
  assert.deepEqual(b.withoutNextAction, ["INC-4002"]);
});

test("AI recommendations come from the latest approving handover and are kept separate", () => {
  const h = (id: string, createdAt: string, recs: string[]): HandoverRecord => ({
    id,
    createdAt,
    outgoingShift: "n",
    incomingShift: "d",
    submittedBy: null,
    status: "confirmed",
    incidentIds: ["INC-5001"],
    approvedIncidentIds: ["INC-5001"],
    rejectedIncidentIds: [],
    originalTranscript: "x",
    editedTranscript: null,
    review: [{ incidentId: "INC-5001", decision: "approve", recommendations: recs }],
  });
  const b = buildBriefing([base({ id: "INC-5001" })], [h("old", "2026-10-11T00:00:00Z", ["old"]), h("new", "2026-10-12T00:00:00Z", ["new"])], NOW);
  assert.deepEqual(b.incidents[0].aiRecommendations, ["new"]);
  assert.equal(b.latestHandover?.id, "new");
});
