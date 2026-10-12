"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, Bot, Loader2, Pause, RotateCcw, Sparkles, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SeverityBadge, StatusBadge } from "@/components/incidents/badges";
import { formatUtc } from "@/lib/format";

interface AutoHandover {
  headline: string;
  topPriorities: { incidentId: string; why: string; nextStep: string }[];
  incidents: { incidentId: string; situation: string; doneSoFar: string[]; nextSteps: string[]; blockers: string[]; watchOut: string | null; sources: string[] }[];
  gaps: string[];
  generatedAt: string;
  model: string;
  windowHours: number;
  sourceCounts: { incidents: number; updates: number; communications: number; handovers: number };
  incidentMeta: Record<string, { title: string; severity: "SEV1" | "SEV2" | "SEV3" | "SEV4"; status: "Open" | "Investigating" | "Monitoring" | "Resolved" }>;
}

const WINDOWS = [8, 12, 24];
const CACHE_KEY = "shiftsync:auto-handover";
const CACHE_TTL_MS = 10 * 60 * 1000;

function readCache(hours: number): AutoHandover | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as { at: number; hours: number; data: AutoHandover };
    return c.hours === hours && Date.now() - c.at < CACHE_TTL_MS ? c.data : null;
  } catch {
    return null;
  }
}

function writeCache(hours: number, data: AutoHandover) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), hours, data }));
  } catch {
    /* storage unavailable — fine */
  }
}

function spokenSummary(h: AutoHandover): string {
  const prio = h.topPriorities.map((p, i) => `${i + 1}. ${p.incidentId}: ${p.why}. Next, ${p.nextStep}.`).join(" ");
  return `${h.headline} Top priorities. ${prio}`.slice(0, 2400);
}

/** Plain-text handover the outgoing engineer can edit and run through the normal confirm flow. */
export function toTranscript(h: AutoHandover): string {
  const lines = h.incidents.map((i) => {
    const parts = [`${i.incidentId}: ${i.situation}`];
    if (i.doneSoFar.length) parts.push(`Done: ${i.doneSoFar.join("; ")}.`);
    if (i.nextSteps.length) parts.push(`Next: ${i.nextSteps.join("; ")}.`);
    if (i.blockers.length) parts.push(`Blocked: ${i.blockers.join("; ")}.`);
    return parts.join(" ");
  });
  return lines.join("\n\n");
}

interface PanelProps {
  /** Generate as soon as the panel mounts (incoming-shift page). */
  autoGenerate?: boolean;
  /** When provided, shows a "Use as transcript" action (voice handover page). */
  onUseAsTranscript?: (text: string) => void;
}

/** Generates a handover from existing records when nobody recorded one. Read-only. */
export function AutoHandoverPanel({ autoGenerate = true, onUseAsTranscript }: PanelProps = {}) {
  const [hours, setHours] = useState(12);
  const [state, setState] = useState<{ phase: "idle" | "loading" } | { phase: "error"; message: string } | { phase: "done"; data: AutoHandover }>({ phase: "idle" });
  const [audio, setAudio] = useState<{ state: "idle" | "loading" | "playing" | "ready" | "error"; url?: string; message?: string }>({ state: "idle" });
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const busy = useRef(false);

  // Generate automatically when the incoming shift opens the page — no handover input needed.
  useEffect(() => {
    const cached = readCache(12);
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ phase: "done", data: cached });
      return;
    }
    if (autoGenerate) void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate(force = false) {
    if (busy.current) return;
    if (!force) {
      const cached = readCache(hours);
      if (cached) {
        setState({ phase: "done", data: cached });
        return;
      }
    }
    busy.current = true;
    stop();
    if (audio.url) URL.revokeObjectURL(audio.url);
    setAudio({ state: "idle" });
    setState({ phase: "loading" });
    try {
      const res = await fetch("/api/handovers/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ windowHours: hours }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? `Generation failed (HTTP ${res.status}).`);
      writeCache(hours, body.handover);
      setState({ phase: "done", data: body.handover });
    } catch (err) {
      setState({ phase: "error", message: err instanceof TypeError ? "Network error — please retry." : (err as Error).message });
    } finally {
      busy.current = false;
    }
  }

  function stop() {
    audioEl.current?.pause();
    setAudio((a) => (a.state === "playing" ? { ...a, state: "ready" } : a));
  }

  async function listen(h: AutoHandover) {
    let url = audio.url;
    if (!url) {
      setAudio({ state: "loading" });
      try {
        const res = await fetch("/api/voice/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: spokenSummary(h) }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? "Speech unavailable.");
        url = URL.createObjectURL(await res.blob());
      } catch (err) {
        setAudio({ state: "error", message: (err as Error).message });
        return;
      }
    }
    const el = audioEl.current ?? new Audio();
    audioEl.current = el;
    el.src = url;
    el.onended = () => setAudio({ state: "ready", url });
    setAudio({ state: "playing", url });
    el.play().catch(() => setAudio({ state: "ready", url }));
  }

  const loading = state.phase === "loading";

  return (
    <section className="rounded-xl bg-card ring-1 ring-violet-200">
      <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
            <Sparkles className="size-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Auto Handover</h2>
            <p className="text-xs text-muted-foreground">
              Generated automatically from tickets, update history, emails and chat — no handover input needed. Read-only; nothing is saved.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 md:ml-auto">
          <select
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            disabled={loading}
            aria-label="Look-back window"
          >
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                Last {w}h
              </option>
            ))}
          </select>
          <Button onClick={() => generate(true)} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : state.phase === "done" ? <RotateCcw /> : <Sparkles />}
            {loading ? "Generating…" : state.phase === "done" ? "Regenerate" : "Generate handover"}
          </Button>
        </div>
      </div>

      {loading && (
        <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Reading tickets, history and communications… (about 10 seconds)
        </p>
      )}
      {state.phase === "error" && (
        <div className="m-4 flex items-start gap-2 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" /> {state.message}
        </div>
      )}

      {state.phase === "done" && (
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-start gap-3">
            <p className="flex-1 text-sm font-medium">{state.data.headline}</p>
            <div className="flex gap-2">
              {audio.state === "playing" ? (
                <Button size="sm" variant="outline" onClick={stop}>
                  <Pause /> Stop
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => listen(state.data)} disabled={audio.state === "loading"}>
                  {audio.state === "loading" ? <Loader2 className="animate-spin" /> : <Volume2 />} {audio.state === "ready" ? "Replay" : "Listen"}
                </Button>
              )}
              {onUseAsTranscript && (
                <Button size="sm" onClick={() => onUseAsTranscript(toTranscript(state.data))}>
                  Use as transcript
                </Button>
              )}
              <Link href="/assistant" className="inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[0.8rem] text-primary hover:bg-muted">
                <Bot className="size-3.5" /> Ask follow-ups
              </Link>
            </div>
          </div>
          {audio.state === "error" && <p className="text-xs text-amber-700">Audio unavailable: {audio.message}</p>}

          {state.data.topPriorities.length > 0 && (
            <ol className="grid gap-2 md:grid-cols-3">
              {state.data.topPriorities.map((p, idx) => {
                const m = state.data.incidentMeta[p.incidentId];
                return (
                  <li key={p.incidentId} className="rounded-lg bg-violet-50/60 p-3 text-sm">
                    <p className="mb-1 flex items-center gap-1.5 text-xs">
                      <span className="font-semibold">#{idx + 1}</span>
                      {m && <SeverityBadge severity={m.severity} />}
                      <Link href={`/incidents/${p.incidentId}`} className="font-mono font-semibold hover:underline">
                        {p.incidentId}
                      </Link>
                    </p>
                    <p className="text-xs text-muted-foreground">{p.why}</p>
                    <p className="mt-1 font-medium">→ {p.nextStep}</p>
                  </li>
                );
              })}
            </ol>
          )}

          <ul className="divide-y rounded-lg border">
            {state.data.incidents.map((i) => {
              const m = state.data.incidentMeta[i.incidentId];
              return (
                <li key={i.incidentId} className="grid gap-2 p-3 text-sm md:grid-cols-[220px_1fr]">
                  <div>
                    <p className="flex items-center gap-1.5">
                      {m && <SeverityBadge severity={m.severity} />}
                      <Link href={`/incidents/${i.incidentId}`} className="font-mono text-xs font-semibold hover:underline">
                        {i.incidentId}
                      </Link>
                      {m && <StatusBadge status={m.status} />}
                    </p>
                    {m && <p className="mt-1 text-xs text-muted-foreground">{m.title}</p>}
                  </div>
                  <div className="space-y-1">
                    <p>{i.situation}</p>
                    {i.doneSoFar.length > 0 && <p className="text-xs"><span className="font-medium text-emerald-700">Done:</span> {i.doneSoFar.join(" · ")}</p>}
                    {i.nextSteps.length > 0 && <p className="text-xs"><span className="font-medium text-violet-700">Next:</span> {i.nextSteps.join(" · ")}</p>}
                    {i.blockers.length > 0 && <p className="text-xs"><span className="font-medium text-red-700">Blocked:</span> {i.blockers.join(" · ")}</p>}
                    {i.watchOut && <p className="text-xs text-amber-800">⚠ {i.watchOut}</p>}
                    {i.sources.length > 0 && <p className="text-[11px] text-muted-foreground">Sources: {i.sources.join(", ")}</p>}
                  </div>
                </li>
              );
            })}
          </ul>

          {state.data.gaps.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              <p className="mb-1 font-medium">Gaps to chase</p>
              <ul className="list-disc space-y-0.5 pl-4">
                {state.data.gaps.map((g, idx) => (
                  <li key={idx}>{g}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            AI-generated by {state.data.model} at {formatUtc(state.data.generatedAt)} from {state.data.sourceCounts.incidents} incidents,{" "}
            {state.data.sourceCounts.updates} updates, {state.data.sourceCounts.communications} emails/messages and {state.data.sourceCounts.handovers} confirmed
            handovers (last {state.data.windowHours}h). Not a confirmed record — verify before acting.
          </p>
        </div>
      )}
    </section>
  );
}
