import { NextResponse, connection } from "next/server";
import { configStatus } from "@/lib/env";
import { pingDb } from "@/lib/supabase";

export async function GET() {
  await connection();
  const config = configStatus();
  const dbConfigured = config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY;

  let database: { status: "ok" | "error" | "not_configured"; latencyMs?: number; code?: string } = {
    status: "not_configured",
  };
  if (dbConfigured) {
    try {
      const { latencyMs } = await pingDb();
      database = { status: "ok", latencyMs };
    } catch (err) {
      database = { status: "error", code: (err as { code?: string }).code ?? "unknown" };
    }
  }

  return NextResponse.json(
    {
      status: database.status === "ok" && config.SARVAM_API_KEY ? "ok" : "degraded",
      time: new Date().toISOString(),
      // Booleans only — configuration values are never exposed.
      config: { databaseConfigured: dbConfigured, sarvamConfigured: config.SARVAM_API_KEY },
      database,
    },
    { status: database.status === "ok" ? 200 : 503 },
  );
}
