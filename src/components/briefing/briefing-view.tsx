"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlarmClock,
  Ban,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleAlert,
  Clock,
  History,
  Lightbulb,
  Loader2,
  RefreshCw,
  Search,
  SearchX,
  User,
  UserX,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SeverityBadge, SeverityDot, StatusBadge } from "@/components/incidents/badges";
import { formatUtc, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SEVERITIES, STATUSES } from "@/types/incident";
import type { Briefing, BriefingIncident } from "@/types/briefing";
import { AutoHandoverPanel } from "./auto-handover-panel";

const ALL = "all";
const UNASSIGNED = "__unassigned__";
const severityItems = { [ALL]: "All severities", ...Object.fromEntries(SEVERITIES.map((s) => [s, s])) };
const statusItems = { [ALL]: "All statuses", ...Object.fromEntries(STATUSES.filter((s) => s !== "Resolved").map((s) => [s, s])) };
const pendingItems = {
  [ALL]: "Any actions",
  overdue: "Overdue actions / follow-ups",
  has: "Has pending actions",
  none: "No next action",
  blocked: "Blocked",
};

export function BriefingView({ initial }: { initial: Briefing }) {
  const [briefing, setBriefing] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [severity, setSeverity] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [owner, setOwner] = useState<string>(ALL);
  const [pending, setPending] = useState<string>(ALL);
  const now = Date.parse(briefing.generatedAt);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/briefings/current", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? `Refresh failed (HTTP ${res.status}).`);
      setBriefing(body.briefing);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  const owners = useMemo(() => {
    const set = new Set<string>();
    for (const i of briefing.incidents) {
      if (i.owner) set.add(i.owner);
      for (const a of i.pendingActions) if (a.owner) set.add(a.owner);
    }
    return [...set].sort();
  }, [briefing]);
  const ownerItems = { [ALL]: "All owners", [UNASSIGNED]: "Unassigned", ...Object.fromEntries(owners.map((o) => [o, o])) };

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return briefing.incidents.filter((i) => {
      if (severity !== ALL && i.severity !== severity) return false;
      if (status !== ALL && i.status !== status) return false;
      if (owner === UNASSIGNED && i.owner) return false;
      if (owner !== ALL && owner !== UNASSIGNED && i.owner !== owner && !i.pendingActions.some((a) => a.owner === owner)) return false;
      if (pending === "overdue" && !(i.followUpOverdue || i.pendingActions.some((a) => a.overdue))) return false;
      if (pending === "has" && i.pendingActions.length === 0) return false;
      if (pending === "none" && i.nextAction) return false;
      if (pending === "blocked" && i.blockers.length === 0) return false;
      if (term) {
        const hay = [i.id, i.title, i.affectedService, i.owner ?? "", i.summary, ...i.pendingActions.map((a) => a.description), ...i.blockers]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [briefing, q, severity, status, owner, pending]);

  const filtersActive = q || severity !== ALL || status !== ALL || owner !== ALL || pending !== ALL;
  const s = briefing.stats;

  return (
    <div className="flex flex-col gap-6">
      {/* Top strip */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Built {formatUtc(briefing.generatedAt)} from confirmed records only.</span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={refresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refresh
        </Button>
      </div>
      {error && <div className="rounded-lg bg-destructive/5 px-4 py-2.5 text-sm text-destructive">{error}</div>}

      <AutoHandoverPanel />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Active" value={s.active} />
        <Stat label="SEV1 / SEV2" value={`${s.sev1} / ${s.sev2}`} tone={s.sev1 ? "red" : undefined} />
        <Stat label="Pending actions" value={s.pendingActions} />
        <Stat label="Overdue" value={s.overdueFollowUps + s.overdueActions} hint="follow-ups + actions" tone={s.overdueFollowUps + s.overdueActions ? "red" : undefined} />
        <Stat label="Blocked" value={s.blocked} tone={s.blocked ? "amber" : undefined} />
        <Stat label="Gaps" value={s.withoutOwner + s.withoutNextAction} hint="no owner / no next action" tone={s.withoutOwner + s.withoutNextAction ? "amber" : undefined} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Priority list */}
        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-2 rounded-xl bg-card p-3 ring-1 ring-foreground/10 md:flex-row md:flex-wrap md:items-center">
            <div className="relative md:w-60">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search briefing…" className="pl-8" aria-label="Search briefing" maxLength={200} />
            </div>
            <FilterSelect items={severityItems} value={severity} onChange={setSeverity} label="Severity" />
            <FilterSelect items={statusItems} value={status} onChange={setStatus} label="Status" />
            <FilterSelect items={ownerItems} value={owner} onChange={setOwner} label="Owner" />
            <FilterSelect items={pendingItems} value={pending} onChange={setPending} label="Actions" wide />
            {filtersActive && (
              <Button
                variant="ghost"
                onClick={() => {
                  setQ("");
                  setSeverity(ALL);
                  setStatus(ALL);
                  setOwner(ALL);
                  setPending(ALL);
                }}
              >
                <X /> Clear
              </Button>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl bg-card px-4 py-14 text-center ring-1 ring-foreground/10">
              <SearchX className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">{briefing.incidents.length ? "No incidents match these filters" : "No active incidents"}</p>
              <p className="text-xs text-muted-foreground">{briefing.incidents.length ? "Clear the filters to see everything." : "Quiet shift — nothing to hand over."}</p>
            </div>
          ) : (
            SEVERITIES.map((sev) => {
              const group = filtered.filter((i) => i.severity === sev);
              if (!group.length) return null;
              return (
                <div key={sev} className="flex flex-col gap-3">
                  <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                    <SeverityDot severity={sev} /> {sev} · {group.length}
                  </h2>
                  {group.map((i) => (
                    <IncidentBriefCard key={i.id} incident={i} now={now} />
                  ))}
                </div>
              );
            })
          )}
        </section>

        {/* Side rail */}
        <aside className="flex flex-col gap-4">
          <LatestHandover briefing={briefing} />
          <RailList
            title="Overdue follow-ups"
            icon={<AlarmClock className="size-4 text-red-600" />}
            empty="None — no recorded follow-up is past due."
            items={briefing.overdueFollowUps.map((f) => ({ id: f.incidentId, primary: f.title, secondary: `Was due ${relativeTime(f.at, now)}`, tone: "red" as const }))}
          />
          <RailList
            title="Upcoming follow-ups (12h)"
            icon={<Clock className="size-4 text-blue-600" />}
            empty="No follow-ups scheduled in the next 12 hours."
            items={briefing.upcomingFollowUps.map((f) => ({ id: f.incidentId, primary: f.title, secondary: `${formatUtc(f.at)} · ${relativeTime(f.at, now)}` }))}
          />
          <RailList
            title="Blockers & dependencies"
            icon={<Ban className="size-4 text-red-600" />}
            empty="No blockers recorded."
            items={briefing.blockers.map((b) => ({ id: b.incidentId, primary: b.blocker, secondary: b.incidentTitle }))}
          />
          <RailList
            title="Without an owner"
            icon={<UserX className="size-4 text-amber-600" />}
            empty="Every active incident has an owner."
            items={briefing.withoutOwner.map((id) => ({ id, primary: briefing.incidents.find((i) => i.id === id)?.title ?? id, secondary: "Owner not recorded" }))}
          />
          <RailList
            title="Without a clear next action"
            icon={<CircleAlert className="size-4 text-amber-600" />}
            empty="Every active incident has a pending action."
            items={briefing.withoutNextAction.map((id) => ({ id, primary: briefing.incidents.find((i) => i.id === id)?.title ?? id, secondary: "No pending action recorded" }))}
          />
          <RailList
            title="Recently updated"
            icon={<History className="size-4 text-muted-foreground" />}
            empty="No updates."
            items={briefing.recentlyUpdated.map((r) => ({ id: r.id, primary: r.note ?? r.title, secondary: `${r.status} · ${relativeTime(r.updatedAt, now)}` }))}
          />
        </aside>
      </div>
    </div>
  );
}

function IncidentBriefCard({ incident: i, now }: { incident: BriefingIncident; now: number }) {
  return (
    <article className={cn("rounded-xl bg-card ring-1", i.severity === "SEV1" ? "ring-red-200" : "ring-foreground/10")}>
      <header className="flex flex-col gap-1.5 border-b p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums" title="Priority rank">
            {i.priorityRank}
          </span>
          <SeverityBadge severity={i.severity} />
          <StatusBadge status={i.status} />
          <Link href={`/incidents/${i.id}`} className="font-mono text-xs font-semibold hover:underline">
            {i.id}
          </Link>
          <Link href={`/incidents/${i.id}`} className="ml-auto inline-flex items-center gap-0.5 text-xs text-primary hover:underline">
            Details & history <ChevronRight className="size-3" />
          </Link>
        </div>
        <h3 className="text-sm font-semibold">{i.title}</h3>
        <p className="text-[11px] text-muted-foreground">Priority: {i.priorityReasons.join(" · ")}</p>
      </header>

      <div className="grid gap-4 p-4 text-sm md:grid-cols-2">
        {/* Facts */}
        <div className="flex flex-col gap-3">
          <Label tag="Confirmed facts">Latest confirmed update</Label>
          {i.latestUpdate ? (
            <div>
              <p>{i.latestUpdate.note}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {i.latestUpdate.author} · {formatUtc(i.latestUpdate.at)}
                {i.latestUpdate.handoverId && (
                  <>
                    {" · "}
                    <Link href={`/handovers/${i.latestUpdate.handoverId}`} className="text-primary hover:underline">
                      handover
                    </Link>
                  </>
                )}
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground italic">No updates recorded.</p>
          )}
          {i.summary && <p className="text-xs text-muted-foreground">{i.summary}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1">
              <User className="size-3" /> {i.owner ?? <em className="text-amber-700">no owner</em>}
            </span>
            <span className={cn("inline-flex items-center gap-1", i.followUpOverdue && "font-medium text-red-600")}>
              <Clock className="size-3" />
              {i.nextUpdateAt ? `Next update ${formatUtc(i.nextUpdateAt)} (${relativeTime(i.nextUpdateAt, now)})` : <em className="text-amber-700">no follow-up time</em>}
            </span>
          </div>
          {i.completed.length > 0 && (
            <div>
              <Label>Troubleshooting completed</Label>
              <ul className="space-y-1">
                {i.completed.slice(-4).map((c, idx) => (
                  <li key={idx} className="flex gap-1.5 text-xs">
                    <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-600" /> {c}
                  </li>
                ))}
                {i.completed.length > 4 && <li className="text-xs text-muted-foreground">+{i.completed.length - 4} earlier</li>}
              </ul>
            </div>
          )}
          {i.blockers.length > 0 && (
            <div>
              <Label>Blockers</Label>
              <ul className="space-y-1">
                {i.blockers.map((b, idx) => (
                  <li key={idx} className="flex gap-1.5 text-xs text-red-700">
                    <Ban className="mt-0.5 size-3 shrink-0" /> {b}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Actions + gaps + AI */}
        <div className="flex flex-col gap-3">
          <Label tag="Outstanding">Next action</Label>
          {i.nextAction ? (
            <div className="rounded-lg bg-violet-50/70 p-2.5">
              <p className="font-medium">{i.nextAction.description}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {i.nextAction.owner ?? "owner unknown"} ·{" "}
                <span className={cn(i.nextAction.overdue && "font-medium text-red-600")}>
                  {i.nextAction.dueAt ? `${i.nextAction.overdue ? "overdue, was due" : "due"} ${formatUtc(i.nextAction.dueAt)}` : "no due time"}
                </span>
              </p>
            </div>
          ) : (
            <p className="text-amber-700 italic">No next action recorded.</p>
          )}
          {i.pendingActions.length > 1 && (
            <ul className="space-y-1">
              {i.pendingActions.slice(1).map((a, idx) => (
                <li key={idx} className="flex gap-1.5 text-xs">
                  <Circle className="mt-0.5 size-3 shrink-0 text-violet-500" />
                  <span>
                    {a.description}
                    <span className="text-muted-foreground">
                      {" "}
                      · {a.owner ?? "owner unknown"} ·{" "}
                      <span className={cn(a.overdue && "font-medium text-red-600")}>{a.dueAt ? formatUtc(a.dueAt) : "no due time"}</span>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {i.missingInformation.length > 0 && (
            <div>
              <Label tag="Missing">Missing information</Label>
              <div className="flex flex-wrap gap-1">
                {i.missingInformation.map((m) => (
                  <span key={m} className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-900 ring-1 ring-amber-200 ring-inset">
                    {m}
                  </span>
                ))}
              </div>
            </div>
          )}
          {i.aiRecommendations.length > 0 && (
            <div className="rounded-lg bg-blue-50/60 p-2.5 text-xs text-blue-950">
              <p className="mb-0.5 flex items-center gap-1 font-medium">
                <Lightbulb className="size-3" /> AI recommendations (unconfirmed)
              </p>
              <ul className="list-disc pl-4">
                {i.aiRecommendations.map((r, idx) => (
                  <li key={idx}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function LatestHandover({ briefing }: { briefing: Briefing }) {
  const h = briefing.latestHandover;
  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <h3 className="mb-2 text-sm font-semibold">Latest confirmed handover</h3>
      {h ? (
        <div className="text-sm">
          <p className="font-medium">
            {h.outgoingShift} → {h.incomingShift}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatUtc(h.createdAt)}
            {h.submittedBy ? ` · ${h.submittedBy}` : ""}
          </p>
          <p className="mt-2 text-xs">
            {h.approvedIncidentIds.length} approved: {h.approvedIncidentIds.join(", ") || "—"}
          </p>
          <Link href={`/handovers/${h.id}`} className="mt-2 inline-block text-xs text-primary hover:underline">
            View transcript & changes →
          </Link>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">No handover has been confirmed yet.</p>
      )}
    </section>
  );
}

function RailList({
  title,
  icon,
  items,
  empty,
}: {
  title: string;
  icon: React.ReactNode;
  items: { id: string; primary: string; secondary: string; tone?: "red" }[];
  empty: string;
}) {
  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        {icon} {title}
        <span className="rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground tabular-nums">{items.length}</span>
      </h3>
      {items.length ? (
        <ul className="space-y-2">
          {items.map((it, idx) => (
            <li key={`${it.id}-${idx}`}>
              <Link href={`/incidents/${it.id}`} className="block rounded-md hover:bg-muted/50">
                <p className="text-xs">
                  <span className="font-mono font-semibold">{it.id}</span> · {it.primary}
                </p>
                <p className={cn("text-[11px] text-muted-foreground", it.tone === "red" && "font-medium text-red-600")}>{it.secondary}</p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

function FilterSelect({
  items,
  value,
  onChange,
  label,
  wide,
}: {
  items: Record<string, string>;
  value: string;
  onChange: (v: string) => void;
  label: string;
  wide?: boolean;
}) {
  return (
    <Select items={items} value={value} onValueChange={(v) => onChange(v ?? ALL)}>
      <SelectTrigger className={cn("w-full", wide ? "md:w-52" : "md:w-36")} aria-label={`Filter by ${label.toLowerCase()}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(items).map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "red" | "amber" }) {
  return (
    <div className="rounded-xl bg-card p-3 ring-1 ring-foreground/10">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-2xl font-semibold tabular-nums", tone === "red" && "text-red-600", tone === "amber" && "text-amber-600")}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Label({ children, tag }: { children: React.ReactNode; tag?: string }) {
  return (
    <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      {children}
      {tag && <span className="rounded bg-muted px-1 text-[9px] tracking-wider">{tag}</span>}
    </p>
  );
}

