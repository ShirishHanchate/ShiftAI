"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2, Search, SearchX, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SeverityBadge, SeverityDot, StatusBadge } from "@/components/incidents/badges";
import { StatCards } from "./stat-cards";
import { relativeTime } from "@/lib/format";
import { SEVERITIES, STATUSES, type Incident, type IncidentStats } from "@/types/incident";

const ALL = "all";
const severityItems = { [ALL]: "All severities", ...Object.fromEntries(SEVERITIES.map((s) => [s, s])) };
const statusItems = { [ALL]: "All statuses", ...Object.fromEntries(STATUSES.map((s) => [s, s])) };

interface Props {
  initialIncidents: Incident[];
  initialStats: IncidentStats;
  /** Server render time, so relative timestamps match between server and client. */
  renderedAt: number;
}

export function IncidentExplorer({ initialIncidents, initialStats, renderedAt }: Props) {
  const router = useRouter();
  const [incidents, setIncidents] = useState(initialIncidents);
  const [stats, setStats] = useState(initialStats);
  const [q, setQ] = useState("");
  const [severity, setSeverity] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(renderedAt);
  const first = useRef(true);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Fetch from the API whenever filters change (debounced for search typing).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (severity !== ALL) params.set("severity", severity);
      if (status !== ALL) params.set("status", status);
      try {
        const res = await fetch(`/api/incidents?${params}`, { signal: controller.signal });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
        setIncidents(body.incidents);
        setStats(body.stats);
        setNow(Date.now());
      } catch (err) {
        if ((err as Error).name !== "AbortError") setError((err as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, q ? 250 : 0);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [q, severity, status]);

  const filtersActive = q || severity !== ALL || status !== ALL;

  return (
    <div className="flex flex-col gap-6">
      <StatCards stats={stats} />

      <section className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
          <div>
            <h2 className="text-sm font-semibold">Incident queue</h2>
            <p className="text-xs text-muted-foreground">
              {incidents.length} incident{incidents.length === 1 ? "" : "s"}
              {filtersActive ? " matching filters" : ""}
            </p>
          </div>
          <div className="flex flex-1 flex-col gap-2 sm:flex-row lg:justify-end">
            <div className="relative sm:w-72">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search ID, title, service, owner…"
                className="pl-8"
                aria-label="Search incidents"
                maxLength={200}
              />
            </div>
            <Select items={severityItems} value={severity} onValueChange={(v) => setSeverity(v ?? ALL)}>
              <SelectTrigger className="w-full sm:w-40" aria-label="Filter by severity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(severityItems).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select items={statusItems} value={status} onValueChange={(v) => setStatus(v ?? ALL)}>
              <SelectTrigger className="w-full sm:w-40" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(statusItems).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filtersActive && (
              <Button
                variant="ghost"
                onClick={() => {
                  setQ("");
                  setSeverity(ALL);
                  setStatus(ALL);
                }}
              >
                <X /> Clear
              </Button>
            )}
          </div>
        </div>

        {error && <div className="border-b bg-destructive/5 px-4 py-2.5 text-sm text-destructive">{error}</div>}

        <div className="relative">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-start justify-center bg-card/60 pt-16 backdrop-blur-[1px]">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {incidents.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-muted">
                <SearchX className="size-5 text-muted-foreground" />
              </span>
              <p className="text-sm font-medium">No incidents found</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                {filtersActive
                  ? "Try a different search term or clear the filters."
                  : "The incident database is empty. Run `npm run seed` to load the fictional sample incidents."}
              </p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="w-28 pl-4">ID</TableHead>
                    <TableHead>Incident</TableHead>
                    <TableHead className="w-32">Status</TableHead>
                    <TableHead className="w-36">Owner</TableHead>
                    <TableHead className="w-24 text-center">Pending</TableHead>
                    <TableHead className="w-36">Next update</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {incidents.map((i) => {
                    const pending = i.pendingActions.filter((a) => a.status === "pending").length;
                    const overdue = i.nextUpdateAt && new Date(i.nextUpdateAt).getTime() < now && i.status !== "Resolved";
                    return (
                      <TableRow
                        key={i.id}
                        className="cursor-pointer"
                        onClick={() => router.push(`/incidents/${i.id}`)}
                      >
                        <TableCell className="pl-4">
                          <div className="flex items-center gap-2">
                            <SeverityDot severity={i.severity} />
                            <Link
                              href={`/incidents/${i.id}`}
                              className="font-mono text-xs font-medium hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {i.id}
                            </Link>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-0 whitespace-normal">
                          <div className="flex items-center gap-2">
                            <SeverityBadge severity={i.severity} />
                            <span className="truncate font-medium">{i.title}</span>
                          </div>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{i.affectedService}</p>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={i.status} />
                        </TableCell>
                        <TableCell className="text-sm">
                          {i.owner ?? <span className="text-muted-foreground italic">Unassigned</span>}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {pending > 0 ? (
                            <span className="inline-flex min-w-6 justify-center rounded-full bg-violet-50 px-1.5 text-xs font-medium text-violet-700">
                              {pending}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell className={overdue ? "text-sm font-medium text-red-600" : "text-sm text-muted-foreground"}>
                          {i.nextUpdateAt ? relativeTime(i.nextUpdateAt, now) : "—"}
                        </TableCell>
                        <TableCell>
                          <ChevronRight className="size-4 text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {/* Mobile cards */}
              <ul className="divide-y md:hidden">
                {incidents.map((i) => (
                  <li key={i.id}>
                    <Link href={`/incidents/${i.id}`} className="flex flex-col gap-1.5 p-4 hover:bg-muted/50">
                      <div className="flex items-center gap-2">
                        <SeverityBadge severity={i.severity} />
                        <span className="font-mono text-xs text-muted-foreground">{i.id}</span>
                        <StatusBadge status={i.status} className="ml-auto" />
                      </div>
                      <p className="text-sm font-medium">{i.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {i.affectedService} · {i.owner ?? "Unassigned"}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
