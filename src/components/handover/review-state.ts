import type { HandoverDraft, IncidentSnapshot, ProposedIncidentUpdate } from "@/types/handover";
import type { Incident, IncidentStatus } from "@/types/incident";

export type Decision = "approve" | "reject" | "undecided";

export interface EditablePendingAction {
  description: string;
  owner: string;
  /** "YYYY-MM-DDTHH:mm" in UTC, or "" */
  dueAt: string;
}

export interface ReviewItem {
  key: string;
  proposal: ProposedIncidentUpdate;
  /** Target incident (may be assigned by the reviewer for unmatched items). */
  incident: IncidentSnapshot | null;
  decision: Decision;
  editing: boolean;
  currentSituation: string;
  actionsCompleted: string[];
  pendingActions: EditablePendingAction[];
  blockers: string[];
  owner: string;
  nextUpdateAt: string;
  status: IncidentStatus | "";
  resolutionConfirmed: boolean;
  completeExisting: string[];
  blockersCleared: string[];
}

/** ISO → "YYYY-MM-DDTHH:mm" (UTC) for <input type="datetime-local">. */
export const isoToUtcInput = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : "");
/** "YYYY-MM-DDTHH:mm" (interpreted as UTC) → ISO, or null. */
export const utcInputToIso = (v: string) => {
  if (!v) return null;
  const t = Date.parse(`${v}:00Z`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

export function snapshotOf(i: Incident): IncidentSnapshot {
  return {
    id: i.id,
    title: i.title,
    severity: i.severity,
    status: i.status,
    owner: i.owner,
    nextUpdateAt: i.nextUpdateAt,
    affectedService: i.affectedService,
    updatedAt: i.updatedAt,
    openPendingActions: i.pendingActions.filter((a) => a.status === "pending").map((a) => a.description),
    blockers: i.blockers,
  };
}

const normText = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

function fromProposal(p: ProposedIncidentUpdate, key: string): ReviewItem {
  // Only transcript-verified completions are pre-filled. A completion that matches an existing open
  // pending action is pre-ticked as "mark done" instead of being added as a duplicate.
  const open = new Map((p.current?.openPendingActions ?? []).map((a) => [normText(a), a]));
  const verifiedDone = p.actionsCompleted.filter((a) => a.evidenceVerified).map((a) => a.description);
  const completeExisting = verifiedDone.filter((d) => open.has(normText(d))).map((d) => open.get(normText(d))!);
  const newDone = verifiedDone.filter((d) => !open.has(normText(d)));
  return {
    key,
    proposal: p,
    incident: p.current,
    // Clean, matched proposals are pre-approved; anything flagged needs an explicit decision.
    decision: p.current ? (p.requiresReview ? "undecided" : "approve") : "undecided",
    editing: false,
    currentSituation: p.currentSituation,
    actionsCompleted: newDone,
    pendingActions: p.pendingActions.map((a) => ({
      description: a.description,
      owner: a.owner ?? "",
      dueAt: isoToUtcInput(a.dueAt),
    })),
    blockers: [...p.blockers],
    owner: p.owner?.value ?? "",
    nextUpdateAt: isoToUtcInput(p.nextUpdateAt?.value ?? null),
    status: p.proposedStatus?.value ?? "",
    resolutionConfirmed: false,
    completeExisting,
    blockersCleared: [],
  };
}

export function initialReviewItems(draft: HandoverDraft): ReviewItem[] {
  return [
    ...draft.matched.map((p, i) => fromProposal(p, `m${i}`)),
    ...draft.unmatched.map((p, i) => fromProposal(p, `u${i}`)),
  ];
}

export function itemProblems(item: ReviewItem): string[] {
  const problems: string[] = [];
  if (item.decision !== "approve") return problems;
  if (!item.incident) problems.push("Assign an incident before approving.");
  if (item.status === "Resolved" && !item.resolutionConfirmed) problems.push("Confirm the resolution explicitly.");
  if (item.pendingActions.some((a) => !a.description.trim())) problems.push("Pending actions need a description.");
  return problems;
}

/** Converts review state into the /api/handovers/confirm decision payload. */
export function toDecision(item: ReviewItem) {
  const clean = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);
  if (item.decision !== "approve" || !item.incident) {
    return {
      decision: "reject" as const,
      incidentId: item.incident?.id ?? null,
      mentionedAs: item.proposal.mentionedAs,
      reason: item.decision === "reject" ? "Rejected by reviewer" : "Not approved",
    };
  }
  const situation = item.currentSituation.trim();
  return {
    decision: "approve" as const,
    incidentId: item.incident.id,
    expectedUpdatedAt: item.incident.updatedAt,
    changes: {
      currentSituation: situation ? situation : null,
      actionsCompletedAdd: clean(item.actionsCompleted),
      pendingActionsAdd: item.pendingActions
        .filter((a) => a.description.trim())
        .map((a) => ({ description: a.description.trim(), owner: a.owner.trim() || null, dueAt: utcInputToIso(a.dueAt) })),
      completeExistingActions: item.completeExisting,
      blockersAdd: clean(item.blockers),
      blockersCleared: item.blockersCleared,
      owner: item.owner.trim() || null,
      nextUpdateAt: utcInputToIso(item.nextUpdateAt),
      status: item.status && item.status !== item.incident.status ? item.status : null,
      resolutionConfirmed: item.resolutionConfirmed,
    },
    recommendations: item.proposal.recommendations,
    missingFields: item.proposal.missingFields,
    unresolvedQuestions: item.proposal.unresolvedQuestions,
  };
}

/** Suggest shift labels from the current UTC time (06–14 Morning, 14–22 Evening, 22–06 Night). */
export function defaultShifts(now = new Date()): { outgoing: string; incoming: string } {
  const h = now.getUTCHours();
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (h >= 6 && h < 14) return { outgoing: `${day(now)} Morning`, incoming: `${day(now)} Evening` };
  if (h >= 14 && h < 22) return { outgoing: `${day(now)} Evening`, incoming: `${day(now)} Night` };
  const nightDate = h >= 22 ? day(now) : day(new Date(now.getTime() - 86_400_000));
  return { outgoing: `${nightDate} Night`, incoming: `${h >= 22 ? day(tomorrow) : day(now)} Morning` };
}
