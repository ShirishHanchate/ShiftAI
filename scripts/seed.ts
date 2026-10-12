/**
 * Idempotent seed script: inserts the 8 fictional sample incidents only when a
 * row with the same incident ID does not already exist (ON CONFLICT DO NOTHING).
 * Safe to run repeatedly — existing rows are never overwritten.
 *
 *   npm run seed            # insert missing sample incidents
 *   npm run seed -- --reset # delete ONLY sample rows (is_sample_data = true), then re-seed
 *
 * Requires the table from supabase/migrations/0001_incidents.sql.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { buildSeedIncidents } from "../src/data/seed-incidents";
import { buildSeedCommunications } from "../src/data/seed-communications";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. Copy .env.example to .env.local and fill them in.");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  if (process.argv.includes("--reset")) {
    await supabase.from("incident_communications").delete().eq("is_sample_data", true);
    const { error, count } = await supabase.from("incidents").delete({ count: "exact" }).eq("is_sample_data", true);
    if (error) throw new Error(error.message);
    console.log(`Reset: removed ${count ?? 0} sample incident(s).`);
  }

  const seed = buildSeedIncidents();
  const rows = seed.map((i) => ({
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
    is_sample_data: true,
  }));

  const { data, error } = await supabase
    .from("incidents")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (error) {
    if (error.code === "42P01" || /does not exist|schema cache/i.test(error.message)) {
      throw new Error("Table public.incidents not found. Run supabase/migrations/0001_incidents.sql in the Supabase SQL editor first.");
    }
    throw new Error(error.message);
  }
  const inserted = data?.length ?? 0;
  console.log(`Seed complete: ${inserted} inserted, ${rows.length - inserted} already present (left untouched).`);

  // Fictional emails / chat / ticket comments (requires migration 0003).
  const comms = buildSeedCommunications().map((c) => ({
    dedupe_key: c.dedupeKey,
    incident_id: c.incidentId,
    channel: c.channel,
    author: c.author,
    subject: c.subject,
    body: c.body,
    sent_at: c.sentAt,
    is_sample_data: true,
  }));
  const commsRes = await supabase
    .from("incident_communications")
    .upsert(comms, { onConflict: "dedupe_key", ignoreDuplicates: true })
    .select("id");
  if (commsRes.error) {
    console.warn(`Skipped communications seed (${commsRes.error.message}). Run supabase/migrations/0003_incident_communications.sql first.`);
  } else {
    const n = commsRes.data?.length ?? 0;
    console.log(`Communications: ${n} inserted, ${comms.length - n} already present.`);
  }
}

main().catch((err) => {
  // Message only — keys and URLs are never printed.
  console.error("Seed failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
