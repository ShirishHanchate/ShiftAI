import { NextResponse } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { extractHandover } from "@/lib/extraction";
import { getIncidentsByIds, listIncidents } from "@/lib/incidents";
import { extractRequestSchema } from "@/lib/validation";

/**
 * Produces a PROPOSED handover draft for human review.
 * This route is read-only: it never modifies incident records.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_json", "Request body must be JSON.");
  }
  const parsed = extractRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      400,
      "invalid_request",
      parsed.error.issues[0]?.message ?? "Invalid request.",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }

  try {
    const { transcript, incidentIds } = parsed.data;
    let candidates;
    if (incidentIds?.length) {
      const unique = [...new Set(incidentIds)];
      candidates = await getIncidentsByIds(unique);
      const found = new Set(candidates.map((c) => c.id));
      const missing = unique.filter((id) => !found.has(id));
      if (missing.length) return jsonError(404, "incident_not_found", `Unknown incident ID(s): ${missing.join(", ")}`);
    } else {
      candidates = await listIncidents();
    }

    const draft = await extractHandover(transcript, candidates);
    return NextResponse.json({ draft });
  } catch (err) {
    return handleRouteError(err, "POST /api/handovers/extract");
  }
}
