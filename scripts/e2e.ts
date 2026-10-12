/**
 * LIVE end-to-end check against the running app (real Supabase + real Sarvam):
 * transcript → extract → confirm → persisted + audit → duplicate replay → briefing → ask → speak.
 *
 *   npm run dev   # then:
 *   npm run e2e -- [baseUrl]
 */
const base = process.argv[2] ?? "http://localhost:3000";
const TRANSCRIPT =
  "Shift handover from the night shift. First, incident INC 1042, the payments API 500 errors in EU West. Asha rolled back the gateway config " +
  "about 20 minutes ago and the error rate has dropped to around 1%. We are still waiting for the card processor to call us back about the declines. " +
  "Asha will give the next update in 30 minutes. Second, INC 1043, the Kafka order consumer lag. The lag has fully drained, it is under 500 messages now. " +
  "Mei Lin needs to scale the consumers back down to 6 pods, but nobody has done that yet.";

async function call(path: string, init?: RequestInit) {
  const t = Date.now();
  const res = await fetch(`${base}${path}`, init);
  const isJson = res.headers.get("content-type")?.includes("json");
  const body = isJson ? await res.json() : await res.arrayBuffer();
  console.log(`${init?.method ?? "GET"} ${path} → ${res.status} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  if (!res.ok) throw new Error(JSON.stringify(body));
  return body;
}
const postJson = (path: string, body: unknown) =>
  call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

(async () => {
  const before = (await call("/api/incidents/INC-1042")).incident;

  const { draft } = await postJson("/api/handovers/extract", { transcript: TRANSCRIPT });
  console.log(`  matched=${draft.matched.map((m: { incidentId: string }) => m.incidentId).join(",")} unmatched=${draft.unmatched.length}`);
  const after = (await call("/api/incidents/INC-1042")).incident;
  if (after.updatedAt !== before.updatedAt) throw new Error("Extraction modified the incident!");
  console.log("  ✓ extraction did not modify incidents");

  const p1042 = draft.matched.find((m: { incidentId: string }) => m.incidentId === "INC-1042");
  const p1043 = draft.matched.find((m: { incidentId: string }) => m.incidentId === "INC-1043");
  const request = {
    idempotencyKey: crypto.randomUUID(),
    originalTranscript: TRANSCRIPT,
    editedTranscript: TRANSCRIPT,
    outgoingShift: "E2E Night",
    incomingShift: "E2E Morning",
    submittedBy: "E2E test",
    decisions: [
      {
        decision: "approve",
        incidentId: "INC-1042",
        expectedUpdatedAt: p1042.current.updatedAt,
        changes: {
          currentSituation: p1042.currentSituation || null,
          actionsCompletedAdd: p1042.actionsCompleted.filter((a: { evidenceVerified: boolean }) => a.evidenceVerified).map((a: { description: string }) => a.description),
          pendingActionsAdd: p1042.pendingActions.map((a: { description: string; owner: string | null; dueAt: string | null }) => ({ description: a.description, owner: a.owner, dueAt: a.dueAt })),
          completeExistingActions: [],
          blockersAdd: p1042.blockers,
          blockersCleared: [],
          owner: p1042.owner?.value ?? null,
          nextUpdateAt: p1042.nextUpdateAt?.value ?? null,
          status: null,
        },
        recommendations: p1042.recommendations,
        missingFields: p1042.missingFields,
        unresolvedQuestions: p1042.unresolvedQuestions,
      },
      { decision: "reject", incidentId: p1043 ? "INC-1043" : null, mentionedAs: "Kafka lag", reason: "E2E: rejected on purpose" },
    ],
  };
  const r1043Before = (await call("/api/incidents/INC-1043")).incident;
  const confirmed = await postJson("/api/handovers/confirm", request);
  console.log(`  handover=${confirmed.handover.id} applied=${confirmed.appliedIncidentIds.join(",")}`);

  const replay = await postJson("/api/handovers/confirm", request);
  if (!replay.replayed || replay.appliedIncidentIds.length) throw new Error("Duplicate was not replayed safely");
  console.log("  ✓ duplicate submission replayed, nothing re-applied");

  const persisted = (await call("/api/incidents/INC-1042")).incident;
  if (persisted.updatedAt === before.updatedAt) throw new Error("Approved change not persisted");
  if (persisted.updateHistory[0].handoverId !== confirmed.handover.id) throw new Error("History entry missing");
  console.log(`  ✓ INC-1042 persisted: summary="${persisted.summary.slice(0, 70)}…" history=${persisted.updateHistory.length}`);
  const r1043After = (await call("/api/incidents/INC-1043")).incident;
  if (r1043After.updatedAt !== r1043Before.updatedAt) throw new Error("Rejected incident was modified!");
  console.log("  ✓ rejected INC-1043 unchanged");

  const detail = await call(`/api/handovers/${confirmed.handover.id}`);
  console.log(`  ✓ audit entries=${detail.audit.length} fields=${detail.audit[0]?.changedFields.join(",")}; original transcript kept=${detail.handover.originalTranscript === TRANSCRIPT}`);

  const { briefing } = await call("/api/briefings/current");
  console.log(`  ✓ briefing latestHandover=${briefing.latestHandover?.id === confirmed.handover.id} top=${briefing.incidents.slice(0, 3).map((i: { id: string }) => i.id).join(",")}`);

  const answer = await postJson("/api/agent/ask", { question: "What was the last confirmed update for INC-1042 and what is still pending?" });
  console.log(`  agent: ${answer.answer}\n  refs=${answer.incidentIds.join(",")}`);

  const audio = (await postJson("/api/voice/speak", { text: answer.answer })) as ArrayBuffer;
  console.log(`  ✓ TTS audio ${audio.byteLength} bytes`);
  console.log("\nE2E PASSED");
})().catch((e) => {
  console.error("\nE2E FAILED:", e.message);
  process.exit(1);
});
