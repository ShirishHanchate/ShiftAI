import type { IncidentStatus, Severity, UpdateHistoryEntry } from "./incident";
import type { HandoverRecord } from "./handover";

export interface BriefingAction {
  incidentId: string;
  incidentTitle: string;
  severity: Severity;
  description: string;
  owner: string | null;
  dueAt: string | null;
  /** True only when a due time is recorded AND it is in the past. Unknown is never overdue. */
  overdue: boolean;
  dueSoon: boolean;
}

export interface BriefingIncident {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  affectedService: string;
  owner: string | null;
  summary: string;
  updatedAt: string;
  nextUpdateAt: string | null;
  followUpOverdue: boolean;
  followUpDueSoon: boolean;
  latestUpdate: UpdateHistoryEntry | null;
  completed: string[];
  pendingActions: BriefingAction[];
  blockers: string[];
  /** Recommended next step: earliest-due pending action (facts only — not AI). */
  nextAction: BriefingAction | null;
  /** Information the record does not contain. */
  missingInformation: string[];
  /** AI suggestions captured during the latest handover that covered this incident (never applied). */
  aiRecommendations: string[];
  /** 1-based position in the priority order. */
  priorityRank: number;
  /** Human-readable explanation of why the incident sits where it does. */
  priorityReasons: string[];
}

export interface Briefing {
  generatedAt: string;
  stats: {
    active: number;
    sev1: number;
    sev2: number;
    pendingActions: number;
    overdueFollowUps: number;
    overdueActions: number;
    blocked: number;
    withoutOwner: number;
    withoutNextAction: number;
  };
  /** Active incidents in priority order. */
  incidents: BriefingIncident[];
  recentlyUpdated: { id: string; title: string; severity: Severity; status: IncidentStatus; updatedAt: string; note: string | null }[];
  pendingActions: BriefingAction[];
  blockers: { incidentId: string; incidentTitle: string; severity: Severity; blocker: string }[];
  upcomingFollowUps: { incidentId: string; title: string; severity: Severity; at: string }[];
  overdueFollowUps: { incidentId: string; title: string; severity: Severity; at: string }[];
  withoutOwner: string[];
  withoutNextAction: string[];
  latestHandover: HandoverRecord | null;
}
