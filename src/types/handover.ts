import type { IncidentStatus, Severity } from "./incident";

export type MatchConfidence = "high" | "medium" | "low";

export interface EvidencedItem {
  description: string;
  /** Quote from the transcript supporting this item ("" if the model gave none). */
  evidence: string;
  /** True when the evidence quote was found in the transcript by the server. */
  evidenceVerified: boolean;
}

export interface ProposedPendingAction extends EvidencedItem {
  owner: string | null;
  dueAt: string | null;
}

export interface IncidentSnapshot {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  owner: string | null;
  nextUpdateAt: string | null;
  affectedService: string;
  /** Version marker used for optimistic concurrency when confirming. */
  updatedAt: string;
  openPendingActions: string[];
  blockers: string[];
}

export interface ProposedIncidentUpdate {
  /** Validated incident ID (exists in the database), or null when unmatched. */
  incidentId: string | null;
  /** Snapshot of the current DB record for comparison; null when unmatched. */
  current: IncidentSnapshot | null;
  /** For unmatched items: the ID the model suggested, if any (NOT validated). */
  suggestedIncidentId: string | null;
  mentionedAs: string;
  matchConfidence: MatchConfidence;
  matchReason: string;
  currentSituation: string;
  actionsCompleted: EvidencedItem[];
  pendingActions: ProposedPendingAction[];
  blockers: string[];
  owner: { value: string; evidence: string } | null;
  nextUpdateAt: { value: string; evidence: string } | null;
  proposedStatus: { value: IncidentStatus; evidence: string } | null;
  unresolvedQuestions: string[];
  missingFields: string[];
  /** Model suggestions — NOT facts from the transcript. */
  recommendations: string[];
  confidence: number;
  requiresReview: boolean;
  /** Server-side safety warnings explaining why review is required. */
  warnings: string[];
}

export interface HandoverDraft {
  generatedAt: string;
  model: string;
  matched: ProposedIncidentUpdate[];
  unmatched: ProposedIncidentUpdate[];
  /** Active candidate incidents that the transcript did not mention. */
  notMentioned: IncidentSnapshot[];
  generalNotes: string[];
  /** Always true in Phase 2: extraction never writes to the database. */
  readOnly: true;
}

// ---------------------------------------------------------------------------
// Persisted handovers (Phase 3)
// ---------------------------------------------------------------------------

export type HandoverStatus = "confirmed" | "no_changes";

/** Per-incident outcome stored on the handover record. */
export interface HandoverReviewEntry {
  incidentId: string | null;
  decision: "approve" | "reject";
  mentionedAs?: string;
  reason?: string;
  changedFields?: string[];
  recommendations?: string[];
  missingFields?: string[];
  unresolvedQuestions?: string[];
}

export interface HandoverSummary {
  id: string;
  createdAt: string;
  outgoingShift: string;
  incomingShift: string;
  submittedBy: string | null;
  status: HandoverStatus;
  incidentIds: string[];
  approvedIncidentIds: string[];
  rejectedIncidentIds: string[];
}

export interface HandoverRecord extends HandoverSummary {
  originalTranscript: string;
  editedTranscript: string | null;
  review: HandoverReviewEntry[];
}

export interface AuditEntry {
  id: number;
  incidentId: string;
  handoverId: string;
  createdAt: string;
  source: "handover" | "manual";
  changedFields: string[];
  previousValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  confirmationStatus: "confirmed";
}

export interface ConfirmResult {
  handover: HandoverRecord;
  replayed: boolean;
  appliedIncidentIds: string[];
}
