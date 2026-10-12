import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { ArrowLeft, CheckCircle2, Lightbulb, XCircle } from "lucide-react";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { SetupNotice } from "@/components/layout/setup-notice";
import { AuditTrail } from "@/components/incidents/audit-trail";
import { getAuditForHandover, getHandover } from "@/lib/handovers";
import { formatUtc } from "@/lib/format";
import type { AuditEntry, HandoverRecord } from "@/types/handover";

export const metadata = { title: "Handover · ShiftSync AI" };

async function load(id: string): Promise<{ handover: HandoverRecord | null; audit: AuditEntry[] } | { error: unknown }> {
  try {
    const [handover, audit] = await Promise.all([getHandover(id), getAuditForHandover(id)]);
    return { handover, audit };
  } catch (error) {
    return { error };
  }
}

export default async function HandoverDetailPage({ params }: PageProps<"/handovers/[id]">) {
  await connection();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const result = await load(id);
  if ("error" in result) {
    return (
      <PageBody>
        <SetupNotice error={result.error} />
      </PageBody>
    );
  }
  const { handover: h, audit } = result;
  if (!h) notFound();

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/handovers" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3" /> Handover log
          </Link>
        }
        title={`${h.outgoingShift} → ${h.incomingShift}`}
        description={`Confirmed ${formatUtc(h.createdAt)}${h.submittedBy ? ` by ${h.submittedBy}` : ""} · ID ${h.id}`}
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="flex min-w-0 flex-col gap-6">
            <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <h2 className="mb-3 text-sm font-semibold">Review decisions</h2>
              <ul className="space-y-3">
                {h.review.map((r, idx) => (
                  <li key={idx} className="rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      {r.decision === "approve" ? (
                        <CheckCircle2 className="size-4 text-emerald-600" />
                      ) : (
                        <XCircle className="size-4 text-muted-foreground" />
                      )}
                      <span className="font-medium capitalize">{r.decision === "approve" ? "Approved" : "Rejected"}</span>
                      {r.incidentId ? (
                        <Link href={`/incidents/${r.incidentId}`} className="font-mono text-xs hover:underline">
                          {r.incidentId}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">unmatched: “{r.mentionedAs}”</span>
                      )}
                      {r.changedFields && (
                        <span className="text-xs text-muted-foreground">
                          {r.changedFields.length ? `changed: ${r.changedFields.join(", ")}` : "no field changes"}
                        </span>
                      )}
                    </div>
                    {r.missingFields && r.missingFields.length > 0 && (
                      <p className="mt-1.5 text-xs text-amber-800">Missing at handover: {r.missingFields.join(", ")}</p>
                    )}
                    {r.unresolvedQuestions && r.unresolvedQuestions.length > 0 && (
                      <ul className="mt-1.5 list-disc pl-5 text-xs">
                        {r.unresolvedQuestions.map((q, i) => (
                          <li key={i}>{q}</li>
                        ))}
                      </ul>
                    )}
                    {r.recommendations && r.recommendations.length > 0 && (
                      <div className="mt-2 rounded-md bg-blue-50/60 p-2 text-xs text-blue-950">
                        <p className="mb-0.5 flex items-center gap-1 font-medium">
                          <Lightbulb className="size-3" /> AI recommendations (not applied)
                        </p>
                        <ul className="list-disc pl-4">
                          {r.recommendations.map((x, i) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <h2 className="mb-3 text-sm font-semibold">Applied changes (audit)</h2>
              <AuditTrail entries={audit} showIncident />
            </section>
          </div>
          <aside className="flex flex-col gap-4">
            <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <h2 className="mb-2 text-sm font-semibold">Original transcript</h2>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{h.originalTranscript}</p>
            </section>
            {h.editedTranscript && (
              <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
                <h2 className="mb-2 text-sm font-semibold">Edited transcript (used for extraction)</h2>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{h.editedTranscript}</p>
              </section>
            )}
          </aside>
        </div>
      </PageBody>
    </>
  );
}
