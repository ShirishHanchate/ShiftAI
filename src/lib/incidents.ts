import "server-only";
import { DatabaseError, getSupabase } from "./supabase";
import type { Incident, IncidentStats, PendingAction, UpdateHistoryEntry } from "@/types/incident";
import type { IncidentListQuery } from "./validation";

/** Row shape of `public.incidents` (snake_case, see supabase/migrations). */
export interface IncidentRow {
  id: string;
  title: string;
  description: string;
  severity: Incident["severity"];
  status: Incident["status"];
  affected_service: string;
  summary: string;
  actions_completed: string[];
  pending_actions: PendingAction[];
  blockers: string[];
  owner: string | null;
  next_update_at: string | null;
  created_at: string;
  updated_at: string;
  update_history: UpdateHistoryEntry[];
  is_sample_data: boolean;
}

const TABLE = "incidents";
const iso = (v: string | null | undefined) => (v ? new Date(v).toISOString() : null);

export function rowToIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    severity: row.severity,
    status: row.status,
    affectedService: row.affected_service,
    summary: row.summary,
    actionsCompleted: row.actions_completed ?? [],
    pendingActions: (row.pending_actions ?? []).map((a) => ({
      description: a.description,
      owner: a.owner ?? null,
      dueAt: iso(a.dueAt),
      status: a.status === "completed" ? "completed" : "pending",
    })),
    blockers: row.blockers ?? [],
    owner: row.owner ?? null,
    nextUpdateAt: iso(row.next_update_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    updateHistory: (row.update_history ?? [])
      .map((h) => ({ ...h, at: iso(h.at)! }))
      .sort((a, b) => b.at.localeCompare(a.at)),
    isSampleData: row.is_sample_data,
  };
}

export function incidentToRow(i: Incident): IncidentRow {
  return {
    id: i.id,
    title: i.title,
    description: i.description,
    severity: i.severity,
    status: i.status,
    affected_service: i.affectedService,
    summary: i.summary,
    actions_completed: i.actionsCompleted,
    pending_actions: i.pendingActions,
    blockers: i.blockers,
    owner: i.owner,
    next_update_at: i.nextUpdateAt,
    created_at: i.createdAt,
    updated_at: i.updatedAt,
    update_history: i.updateHistory,
    is_sample_data: i.isSampleData ?? false,
  };
}

const SEVERITY_ORDER = { SEV1: 0, SEV2: 1, SEV3: 2, SEV4: 3 } as const;

function sortIncidents(list: Incident[]): Incident[] {
  return list.sort(
    (a, b) =>
      Number(a.status === "Resolved") - Number(b.status === "Resolved") ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
}

/** Strip characters with meaning in PostgREST `or()` filters and ILIKE patterns. */
const sanitizeSearch = (s: string) => s.replace(/[%_\,()*."':]/g, " ").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listIncidents(query: Partial<IncidentListQuery> = {}): Promise<Incident[]> {
  const term = query.q ? sanitizeSearch(query.q) : "";
  let req = getSupabase().from(TABLE).select("*").limit(500);
  if (query.severity?.length) req = req.in("severity", query.severity);
  if (query.status?.length) req = req.in("status", query.status);
  else if (query.includeResolved === false) req = req.neq("status", "Resolved");
  if (term) {
    const p = `%${term}%`;
    req = req.or(["id", "title", "affected_service", "owner", "summary"].map((c) => `${c}.ilike.${p}`).join(","));
  }
  const { data, error } = await req;
  if (error) throw new DatabaseError(error.message, error.code);
  return sortIncidents((data as IncidentRow[]).map(rowToIncident));
}

export async function getIncidentById(id: string): Promise<Incident | null> {
  const { data, error } = await getSupabase().from(TABLE).select("*").eq("id", id).maybeSingle();
  if (error) throw new DatabaseError(error.message, error.code);
  return data ? rowToIncident(data as IncidentRow) : null;
}

export async function getIncidentsByIds(ids: string[]): Promise<Incident[]> {
  if (!ids.length) return [];
  const { data, error } = await getSupabase().from(TABLE).select("*").in("id", ids);
  if (error) throw new DatabaseError(error.message, error.code);
  return (data as IncidentRow[]).map(rowToIncident);
}

export function computeStats(incidents: Incident[]): IncidentStats {
  const active = incidents.filter((i) => i.status !== "Resolved");
  return {
    activeIncidents: active.length,
    sev1: active.filter((i) => i.severity === "SEV1").length,
    sev2: active.filter((i) => i.severity === "SEV2").length,
    pendingActions: active.reduce(
      (n, i) => n + i.pendingActions.filter((a) => a.status === "pending").length,
      0,
    ),
  };
}
