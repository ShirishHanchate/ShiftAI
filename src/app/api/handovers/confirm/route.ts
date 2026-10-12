import { NextResponse } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { confirmHandover } from "@/lib/handovers";
import { confirmRequestSchema } from "@/lib/validation";

/**
 * Persists ONLY the incident updates the reviewer approved, atomically, with an
 * audit trail. Idempotent per `idempotencyKey`: retries return the original result.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_json", "Request body must be JSON.");
  }
  const parsed = confirmRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      400,
      "invalid_request",
      parsed.error.issues[0]?.message ?? "Invalid request.",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  try {
    const result = await confirmHandover(parsed.data);
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (err) {
    return handleRouteError(err, "POST /api/handovers/confirm");
  }
}
