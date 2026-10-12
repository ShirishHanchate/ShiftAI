/**
 * Offline checks for the extraction safety layer (no network, no credentials).
 * Feeds deliberately unsafe model output through buildDraft() and asserts that
 * the server-side rules catch it.
 *
 *   npm run check:safety
 */
import assert from "node:assert/strict";
import { buildDraft } from "../src/lib/extraction";
import { llmExtractionSchema, type LlmIncidentUpdate } from "../src/lib/validation";
import { buildSeedIncidents } from "../src/data/seed-incidents";

const now = new Date("2026-10-12T06:00:00Z");
const candidates = buildSeedIncidents(now);

const transcript =
  "INC 1042 payments: Asha Rao rolled back the gateway config and errors dropped to one percent. " +
  "We still need to engage the card processor. Asha will give the next update in thirty minutes. " +
  "The CDN certificate one looks better, maybe it is fine now. " +
  "Something odd with the billing exports too, not sure which ticket.";

const base: LlmIncidentUpdate = {
  incidentId: null,
  mentionedAs: "",
  matchConfidence: "high",
  matchReason: "",
  currentSituation: "",
  actionsCompleted: [],
  pendingActions: [],
  blockers: [],
  owner: null,
  ownerEvidence: null,
  nextUpdateAt: null,
  nextUpdateEvidence: null,
  proposedStatus: null,
  statusEvidence: null,
  unresolvedQuestions: [],
  missingFields: [],
  recommendations: [],
  confidence: 0.9,
};

const modelOutput = llmExtractionSchema.parse({
  generalNotes: [],
  incidents: [
    {
      // Good, well-supported update — plus one fabricated completed action and an invented owner.
      ...base,
      incidentId: "INC-1042",
      mentionedAs: "INC 1042 payments",
      currentSituation: "Rollback done; errors at ~1%.",
      actionsCompleted: [
        { description: "Rolled back gateway config", evidence: "rolled back the gateway config" },
        { description: "Paged the CTO", evidence: "we paged the CTO" }, // not in transcript
      ],
      pendingActions: [
        { description: "Engage card processor", owner: "Daniel Okafor", dueAt: null, evidence: "need to engage the card processor" },
      ],
      owner: "Asha Rao",
      ownerEvidence: "Asha will give the next update",
      nextUpdateAt: "2026-10-12T06:30:00Z",
      nextUpdateEvidence: "next update in thirty minutes",
    },
    {
      // Ambiguous "resolution" must not be accepted.
      ...base,
      incidentId: "INC-1046",
      mentionedAs: "CDN certificate",
      matchConfidence: "medium",
      currentSituation: "Looks better.",
      proposedStatus: "Resolved",
      statusEvidence: "looks better, maybe it is fine now",
      confidence: 0.55,
    },
    {
      // Invented incident ID must be rejected and treated as unmatched.
      ...base,
      incidentId: "INC-4040",
      mentionedAs: "billing exports",
      matchConfidence: "low",
      currentSituation: "Something odd with billing exports.",
      confidence: 0.3,
    },
  ],
});

const draft = buildDraft(modelOutput, candidates, transcript, now, "test-model");

// --- Matched incident with verified facts
const pay = draft.matched.find((m) => m.incidentId === "INC-1042");
assert.ok(pay, "INC-1042 should be matched");
assert.equal(pay.owner?.value, "Asha Rao", "owner named in transcript is kept");
assert.equal(pay.nextUpdateAt?.value, "2026-10-12T06:30:00.000Z", "quoted next update is kept");
assert.equal(pay.actionsCompleted[0].evidenceVerified, true, "real completed action is verified");
assert.equal(pay.actionsCompleted[1].evidenceVerified, false, "fabricated completed action is flagged");
assert.equal(pay.pendingActions[0].owner, null, "invented pending-action owner is stripped");
assert.ok(pay.requiresReview, "unverified items force review");

// --- Ambiguous resolution
const cdn = draft.matched.find((m) => m.incidentId === "INC-1046");
assert.ok(cdn, "INC-1046 stays matched (medium confidence)");
assert.equal(cdn.proposedStatus, null, "ambiguous 'Resolved' is not proposed");
assert.ok(cdn.requiresReview);
assert.ok(cdn.unresolvedQuestions.some((q) => /resolved/i.test(q)), "asks a human to confirm resolution");

// --- Invented ID
assert.equal(draft.matched.some((m) => m.incidentId === "INC-4040"), false, "invented ID never matched");
const unknown = draft.unmatched.find((u) => u.suggestedIncidentId === "INC-4040");
assert.ok(unknown && unknown.requiresReview && unknown.current === null, "invented ID returned as unmatched");

// --- Coverage
assert.ok(draft.notMentioned.some((n) => n.id === "INC-1043"), "unmentioned active incidents are listed");
assert.equal(draft.readOnly, true);

// --- Inputs untouched (extraction is read-only)
const fresh = buildSeedIncidents(now);
assert.deepEqual(candidates, fresh, "candidate incident records are not mutated");

console.log("✓ extraction safety checks passed");
for (const p of [...draft.matched, ...draft.unmatched]) {
  console.log(`  ${p.incidentId ?? `UNMATCHED(${p.suggestedIncidentId})`}: review=${p.requiresReview} warnings=${p.warnings.length}`);
  for (const w of p.warnings) console.log(`    - ${w}`);
}
