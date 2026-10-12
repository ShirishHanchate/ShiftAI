import "server-only";
import { buildBriefing } from "./briefing";
import { listIncidents } from "./incidents";
import { listRecentHandoverRecords } from "./handovers";
import type { Briefing } from "@/types/briefing";

/** Builds the current briefing from persisted incidents and confirmed handovers only. */
export async function loadCurrentBriefing(nowMs: number = Date.now()): Promise<Briefing> {
  const [incidents, handovers] = await Promise.all([listIncidents(), listRecentHandoverRecords(10)]);
  return buildBriefing(incidents, handovers, nowMs);
}
