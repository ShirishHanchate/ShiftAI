import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ConfigError } from "./env";
import { DatabaseError } from "./supabase";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

/** Map any thrown error to a safe JSON response. Never echoes secrets or stack traces. */
export function handleRouteError(err: unknown, context: string) {
  if (err instanceof ApiError) return jsonError(err.status, err.code, err.message, err.details);
  if (err instanceof ZodError) {
    return jsonError(400, "invalid_request", "Request validation failed.", err.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  if (err instanceof ConfigError) return jsonError(503, "not_configured", err.message);

  if (err instanceof DatabaseError) {
    console.error(`[${context}] database error ${err.code ?? ""}: ${err.message}`);
    const missingTable = err.code === "42P01" || err.code === "PGRST205";
    return jsonError(
      503,
      "database_unavailable",
      missingTable
        ? "The incidents table does not exist. Run supabase/migrations/0001_incidents.sql, then npm run seed."
        : "The incident database is currently unavailable. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  const name = err instanceof Error ? err.name : "UnknownError";
  console.error(`[${context}] unexpected error: ${name}: ${err instanceof Error ? err.message : ""}`);
  return jsonError(500, "internal_error", "An unexpected error occurred.");
}
