import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleRouteError, jsonError } from "@/lib/api";
import { listHandovers } from "@/lib/handovers";

const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) return jsonError(400, "invalid_query", "limit must be an integer between 1 and 200.");
  try {
    const handovers = await listHandovers(parsed.data.limit);
    return NextResponse.json({ handovers, count: handovers.length });
  } catch (err) {
    return handleRouteError(err, "GET /api/handovers");
  }
}
