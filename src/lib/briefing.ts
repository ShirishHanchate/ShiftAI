/**
 * Deterministic incoming-shift briefing. Pure functions only (no I/O, no AI) so
 * the prioritisation is explainable and unit-tested. Built exclusively from
 * persisted incident records and confirmed handovers — never from drafts.
 */
import type { Incident } from "@/types/incident";
import type { HandoverRecord } from "@/types/handover";
import type { Briefing, BriefingAction, BriefingIncident } from "@/types/briefing";

const SEVERITY_RANK = { SEV1: 0, SEV2: 1, SEV3: 2, SEV4: 3 } as const;
/** "Due soon" window for follow-ups and pending actions. */
export const DUE_SOON_MS = 2 * 60 * 60 * 1000;
/** Upcoming follow-ups shown in the briefing. */
const UPCOMING_WINDOW_MS = 12 * 60 * 60 * 1000;

const time = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

/** Overdue only when a time is recorded and has passed. A missing deadline is NEVER overdue. */
export function isOverdue(iso: string | null, now: number): boolean {
  const t = time(iso);
  return Number.isFinite(t) && t < now;
}

export function isDueSoon(iso: string | null, now: number): boolean {
  const t = time(iso);
  return Number.isFinite(t) && t >= now && t - now <= DUE_SOON_MS;
}

function toActions(incident: Incident, now: number): BriefingAction[] {
  return incident.pendingActions
    .filter((a) => a.status === "pending")
    .map((a) => ({
      incidentId: incident.id,
      incidentTitle: incident.title,
      severity: incident.severity,
      description: a.description,
      owner: a.owner,
      dueAt: a.dueAt,
      overdue: isOverdue(a.dueAt, now),
      dueSoon: isDueSoon(a.dueAt, now),
    }))
    .sort(compareActions);
}

/** Overdue first, then earliest known due time, then unknown due times (in original order). */
export function compareActions(a: BriefingAction, b: BriefingAction): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  const ta = time(a.dueAt);
  const tb = time(b.dueAt);
  const fa = Number.isFinite(ta);
  const fb = Number.isFinite(tb);
  if (fa && fb) return ta - tb;
  if (fa !== fb) return fa ? -1 : 1;
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
}

interface Keyed {
  b: Omit<BriefingIncident, "priorityRank">;
  severity: number;
  overdue: boolean;
  blocked: boolean;
  nearestDue: number;
  updated: number;
}

/**
 * Priority order (documented in README):
 *  1. Severity (SEV1 first)
 *  2. Recorded risk: overdue follow-up or overdue pending action
 *  3. Unresolved blockers
 *  4. Nearest recorded pending-action deadline (unknown deadlines last)
 *  5. Most recently updated
 */
export function comparePriority(x: Keyed, y: Keyed): number {
  return (
    x.severity - y.severity ||
    Number(y.overdue) - Number(x.overdue) ||
    Number(y.blocked) - Number(x.blocked) ||
    (x.nearestDue === y.nearestDue ? 0 : x.nearestDue - y.nearestDue) ||
    y.updated - x.updated ||
    x.b.id.localeCompare(y.b.id)
  );
}

function recommendationsFor(incidentId: string, handovers: HandoverRecord[]): string[] {
  // Handovers are newest first; use the latest one that reviewed this incident.
  for (const h of handovers) {
    const entry = h.review.find((r) => r.incidentId === incidentId && r.decision === "approve");
    if (entry) return entry.recommendations ?? [];
  }
  return [];
}

export function buildBriefing(incidents: Incident[], handovers: HandoverRecord[], nowMs: number): Briefing {
  const sortedHandovers = [...handovers].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const active = incidents.filter((i) => i.status !== "Resolved");

  const keyed: Keyed[] = active.map((i) => {
    const actions = toActions(i, nowMs);
    const followUpOverdue = isOverdue(i.nextUpdateAt, nowMs);
    const followUpDueSoon = isDueSoon(i.nextUpdateAt, nowMs);
    const overdueActions = actions.filter((a) => a.overdue).length;

    const missing: string[] = [];
    if (!i.owner) missing.push("No incident owner recorded");
    if (!i.nextUpdateAt) missing.push("No next update time recorded");
    if (actions.length === 0) missing.push("No pending action recorded — next step unclear");
    const noOwner = actions.filter((a) => !a.owner).length;
    if (noOwner) missing.push(`${noOwner} pending action(s) without an owner`);
    const noDue = actions.filter((a) => !a.dueAt).length;
    if (noDue) missing.push(`${noDue} pending action(s) without a due time`);

    const reasons: string[] = [`${i.severity} severity`];
    if (followUpOverdue) reasons.push("Follow-up is overdue");
    if (overdueActions) reasons.push(`${overdueActions} pending action(s) overdue`);
    if (i.blockers.length) reasons.push(`${i.blockers.length} unresolved blocker(s)`);
    const nearest = actions.find((a) => !a.overdue && a.dueAt);
    if (nearest) reasons.push(`Next deadline ${nearest.dueSoon ? "within 2h" : "recorded"}`);

    const latestUpdate = [...i.updateHistory].sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;

    const dueTimes = actions.map((a) => time(a.dueAt)).filter(Number.isFinite);
    return {
      b: {
        id: i.id,
        title: i.title,
        severity: i.severity,
        status: i.status,
        affectedService: i.affectedService,
        owner: i.owner,
        summary: i.summary,
        updatedAt: i.updatedAt,
        nextUpdateAt: i.nextUpdateAt,
        followUpOverdue,
        followUpDueSoon,
        latestUpdate,
        completed: i.actionsCompleted,
        pendingActions: actions,
        blockers: i.blockers,
        nextAction: actions[0] ?? null,
        missingInformation: missing,
        aiRecommendations: recommendationsFor(i.id, sortedHandovers),
        priorityReasons: reasons,
      },
      severity: SEVERITY_RANK[i.severity],
      overdue: followUpOverdue || overdueActions > 0,
      blocked: i.blockers.length > 0,
      nearestDue: dueTimes.length ? Math.min(...dueTimes) : Number.POSITIVE_INFINITY,
      updated: Date.parse(i.updatedAt),
    };
  });

  const ordered: BriefingIncident[] = keyed.sort(comparePriority).map((k, idx) => ({ ...k.b, priorityRank: idx + 1 }));

  const pendingActions = ordered.flatMap((i) => i.pendingActions).sort(compareActions);
  const followUps = ordered.filter((i) => i.nextUpdateAt);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    stats: {
      active: ordered.length,
      sev1: ordered.filter((i) => i.severity === "SEV1").length,
      sev2: ordered.filter((i) => i.severity === "SEV2").length,
      pendingActions: pendingActions.length,
      overdueFollowUps: ordered.filter((i) => i.followUpOverdue).length,
      overdueActions: pendingActions.filter((a) => a.overdue).length,
      blocked: ordered.filter((i) => i.blockers.length).length,
      withoutOwner: ordered.filter((i) => !i.owner).length,
      withoutNextAction: ordered.filter((i) => !i.nextAction).length,
    },
    incidents: ordered,
    recentlyUpdated: [...incidents]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5)
      .map((i) => ({
        id: i.id,
        title: i.title,
        severity: i.severity,
        status: i.status,
        updatedAt: i.updatedAt,
        note: [...i.updateHistory].sort((a, b) => b.at.localeCompare(a.at))[0]?.note ?? null,
      })),
    pendingActions,
    blockers: ordered.flatMap((i) =>
      i.blockers.map((blocker) => ({ incidentId: i.id, incidentTitle: i.title, severity: i.severity, blocker })),
    ),
    upcomingFollowUps: followUps
      .filter((i) => !i.followUpOverdue && time(i.nextUpdateAt) - nowMs <= UPCOMING_WINDOW_MS)
      .sort((a, b) => time(a.nextUpdateAt) - time(b.nextUpdateAt))
      .map((i) => ({ incidentId: i.id, title: i.title, severity: i.severity, at: i.nextUpdateAt! })),
    overdueFollowUps: followUps
      .filter((i) => i.followUpOverdue)
      .sort((a, b) => time(a.nextUpdateAt) - time(b.nextUpdateAt))
      .map((i) => ({ incidentId: i.id, title: i.title, severity: i.severity, at: i.nextUpdateAt! })),
    withoutOwner: ordered.filter((i) => !i.owner).map((i) => i.id),
    withoutNextAction: ordered.filter((i) => !i.nextAction).map((i) => i.id),
    latestHandover: sortedHandovers[0] ?? null,
  };
}
