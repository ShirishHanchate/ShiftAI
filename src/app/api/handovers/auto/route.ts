import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRouteError, jsonError } from "@/lib/api";
import { generateAutoHandover } from "@/lib/auto-handover";

const bodySchema = z.object({ windowHours: z.number().int().min(1).max(72).default(12) });

/** Generates a read-only handover from existing records (tickets, history, emails). Never writes. */
export async function POST(request: Request) {
  let raw: unknown = {};
  try {
    const text = await request.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    return jsonError(400, "invalid_json", "Request body must be JSON.");
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return jsonError(400, "invalid_request", "windowHours must be an integer between 1 and 72.");
  try {
    const handover = await generateAutoHandover(parsed.data.windowHours);
    return NextResponse.json({ handover });
  } catch (err) {
    return handleRouteError(err, "POST /api/handovers/auto");
  }
}
