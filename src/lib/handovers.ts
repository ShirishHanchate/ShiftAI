import "server-only";
import { createHash } from "node:crypto";
import { ApiError } from "./api";
import { DatabaseError, getSupabase } from "./supabase";
import { getIncidentsByIds } from "./incidents";
import type { ApproveDecision, ConfirmRequest, IncidentChanges } from "./validation";
import type { Incident, PendingAction } from "@/types/incident";
import type {
  AuditEntry,
  ConfirmResult,
  HandoverRecord,
  HandoverReviewEntry,
  HandoverSummary,
} from "@/types/handover";

// ---------------------------------------------------------------------------
// Pure merge logic (unit-tested). Additive by default: values the transcript
// omitted are never erased. Removals happen only when the reviewer explicitly
// clears a blocker or marks an existing pending action as done.
// ---------------------------------------------------------------------------

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

function appendUnique(existing: string[], additions: string[]): string[] {
  const seen = new Set(existing.map(norm));
  const out = [...existing];
  for (const a of additions) {
    const t = a.trim();
    if (t && !seen.has(norm(t))) {
      out.push(t);
      seen.add(norm(t));
    }
  }
  return out;
}

export interface IncidentNextState {
  status: Incident["status"];
  summary: string;
  owner: string | null;
  next_update_at: string | null;
  actions_completed: string[];
  pending_actions: PendingAction[];
  blockers: string[];
}

export interface MergeResult {
  next: IncidentNextState;
  changedFields: string[];
  previousValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  historyNote: string;
}

export function mergeIncidentChanges(incident: Incident, changes: IncidentChanges): MergeResult {
  const completeSet = new Set(changes.completeExistingActions.map(norm));
  const clearedSet = new Set(changes.blockersCleared.map(norm));

  // Existing pending actions: only explicitly ticked ones flip to completed.
  let pending: PendingAction[] = incident.pendingActions.map((a) =>
    a.status === "pending" && completeSet.has(norm(a.description)) ? { ...a, status: "completed" } : { ...a },
  );
  const newlyCompleted = incident.pendingActions
    .filter((a) => a.status === "pending" && completeSet.has(norm(a.description)))
    .map((a) => a.description);

  const existingPending = new Set(pending.map((a) => norm(a.description)));
  pending = [
    ...pending,
    ...changes.pendingActionsAdd
      .filter((a) => !existingPending.has(norm(a.description)))
      .map((a) => ({ description: a.description.trim(), owner: a.owner, dueAt: a.dueAt, status: "pending" as const })),
  ];

  const next: IncidentNextState = {
    status: changes.status ?? incident.status,
    summary: changes.currentSituation?.trim() ? changes.currentSituation.trim() : incident.summary,
    owner: changes.owner ?? incident.owner,
    next_update_at: changes.nextUpdateAt ? new Date(changes.nextUpdateAt).toISOString() : incident.nextUpdateAt,
    actions_completed: appendUnique(incident.actionsCompleted, [...changes.actionsCompletedAdd, ...newlyCompleted]),
    pending_actions: pending,
    blockers: appendUnique(
      incident.blockers.filter((b) => !clearedSet.has(norm(b))),
      changes.blockersAdd,
    ),
  };

  const before: Record<string, unknown> = {
    status: incident.status,
    summary: incident.summary,
    owner: incident.owner,
    nextUpdateAt: incident.nextUpdateAt,
    actionsCompleted: incident.actionsCompleted,
    pendingActions: incident.pendingActions,
    blockers: incident.blockers,
  };
  const after: Record<string, unknown> = {
    status: next.status,
    summary: next.summary,
    owner: next.owner,
    nextUpdateAt: next.next_update_at,
    actionsCompleted: next.actions_completed,
    pendingActions: next.pending_actions,
    blockers: next.blockers,
  };

  const changedFields = Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  const previousValues = Object.fromEntries(changedFields.map((k) => [k, before[k]]));
  const newValues = Object.fromEntries(changedFields.map((k) => [k, after[k]]));

  const parts: string[] = [];
  if (changedFields.includes("status")) parts.push(`Status ${incident.status} → ${next.status}`);
  if (changedFields.includes("owner")) parts.push(`Owner → ${next.owner}`);
  const addedDone = next.actions_completed.length - incident.actionsCompleted.length;
  if (addedDone > 0) parts.push(`${addedDone} action(s) completed`);
  const addedPending = next.pending_actions.length - incident.pendingActions.length;
  if (addedPending > 0) parts.push(`${addedPending} pending action(s) added`);
  if (changedFields.includes("blockers")) parts.push("Blockers updated");
  if (changedFields.includes("nextUpdateAt") && next.next_update_at) parts.push("Next update scheduled");
  if (changedFields.includes("summary")) parts.push(`Situation: ${next.summary.slice(0, 160)}`);

  return { next, changedFields, previousValues, newValues, historyNote: parts.join(". ") || "Reviewed in handover; no field changes." };
}

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

/** Stable JSON (sorted keys) so the same request always hashes the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function requestHash(req: ConfirmRequest): string {
  return createHash("sha256").update(canonical(req)).digest("hex");
}

function mapRpcError(err: { code?: string; message?: string }): ApiError | DatabaseError {
  const msg = err.message ?? "";
  if (err.code === "SS409") {
    return new ApiError(409, "idempotency_conflict", "This handover was already submitted with different content. Reload and submit again.");
  }
  if (err.code === "SS404") {
    return new ApiError(404, "incident_not_found", `Unknown incident: ${msg.split(":")[1] ?? ""}`.trim());
  }
  if (err.code === "SS412") {
    const id = msg.split(":")[1] ?? "an incident";
    return new ApiError(
      409,
      "incident_changed",
      `${id} was updated by someone else after you loaded it. Regenerate the draft to review the latest state. No changes were saved.`,
    );
  }
  if (err.code === "PGRST202" || err.code === "42883") {
    return new DatabaseError("confirm_handover() is missing. Run supabase/migrations/0002_handovers_audit.sql.", "42883");
  }
  return new DatabaseError(msg || "Database error while confirming handover.", err.code);
}

export async function confirmHandover(req: ConfirmRequest): Promise<ConfirmResult> {
  const hash = requestHash(req);

  // Fast idempotent replay (the SQL function re-checks this inside the transaction).
  const replay = await findByIdempotencyKey(req.idempotencyKey);
  if (replay) {
    if (replay.hash !== hash) throw mapRpcError({ code: "SS409" });
    return { handover: replay.record, replayed: true, appliedIncidentIds: [] };
  }

  const approvals = req.decisions.filter((d): d is ApproveDecision => d.decision === "approve");
  const rejections = req.decisions.filter((d) => d.decision === "reject");

  // Reject unknown incident IDs before touching anything.
  const incidents = await getIncidentsByIds(approvals.map((a) => a.incidentId));
  const byId = new Map(incidents.map((i) => [i.id, i]));
  const unknown = approvals.filter((a) => !byId.has(a.incidentId)).map((a) => a.incidentId);
  if (unknown.length) throw new ApiError(404, "incident_not_found", `Unknown incident ID(s): ${unknown.join(", ")}`);

  const review: HandoverReviewEntry[] = [];
  const updates = [];
  for (const a of approvals) {
    const incident = byId.get(a.incidentId)!;
    if (Date.parse(incident.updatedAt) !== Date.parse(a.expectedUpdatedAt)) {
      throw mapRpcError({ code: "SS412", message: `STALE_INCIDENT:${a.incidentId}` });
    }
    const merged = mergeIncidentChanges(incident, a.changes);
    review.push({
      incidentId: a.incidentId,
      decision: "approve",
      changedFields: merged.changedFields,
      recommendations: a.recommendations,
      missingFields: a.missingFields,
      unresolvedQuestions: a.unresolvedQuestions,
    });
    if (merged.changedFields.length === 0) continue; // approved, but nothing to write
    updates.push({
      incident_id: a.incidentId,
      expected_updated_at: new Date(a.expectedUpdatedAt).toISOString(),
      changed_fields: merged.changedFields,
      previous_values: merged.previousValues,
      new_values: merged.newValues,
      next: {
        ...merged.next,
        history_entry: {
          author: req.submittedBy?.trim() || req.outgoingShift,
          source: "handover",
          note: merged.historyNote,
        },
      },
    });
  }
  for (const r of rejections) {
    review.push({ incidentId: r.incidentId, decision: "reject", mentionedAs: r.mentionedAs, reason: r.reason });
  }

  const approvedIds = approvals.map((a) => a.incidentId);
  const rejectedIds = rejections.map((r) => r.incidentId).filter((id): id is string => !!id);
  const editedTranscript = req.editedTranscript.trim() === req.originalTranscript.trim() ? null : req.editedTranscript;

  const { data, error } = await getSupabase().rpc("confirm_handover", {
    p_handover: {
      idempotency_key: req.idempotencyKey,
      request_hash: hash,
      original_transcript: req.originalTranscript,
      edited_transcript: editedTranscript,
      outgoing_shift: req.outgoingShift,
      incoming_shift: req.incomingShift,
      submitted_by: req.submittedBy ?? null,
      status: updates.length ? "confirmed" : "no_changes",
      incident_ids: [...new Set([...approvedIds, ...rejectedIds])],
      approved_incident_ids: approvedIds,
      rejected_incident_ids: rejectedIds,
      review,
    },
    p_updates: updates,
  });

  if (error) {
    // Two identical submissions racing: the loser hits the unique key — treat as a replay.
    if (error.code === "23505") {
      const winner = await findByIdempotencyKey(req.idempotencyKey);
      if (winner && winner.hash === hash) return { handover: winner.record, replayed: true, appliedIncidentIds: [] };
    }
    throw mapRpcError(error);
  }

  const result = data as { handover_id: string; replayed: boolean };
  const handover = await getHandover(result.handover_id);
  if (!handover) throw new DatabaseError("Handover was saved but could not be read back.");
  return {
    handover,
    replayed: result.replayed,
    appliedIncidentIds: result.replayed ? [] : updates.map((u) => u.incident_id),
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

interface HandoverRow {
  id: string;
  idempotency_key: string;
  request_hash: string;
  original_transcript: string;
  edited_transcript: string | null;
  outgoing_shift: string;
  incoming_shift: string;
  submitted_by: string | null;
  status: HandoverRecord["status"];
  incident_ids: string[];
  approved_incident_ids: string[];
  rejected_incident_ids: string[];
  review: HandoverReviewEntry[];
  created_at: string;
}

const SUMMARY_COLUMNS =
  "id, created_at, outgoing_shift, incoming_shift, submitted_by, status, incident_ids, approved_incident_ids, rejected_incident_ids";

function toSummary(row: Partial<HandoverRow>): HandoverSummary {
  return {
    id: row.id!,
    createdAt: new Date(row.created_at!).toISOString(),
    outgoingShift: row.outgoing_shift!,
    incomingShift: row.incoming_shift!,
    submittedBy: row.submitted_by ?? null,
    status: row.status!,
    incidentIds: row.incident_ids ?? [],
    approvedIncidentIds: row.approved_incident_ids ?? [],
    rejectedIncidentIds: row.rejected_incident_ids ?? [],
  };
}

function toRecord(row: HandoverRow): HandoverRecord {
  return {
    ...toSummary(row),
    originalTranscript: row.original_transcript,
    editedTranscript: row.edited_transcript,
    review: row.review ?? [],
  };
}

async function findByIdempotencyKey(key: string): Promise<{ record: HandoverRecord; hash: string } | null> {
  const { data, error } = await getSupabase().from("handovers").select("*").eq("idempotency_key", key).maybeSingle();
  if (error) throw new DatabaseError(error.message, error.code);
  return data ? { record: toRecord(data as HandoverRow), hash: (data as HandoverRow).request_hash } : null;
}

export async function listHandovers(limit = 50): Promise<HandoverSummary[]> {
  const { data, error } = await getSupabase()
    .from("handovers")
    .select(SUMMARY_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) throw new DatabaseError(error.message, error.code);
  return (data as Partial<HandoverRow>[]).map(toSummary);
}

export async function getHandover(id: string): Promise<HandoverRecord | null> {
  const { data, error } = await getSupabase().from("handovers").select("*").eq("id", id).maybeSingle();
  if (error) throw new DatabaseError(error.message, error.code);
  return data ? toRecord(data as HandoverRow) : null;
}

/** Latest confirmed handovers that touched the given incident. */
export async function handoversForIncident(incidentId: string, limit = 5): Promise<HandoverRecord[]> {
  const { data, error } = await getSupabase()
    .from("handovers")
    .select("*")
    .contains("incident_ids", [incidentId])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new DatabaseError(error.message, error.code);
  return (data as HandoverRow[]).map(toRecord);
}

interface AuditRow {
  id: number;
  incident_id: string;
  handover_id: string;
  created_at: string;
  source: AuditEntry["source"];
  changed_fields: string[];
  previous_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  confirmation_status: "confirmed";
}

const toAudit = (r: AuditRow): AuditEntry => ({
  id: r.id,
  incidentId: r.incident_id,
  handoverId: r.handover_id,
  createdAt: new Date(r.created_at).toISOString(),
  source: r.source,
  changedFields: r.changed_fields,
  previousValues: r.previous_values,
  newValues: r.new_values,
  confirmationStatus: r.confirmation_status,
});

export async function getAuditForIncident(incidentId: string, limit = 50): Promise<AuditEntry[]> {
  const { data, error } = await getSupabase()
    .from("incident_audit_log")
    .select("*")
    .eq("incident_id", incidentId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new DatabaseError(error.message, error.code);
  return (data as AuditRow[]).map(toAudit);
}

export async function getAuditForHandover(handoverId: string): Promise<AuditEntry[]> {
  const { data, error } = await getSupabase()
    .from("incident_audit_log")
    .select("*")
    .eq("handover_id", handoverId)
    .order("incident_id");
  if (error) throw new DatabaseError(error.message, error.code);
  return (data as AuditRow[]).map(toAudit);
}

/** Most recent handovers with their review entries (newest first). */
export async function listRecentHandoverRecords(limit = 10): Promise<HandoverRecord[]> {
  const { data, error } = await getSupabase()
    .from("handovers")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 50));
  if (error) throw new DatabaseError(error.message, error.code);
  return (data as HandoverRow[]).map(toRecord);
}
