import { NextResponse, type NextRequest } from "next/server";
import { computeStats, listIncidents } from "@/lib/incidents";
import { incidentListQuerySchema } from "@/lib/validation";
import { handleRouteError, jsonError } from "@/lib/api";

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = incidentListQuerySchema.safeParse(params);
  if (!parsed.success) {
    return jsonError(400, "invalid_query", "Invalid query parameters.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  try {
    const [incidents, all] = await Promise.all([listIncidents(parsed.data), listIncidents()]);
    return NextResponse.json({ incidents, stats: computeStats(all), count: incidents.length });
  } catch (err) {
    return handleRouteError(err, "GET /api/incidents");
  }
}
