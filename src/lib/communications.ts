import "server-only";
import { DatabaseError, getSupabase } from "./supabase";

export interface IncidentCommunication {
  id: number;
  incidentId: string;
  channel: "email" | "chat" | "ticket_comment";
  author: string;
  subject: string | null;
  body: string;
  sentAt: string;
}

interface Row {
  id: number;
  incident_id: string;
  channel: IncidentCommunication["channel"];
  author: string;
  subject: string | null;
  body: string;
  sent_at: string;
}

const toComm = (r: Row): IncidentCommunication => ({
  id: r.id,
  incidentId: r.incident_id,
  channel: r.channel,
  author: r.author,
  subject: r.subject,
  body: r.body,
  sentAt: new Date(r.sent_at).toISOString(),
});

/**
 * Emails / chat / ticket comments, newest first. Returns [] (instead of failing the
 * caller) when the optional communications table has not been created yet.
 */
export async function listCommunications(opts: { incidentIds?: string[]; sinceIso?: string; limit?: number } = {}): Promise<IncidentCommunication[]> {
  let q = getSupabase()
    .from("incident_communications")
    .select("id, incident_id, channel, author, subject, body, sent_at")
    .order("sent_at", { ascending: false })
    .limit(Math.min(opts.limit ?? 100, 300));
  if (opts.incidentIds?.length) q = q.in("incident_id", opts.incidentIds);
  if (opts.sinceIso) q = q.gte("sent_at", opts.sinceIso);
  const { data, error } = await q;
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") return [];
    throw new DatabaseError(error.message, error.code);
  }
  return (data as Row[]).map(toComm);
}
