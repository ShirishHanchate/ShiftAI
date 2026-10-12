import { NextResponse } from "next/server";
import { connection } from "next/server";
import { handleRouteError } from "@/lib/api";
import { loadCurrentBriefing } from "@/lib/briefing-data";

export async function GET() {
  await connection();
  try {
    const briefing = await loadCurrentBriefing();
    return NextResponse.json({ briefing }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return handleRouteError(err, "GET /api/briefings/current");
  }
}
