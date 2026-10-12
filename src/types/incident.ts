export const SEVERITIES = ["SEV1", "SEV2", "SEV3", "SEV4"] as const;
export const STATUSES = ["Open", "Investigating", "Monitoring", "Resolved"] as const;
export const ACTION_STATUSES = ["pending", "completed"] as const;

export type Severity = (typeof SEVERITIES)[number];
export type IncidentStatus = (typeof STATUSES)[number];
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export interface PendingAction {
  description: string;
  owner: string | null;
  /** ISO-8601 UTC string */
  dueAt: string | null;
  status: ActionStatus;
}

export interface UpdateHistoryEntry {
  /** ISO-8601 UTC string */
  at: string;
  author: string;
  source: "seed" | "manual" | "handover";
  note: string;
  /** Set when the entry was written by a confirmed handover. */
  handoverId?: string;
}

/** Incident as returned by the API (timestamps serialized as ISO-8601 UTC strings). */
export interface Incident {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  status: IncidentStatus;
  affectedService: string;
  summary: string;
  actionsCompleted: string[];
  pendingActions: PendingAction[];
  blockers: string[];
  owner: string | null;
  nextUpdateAt: string | null;
  createdAt: string;
  updatedAt: string;
  updateHistory: UpdateHistoryEntry[];
  /** True when this record is fictional demo data. */
  isSampleData?: boolean;
}

export interface IncidentStats {
  activeIncidents: number;
  sev1: number;
  sev2: number;
  pendingActions: number;
}
