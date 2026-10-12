import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { formatUtc } from "@/lib/format";
import type { AuditEntry } from "@/types/handover";

const LABELS: Record<string, string> = {
  status: "Status",
  summary: "Situation",
  owner: "Owner",
  nextUpdateAt: "Next update",
  actionsCompleted: "Actions completed",
  pendingActions: "Pending actions",
  blockers: "Blockers",
};

type Pending = { description: string; status: string; owner?: string | null };

function scalar(field: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (field === "nextUpdateAt") return formatUtc(String(v));
  return String(v);
}

function listDiff(prev: unknown, next: unknown): { added: string[]; removed: string[] } {
  const p = (Array.isArray(prev) ? prev : []) as string[];
  const n = (Array.isArray(next) ? next : []) as string[];
  return { added: n.filter((x) => !p.includes(x)), removed: p.filter((x) => !n.includes(x)) };
}

function pendingDiff(prev: unknown, next: unknown): string[] {
  const p = (Array.isArray(prev) ? prev : []) as Pending[];
  const n = (Array.isArray(next) ? next : []) as Pending[];
  const lines: string[] = [];
  for (const a of n) {
    const before = p.find((x) => x.description === a.description);
    if (!before) lines.push(`+ ${a.description}${a.owner ? ` (${a.owner})` : ""}`);
    else if (before.status !== a.status) lines.push(`✓ ${a.description} → ${a.status}`);
  }
  return lines;
}

export function AuditTrail({ entries, showIncident = false }: { entries: AuditEntry[]; showIncident?: boolean }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No confirmed handover changes yet.</p>;
  }
  return (
    <ol className="space-y-4">
      {entries.map((e) => (
        <li key={e.id} className="rounded-lg border p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 text-emerald-600" />
            <span className="font-medium text-foreground">Confirmed</span>
            <span>{formatUtc(e.createdAt)}</span>
            {showIncident && (
              <Link href={`/incidents/${e.incidentId}`} className="font-mono hover:underline">
                {e.incidentId}
              </Link>
            )}
            <Link href={`/handovers/${e.handoverId}`} className="ml-auto text-primary hover:underline">
              Handover {e.handoverId.slice(0, 8)}
            </Link>
          </div>
          <dl className="space-y-1.5 text-sm">
            {e.changedFields.map((f) => {
              const prev = e.previousValues[f];
              const next = e.newValues[f];
              let body: React.ReactNode;
              if (f === "pendingActions") {
                body = pendingDiff(prev, next).map((l) => <div key={l}>{l}</div>);
              } else if (f === "actionsCompleted" || f === "blockers") {
                const d = listDiff(prev, next);
                body = (
                  <>
                    {d.added.map((x) => (
                      <div key={`a-${x}`}>+ {x}</div>
                    ))}
                    {d.removed.map((x) => (
                      <div key={`r-${x}`} className="text-muted-foreground line-through">
                        {x}
                      </div>
                    ))}
                  </>
                );
              } else {
                body = (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground line-through">{scalar(f, prev)}</span>
                    <ArrowRight className="size-3 text-muted-foreground" />
                    <span>{scalar(f, next)}</span>
                  </span>
                );
              }
              return (
                <div key={f} className="grid gap-1 sm:grid-cols-[140px_1fr]">
                  <dt className="text-xs font-medium text-muted-foreground">{LABELS[f] ?? f}</dt>
                  <dd className="min-w-0 break-words">{body}</dd>
                </div>
              );
            })}
          </dl>
        </li>
      ))}
    </ol>
  );
}
