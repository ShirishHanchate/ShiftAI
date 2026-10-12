import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRouteError, jsonError } from "@/lib/api";
import { getAuditForHandover, getHandover } from "@/lib/handovers";

export async function GET(_request: Request, ctx: RouteContext<"/api/handovers/[id]">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return jsonError(400, "invalid_id", "Handover ID must be a UUID.");
  try {
    const handover = await getHandover(id);
    if (!handover) return jsonError(404, "not_found", `Handover ${id} was not found.`);
    const audit = await getAuditForHandover(id);
    return NextResponse.json({ handover, audit });
  } catch (err) {
    return handleRouteError(err, "GET /api/handovers/[id]");
  }
}
