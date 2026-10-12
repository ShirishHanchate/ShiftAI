import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "./env";

let client: SupabaseClient | undefined;

/**
 * Server-side Supabase client using the service-role (secret) key.
 * Must never be imported from client components — `server-only` enforces this.
 */
export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-application-name": "shiftsync-ai" } },
    });
  }
  return client;
}

export class DatabaseError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "DatabaseError";
  }
}

export async function pingDb(): Promise<{ latencyMs: number }> {
  const start = Date.now();
  // A real GET (not HEAD) so a missing table surfaces as an error instead of an empty success.
  const { error } = await getSupabase().from("incidents").select("id").limit(1);
  if (error) throw new DatabaseError(error.message, error.code);
  return { latencyMs: Date.now() - start };
}
