import { NextResponse } from "next/server";
import { getIncidentById } from "@/lib/incidents";
import { incidentIdSchema } from "@/lib/validation";
import { handleRouteError, jsonError } from "@/lib/api";

export async function GET(_request: Request, ctx: RouteContext<"/api/incidents/[id]">) {
  const { id } = await ctx.params;
  const parsed = incidentIdSchema.safeParse(id.toUpperCase());
  if (!parsed.success) return jsonError(400, "invalid_id", parsed.error.issues[0].message);
  try {
    const incident = await getIncidentById(parsed.data);
    if (!incident) return jsonError(404, "not_found", `Incident ${parsed.data} was not found.`);
    return NextResponse.json({ incident });
  } catch (err) {
    return handleRouteError(err, "GET /api/incidents/[id]");
  }
}
