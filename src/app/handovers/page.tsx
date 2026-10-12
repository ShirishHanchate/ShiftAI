import Link from "next/link";
import { connection } from "next/server";
import { ChevronRight, ClipboardList, Mic } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { SetupNotice } from "@/components/layout/setup-notice";
import { listHandovers } from "@/lib/handovers";
import { formatUtc } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HandoverSummary } from "@/types/handover";

export const metadata = { title: "Handover Log · ShiftSync AI" };

async function load(): Promise<{ handovers: HandoverSummary[] } | { error: unknown }> {
  try {
    return { handovers: await listHandovers(100) };
  } catch (error) {
    return { error };
  }
}

export default async function HandoversPage() {
  await connection();
  const result = await load();

  return (
    <>
      <PageHeader
        title="Handover Log"
        description="Every confirmed shift handover, with its original transcript and the changes it applied."
        actions={
          <Link href="/handover" className={cn(buttonVariants(), "h-9 gap-2")}>
            <Mic className="size-4" /> New handover
          </Link>
        }
      />
      <PageBody>
        {"error" in result ? (
          <SetupNotice error={result.error} />
        ) : result.handovers.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl bg-card px-4 py-16 text-center ring-1 ring-foreground/10">
            <ClipboardList className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">No handovers yet</p>
            <p className="text-xs text-muted-foreground">Confirmed handovers will appear here.</p>
          </div>
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
            {result.handovers.map((h) => (
              <li key={h.id}>
                <Link href={`/handovers/${h.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/40">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {h.outgoingShift} <span className="text-muted-foreground">→</span> {h.incomingShift}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatUtc(h.createdAt)}
                      {h.submittedBy ? ` · ${h.submittedBy}` : ""} · {h.approvedIncidentIds.length} approved ·{" "}
                      {h.rejectedIncidentIds.length} rejected
                    </p>
                  </div>
                  <div className="hidden flex-wrap justify-end gap-1 sm:flex">
                    {h.approvedIncidentIds.map((id) => (
                      <span key={id} className="rounded bg-emerald-50 px-1.5 font-mono text-[11px] text-emerald-700">
                        {id}
                      </span>
                    ))}
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      h.status === "confirmed" ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {h.status === "confirmed" ? "Confirmed" : "No changes"}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}
