import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Circle,
  CircleCheck,
  Clock,
  History,
  Mic,
  Server,
  User,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { SetupNotice } from "@/components/layout/setup-notice";
import { SampleDataBadge, SeverityBadge, StatusBadge } from "@/components/incidents/badges";
import { getIncidentById } from "@/lib/incidents";
import { incidentIdSchema } from "@/lib/validation";
import { formatUtc, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Incident } from "@/types/incident";
import { connection } from "next/server";
import { requestTime } from "@/lib/time";
import { getAuditForIncident } from "@/lib/handovers";
import { AuditTrail } from "@/components/incidents/audit-trail";
import type { AuditEntry } from "@/types/handover";

export async function generateMetadata({ params }: PageProps<"/incidents/[id]">) {
  const { id } = await params;
  return { title: `${id.toUpperCase()} · ShiftSync AI` };
}

export default async function IncidentPage({ params }: PageProps<"/incidents/[id]">) {
  await connection();
  const { id } = await params;
  const parsed = incidentIdSchema.safeParse(id.toUpperCase());
  if (!parsed.success) notFound();

  let incident: Incident | null;
  try {
    incident = await getIncidentById(parsed.data);
  } catch (err) {
    return (
      <PageBody>
        <SetupNotice error={err} />
      </PageBody>
    );
  }
  if (!incident) notFound();

  // Audit trail is secondary: show the incident even if it cannot be loaded.
  const audit: AuditEntry[] | null = await getAuditForIncident(incident.id).catch(() => null);
  const now = requestTime();
  const pending = incident.pendingActions.filter((a) => a.status === "pending");
  const completedFollowUps = incident.pendingActions.filter((a) => a.status === "completed");

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3" /> All incidents
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-muted-foreground">{incident.id}</span>
            <span>{incident.title}</span>
          </span>
        }
        description={
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <SeverityBadge severity={incident.severity} />
            <StatusBadge status={incident.status} />
            {incident.isSampleData && <SampleDataBadge />}
          </span>
        }
        actions={
          <Link
            href={`/handover?incident=${incident.id}`}
            className={cn(buttonVariants({ variant: "outline" }), "h-9 gap-2")}
          >
            <Mic className="size-4" /> Hand over this incident
          </Link>
        }
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="flex min-w-0 flex-col gap-6">
            <Panel title="Current situation">
              <p className="text-sm leading-relaxed">{incident.summary || "No summary recorded."}</p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{incident.description}</p>
            </Panel>

            <div className="grid gap-6 md:grid-cols-2">
              <Panel title="Actions completed" count={incident.actionsCompleted.length}>
                {incident.actionsCompleted.length ? (
                  <ul className="space-y-2">
                    {incident.actionsCompleted.map((a, idx) => (
                      <li key={idx} className="flex gap-2 text-sm">
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                        {a}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>No completed actions recorded.</Empty>
                )}
              </Panel>

              <Panel title="Blockers" count={incident.blockers.length} tone={incident.blockers.length ? "warn" : undefined}>
                {incident.blockers.length ? (
                  <ul className="space-y-2">
                    {incident.blockers.map((b, idx) => (
                      <li key={idx} className="flex gap-2 text-sm">
                        <Ban className="mt-0.5 size-4 shrink-0 text-red-600" />
                        {b}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>No blockers reported.</Empty>
                )}
              </Panel>
            </div>

            <Panel title="Pending actions" count={pending.length}>
              {incident.pendingActions.length ? (
                <ul className="divide-y">
                  {[...pending, ...completedFollowUps].map((a, idx) => {
                    const overdue = a.status === "pending" && a.dueAt && new Date(a.dueAt).getTime() < now;
                    return (
                      <li key={idx} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                        {a.status === "completed" ? (
                          <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                        ) : (
                          <Circle className="mt-0.5 size-4 shrink-0 text-violet-500" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className={cn("text-sm", a.status === "completed" && "text-muted-foreground line-through")}>
                            {a.description}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <User className="size-3" />
                              {a.owner ?? <em>Owner unknown</em>}
                            </span>
                            <span className={cn("inline-flex items-center gap-1", overdue && "font-medium text-red-600")}>
                              <Clock className="size-3" />
                              {a.dueAt ? `${formatUtc(a.dueAt)} (${relativeTime(a.dueAt, now)})` : <em>No due time</em>}
                            </span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Empty>No pending actions.</Empty>
              )}
            </Panel>

            <Panel title="Confirmed change history" count={audit?.length}>
              {audit ? (
                <AuditTrail entries={audit} />
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  Audit trail unavailable — run supabase/migrations/0002_handovers_audit.sql.
                </p>
              )}
            </Panel>

            <Panel title="Update history" icon={<History className="size-4 text-muted-foreground" />}>
              {incident.updateHistory.length ? (
                <ol className="relative ml-1.5 space-y-4 border-l pl-5">
                  {incident.updateHistory.map((h, idx) => (
                    <li key={idx} className="relative">
                      <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-card bg-primary ring-1 ring-primary/30" />
                      <p className="text-sm">{h.note}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {h.author} · {formatUtc(h.at)} · <span className="capitalize">{h.source}</span>
                        {h.handoverId && (
                          <>
                            {" · "}
                            <Link href={`/handovers/${h.handoverId}`} className="text-primary hover:underline">
                              view handover
                            </Link>
                          </>
                        )}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <Empty>No updates recorded.</Empty>
              )}
            </Panel>
          </div>

          <aside className="flex flex-col gap-4">
            <Panel title="Details">
              <dl className="space-y-3 text-sm">
                <Detail icon={<Server className="size-3.5" />} label="Affected service">
                  <span className="font-mono text-xs">{incident.affectedService}</span>
                </Detail>
                <Detail icon={<User className="size-3.5" />} label="Incident owner">
                  {incident.owner ?? <span className="text-muted-foreground italic">Unassigned</span>}
                </Detail>
                <Detail icon={<Clock className="size-3.5" />} label="Next update due">
                  {incident.nextUpdateAt ? (
                    <>
                      {formatUtc(incident.nextUpdateAt)}
                      <span className="block text-xs text-muted-foreground">{relativeTime(incident.nextUpdateAt, now)}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground italic">Not scheduled</span>
                  )}
                </Detail>
                <Detail label="Opened">{formatUtc(incident.createdAt)}</Detail>
                <Detail label="Last updated">
                  {formatUtc(incident.updatedAt)}
                  <span className="block text-xs text-muted-foreground">{relativeTime(incident.updatedAt, now)}</span>
                </Detail>
              </dl>
            </Panel>
          </aside>
        </div>
      </PageBody>
    </>
  );
}

function Panel({
  title,
  count,
  icon,
  tone,
  children,
}: {
  title: string;
  count?: number;
  icon?: React.ReactNode;
  tone?: "warn";
  children: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-xl bg-card p-4 ring-1 ring-foreground/10", tone === "warn" && "ring-red-200")}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
        {count !== undefined && (
          <span className="rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground tabular-nums">{count}</span>
        )}
      </h2>
      {children}
    </section>
  );
}

function Detail({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground italic">{children}</p>;
}
