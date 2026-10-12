"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Ban,
  Check,
  CheckCircle2,
  Circle,
  CircleHelp,
  Clock,
  EyeOff,
  Lightbulb,
  Loader2,
  Pencil,
  Plus,
  Quote,
  RotateCcw,
  ShieldCheck,
  Trash2,
  User,
  X,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatUtc } from "@/lib/format";
import { SeverityBadge, StatusBadge } from "@/components/incidents/badges";
import { STATUSES, type Incident } from "@/types/incident";
import type { ConfirmResult, HandoverDraft, ProposedIncidentUpdate } from "@/types/handover";
import {
  defaultShifts,
  initialReviewItems,
  itemProblems,
  snapshotOf,
  toDecision,
  utcInputToIso,
  type ReviewItem,
} from "./review-state";

const FIELD_LABELS: Record<string, string> = {
  owner: "Incident owner",
  nextUpdateAt: "Next update time",
  currentSituation: "Current situation",
  pendingActionOwner: "Owner for a pending action",
  pendingActionDueAt: "Due time for a pending action",
  status: "Status",
};

interface Props {
  draft: HandoverDraft;
  stale: boolean;
  incidents: Incident[];
  originalTranscript: string;
  editedTranscript: string;
  onConfirmed?: (result: ConfirmResult) => void;
}

export function ExtractionReview({ draft, stale, incidents, originalTranscript, editedTranscript, onConfirmed }: Props) {
  const [items, setItems] = useState<ReviewItem[]>(() => initialReviewItems(draft));
  const [shifts, setShifts] = useState(() => defaultShifts());
  const [submittedBy, setSubmittedBy] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConfirmResult | null>(null);
  // One key per draft: retries after a network failure are de-duplicated server-side.
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const submittingRef = useRef(false);

  const update = (key: string, patch: Partial<ReviewItem>) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const undecided = items.filter((i) => i.decision === "undecided").length;
  const approved = items.filter((i) => i.decision === "approve");
  const problems = items.flatMap((i) => itemProblems(i).map((p) => `${i.incident?.id ?? i.proposal.mentionedAs}: ${p}`));
  const duplicateTargets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of approved) if (i.incident) counts.set(i.incident.id, (counts.get(i.incident.id) ?? 0) + 1);
    return [...counts].filter(([, n]) => n > 1).map(([id]) => id);
  }, [approved]);

  const blockers: string[] = [];
  if (stale) blockers.push("The transcript changed since this draft was generated — regenerate first.");
  if (undecided) blockers.push(`${undecided} update(s) still need an approve/reject decision.`);
  if (duplicateTargets.length) blockers.push(`${duplicateTargets.join(", ")} approved more than once — reject one.`);
  if (!shifts.outgoing.trim() || !shifts.incoming.trim()) blockers.push("Enter outgoing and incoming shift names.");
  blockers.push(...problems);
  const canConfirm = !result && !submitting && blockers.length === 0 && items.length > 0;

  async function confirm() {
    if (!canConfirm || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/handovers/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: idempotencyKey.current,
          originalTranscript,
          editedTranscript,
          outgoingShift: shifts.outgoing.trim(),
          incomingShift: shifts.incoming.trim(),
          submittedBy: submittedBy.trim() || undefined,
          decisions: items.map(toDecision),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? `Confirmation failed (HTTP ${res.status}).`);
      setResult(body as ConfirmResult);
      onConfirmed?.(body as ConfirmResult);
    } catch (err) {
      setError(
        err instanceof TypeError
          ? "Network error — the handover may not have been saved. Retry safely: duplicates are prevented."
          : (err as Error).message,
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const locked = !!result;
  const matchedItems = items.filter((i) => i.proposal.current);
  const unmatchedItems = items.filter((i) => !i.proposal.current);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">Proposed handover draft</p>
            <p className="text-xs text-muted-foreground">
              Generated {formatUtc(draft.generatedAt)} by <span className="font-mono">{draft.model}</span>. Nothing is saved
              until you confirm below.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs sm:ml-auto">
          <Pill tone="neutral">{draft.matched.length} matched</Pill>
          {draft.unmatched.length > 0 && <Pill tone="warn">{draft.unmatched.length} unmatched</Pill>}
          {!locked && (
            <>
              <Button size="sm" variant="outline" onClick={() => setItems((xs) => xs.map((x) => (x.incident ? { ...x, decision: "approve" } : x)))}>
                <Check /> Approve all matched
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setItems((xs) => xs.map((x) => ({ ...x, decision: "reject" })))}>
                <X /> Reject all
              </Button>
            </>
          )}
        </div>
      </div>

      {stale && !locked && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <AlertTriangle className="size-4 shrink-0" />
          The transcript has been edited since this draft was generated. Regenerate to reflect your changes.
        </div>
      )}

      {items.length === 0 && (
        <div className="rounded-xl bg-card px-4 py-10 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
          No incident updates were found in the transcript.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {matchedItems.map((item) => (
          <UpdateCard key={item.key} item={item} incidents={incidents} locked={locked} onChange={(p) => update(item.key, p)} />
        ))}
      </div>

      {unmatchedItems.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <CircleHelp className="size-4 text-amber-600" /> Unmatched — assign an incident or reject
          </h3>
          <div className="grid gap-4 xl:grid-cols-2">
            {unmatchedItems.map((item) => (
              <UpdateCard key={item.key} item={item} incidents={incidents} locked={locked} onChange={(p) => update(item.key, p)} />
            ))}
          </div>
        </section>
      )}

      {(draft.notMentioned.length > 0 || draft.generalNotes.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {draft.notMentioned.length > 0 && (
            <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <EyeOff className="size-4 text-muted-foreground" /> Active incidents not mentioned
              </h3>
              <p className="mb-3 text-xs text-muted-foreground">Not covered in this handover — they stay unchanged.</p>
              <ul className="space-y-1.5">
                {draft.notMentioned.map((i) => (
                  <li key={i.id} className="flex items-center gap-2 text-sm">
                    <SeverityBadge severity={i.severity} />
                    <Link href={`/incidents/${i.id}`} className="font-mono text-xs hover:underline">
                      {i.id}
                    </Link>
                    <span className="truncate text-muted-foreground">{i.title}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {draft.generalNotes.length > 0 && (
            <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <h3 className="mb-2 text-sm font-semibold">General notes</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {draft.generalNotes.map((n, idx) => (
                  <li key={idx}>{n}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* ---------------- Confirm ---------------- */}
      {items.length > 0 && (
        <section className={cn("rounded-xl bg-card ring-1", result ? "ring-emerald-300" : "ring-foreground/10")}>
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold">4 · Confirm handover</h3>
            <p className="text-xs text-muted-foreground">
              {approved.length} approved · {items.filter((i) => i.decision === "reject").length} rejected. Only approved updates are
              written, atomically, with an audit trail.
            </p>
          </div>
          {result ? (
            <div className="flex flex-col gap-3 p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
                <CheckCircle2 className="size-5" />
                {result.replayed ? "Handover was already confirmed — no duplicate changes were made." : "Handover confirmed and saved."}
              </p>
              <p className="text-sm text-muted-foreground">
                {result.appliedIncidentIds.length
                  ? `Updated ${result.appliedIncidentIds.join(", ")}.`
                  : "No incident fields changed."}{" "}
                Handover <span className="font-mono text-xs">{result.handover.id.slice(0, 8)}</span> ·{" "}
                {result.handover.outgoingShift} → {result.handover.incomingShift}
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href={`/handovers/${result.handover.id}`} className={buttonVariants({ variant: "outline" })}>
                  View handover record
                </Link>
                <Link href="/briefing" className={buttonVariants()}>
                  Open incoming-shift briefing <ArrowRight />
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <LabeledInput label="Outgoing shift" value={shifts.outgoing} onChange={(v) => setShifts((s) => ({ ...s, outgoing: v }))} maxLength={80} />
                <LabeledInput label="Incoming shift" value={shifts.incoming} onChange={(v) => setShifts((s) => ({ ...s, incoming: v }))} maxLength={80} />
                <LabeledInput label="Your name (optional)" value={submittedBy} onChange={setSubmittedBy} maxLength={80} placeholder="e.g. Asha Rao" />
              </div>
              {blockers.length > 0 && (
                <ul className="space-y-1 text-xs text-amber-800">
                  {blockers.map((b, idx) => (
                    <li key={idx} className="flex gap-1.5">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {b}
                    </li>
                  ))}
                </ul>
              )}
              {error && (
                <div className="flex items-start gap-2 rounded-lg bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
                </div>
              )}
              <Button size="lg" className="h-11 self-start px-5" disabled={!canConfirm} onClick={confirm}>
                {submitting ? <Loader2 className="animate-spin" /> : error ? <RotateCcw /> : <ShieldCheck />}
                {submitting ? "Saving…" : error ? "Retry confirmation" : `Confirm handover (${approved.length} update${approved.length === 1 ? "" : "s"})`}
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function UpdateCard({
  item,
  incidents,
  locked,
  onChange,
}: {
  item: ReviewItem;
  incidents: Incident[];
  locked: boolean;
  onChange: (patch: Partial<ReviewItem>) => void;
}) {
  const p = item.proposal;
  const confidencePct = Math.round(p.confidence * 100);
  const inc = item.incident;
  const unverifiedDone = p.actionsCompleted.filter((a) => !a.evidenceVerified);

  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-xl bg-card ring-1",
        item.decision === "approve" && "ring-emerald-300",
        item.decision === "reject" && "opacity-60 ring-foreground/10",
        item.decision === "undecided" && "ring-amber-300",
      )}
    >
      <header className="flex flex-col gap-2 border-b p-4">
        <div className="flex flex-wrap items-center gap-2">
          {inc ? (
            <>
              <SeverityBadge severity={inc.severity} />
              <Link href={`/incidents/${inc.id}`} className="font-mono text-xs font-semibold hover:underline">
                {inc.id}
              </Link>
            </>
          ) : (
            <span className="inline-flex h-5 items-center rounded-md bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-900">UNMATCHED</span>
          )}
          {p.requiresReview && (
            <Pill tone="warn">
              <AlertTriangle className="size-3" /> Review needed
            </Pill>
          )}
          {!locked && (
            <div className="ml-auto flex gap-1">
              <Button
                size="sm"
                variant={item.decision === "approve" ? "default" : "outline"}
                className={cn(item.decision === "approve" && "bg-emerald-600 hover:bg-emerald-700")}
                onClick={() => onChange({ decision: "approve" })}
                disabled={!inc}
                aria-pressed={item.decision === "approve"}
              >
                <Check /> Approve
              </Button>
              <Button
                size="sm"
                variant={item.decision === "reject" ? "destructive" : "outline"}
                onClick={() => onChange({ decision: "reject", editing: false })}
                aria-pressed={item.decision === "reject"}
              >
                <X /> Reject
              </Button>
            </div>
          )}
        </div>

        {!p.current && !locked && (
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Assign to incident</span>
            <select
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
              value={inc?.id ?? ""}
              onChange={(e) => {
                const target = incidents.find((i) => i.id === e.target.value);
                onChange({ incident: target ? snapshotOf(target) : null, decision: target ? item.decision : "undecided" });
              }}
            >
              <option value="">— Select incident —</option>
              {incidents.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.id} · {i.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <h4 className="text-sm leading-snug font-semibold">{inc?.title ?? `“${p.mentionedAs}”`}</h4>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {inc && (
            <span className="flex items-center gap-1.5">
              <StatusBadge status={inc.status} />
              {item.status && item.status !== inc.status && (
                <>
                  <ArrowRight className="size-3" />
                  <StatusBadge status={item.status} />
                </>
              )}
            </span>
          )}
          <span>
            Match: <strong className={cn(p.matchConfidence === "high" ? "text-emerald-700" : "text-amber-700")}>{p.matchConfidence}</strong>
          </span>
          <span className="flex items-center gap-1.5">
            Confidence
            <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
              <span
                className={cn("block h-full rounded-full", confidencePct >= 75 ? "bg-emerald-500" : confidencePct >= 50 ? "bg-amber-500" : "bg-red-500")}
                style={{ width: `${confidencePct}%` }}
              />
            </span>
            <span className="tabular-nums">{confidencePct}%</span>
          </span>
          {!locked && item.decision !== "reject" && (
            <button className="ml-auto inline-flex items-center gap-1 text-primary hover:underline" onClick={() => onChange({ editing: !item.editing })}>
              <Pencil className="size-3" /> {item.editing ? "Done editing" : "Edit"}
            </button>
          )}
        </div>
        {p.suggestedIncidentId && !p.current && (
          <p className="text-xs text-amber-800">Model suggested {p.suggestedIncidentId} — not accepted automatically.</p>
        )}
        {p.matchReason && <p className="text-xs text-muted-foreground italic">{p.matchReason}</p>}
      </header>

      <div className="flex flex-1 flex-col gap-4 p-4 text-sm">
        {p.warnings.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
            {p.warnings.map((w, idx) => (
              <li key={idx} className="flex gap-1.5">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {w}
              </li>
            ))}
          </ul>
        )}

        {item.editing ? (
          <EditFields item={item} onChange={onChange} />
        ) : (
          <ReadFields item={item} />
        )}

        {unverifiedDone.length > 0 && (
          <div className="rounded-lg border border-amber-200 p-3 text-xs">
            <p className="mb-1 font-medium text-amber-800">Unverified “completed” claims (not included unless you add them)</p>
            <ul className="space-y-1">
              {unverifiedDone.map((a, idx) => (
                <li key={idx}>
                  {a.description}
                  <Evidence text={a.evidence} verified={false} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {(p.missingFields.length > 0 || p.unresolvedQuestions.length > 0) && (
          <div className="rounded-lg border border-dashed p-3">
            {p.missingFields.length > 0 && (
              <div className="mb-2">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Missing information</p>
                <div className="flex flex-wrap gap-1">
                  {p.missingFields.map((f) => (
                    <span key={f} className="rounded-md bg-muted px-1.5 py-0.5 text-xs">
                      {FIELD_LABELS[f] ?? f}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {p.unresolvedQuestions.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Questions for the incoming engineer</p>
                <ul className="list-disc space-y-0.5 pl-4 text-xs">
                  {p.unresolvedQuestions.map((q, idx) => (
                    <li key={idx}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {p.recommendations.length > 0 && (
          <div className="rounded-lg bg-blue-50/60 p-3 text-xs text-blue-950">
            <p className="mb-1 flex items-center gap-1 font-medium">
              <Lightbulb className="size-3.5" /> AI recommendations (not stated in the handover, never applied)
            </p>
            <ul className="list-disc space-y-0.5 pl-4">
              {p.recommendations.map((r, idx) => (
                <li key={idx}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </article>
  );
}

function ReadFields({ item }: { item: ReviewItem }) {
  const p: ProposedIncidentUpdate = item.proposal;
  const evidenceFor = (desc: string) => p.actionsCompleted.find((a) => a.description === desc);
  const pendingEvidence = (desc: string) => p.pendingActions.find((a) => a.description === desc);
  return (
    <>
      <Field label="Current situation">
        {item.currentSituation ? <p>{item.currentSituation}</p> : <Missing>Not described — existing summary kept</Missing>}
      </Field>
      <Field label="Actions completed" count={item.actionsCompleted.length + item.completeExisting.length}>
        {item.actionsCompleted.length + item.completeExisting.length ? (
          <ul className="space-y-2">
            {item.actionsCompleted.map((a, idx) => {
              const ev = evidenceFor(a);
              return (
                <li key={idx} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  <div className="min-w-0">
                    <p>{a}</p>
                    {ev && <Evidence text={ev.evidence} verified={ev.evidenceVerified} />}
                  </div>
                </li>
              );
            })}
            {item.completeExisting.map((a) => (
              <li key={`x-${a}`} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                <p>
                  {a} <span className="text-xs text-muted-foreground">(existing action marked done)</span>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <Missing>None stated</Missing>
        )}
      </Field>
      <Field label="New pending actions" count={item.pendingActions.length}>
        {item.pendingActions.length ? (
          <ul className="space-y-2">
            {item.pendingActions.map((a, idx) => {
              const ev = pendingEvidence(a.description);
              const due = utcInputToIso(a.dueAt);
              return (
                <li key={idx} className="flex gap-2">
                  <Circle className="mt-0.5 size-4 shrink-0 text-violet-500" />
                  <div className="min-w-0">
                    <p>{a.description}</p>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <User className="size-3" /> {a.owner || <em className="text-amber-700">owner not stated</em>}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3" /> {due ? formatUtc(due) : <em className="text-amber-700">no due time</em>}
                      </span>
                    </div>
                    {ev && <Evidence text={ev.evidence} verified={ev.evidenceVerified} />}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <Missing>None stated</Missing>
        )}
      </Field>
      {(item.blockers.length > 0 || item.blockersCleared.length > 0) && (
        <Field label="Blockers">
          <ul className="space-y-1.5">
            {item.blockers.map((b, idx) => (
              <li key={idx} className="flex gap-2">
                <Ban className="mt-0.5 size-4 shrink-0 text-red-600" /> {b}
              </li>
            ))}
            {item.blockersCleared.map((b) => (
              <li key={`c-${b}`} className="flex gap-2 text-muted-foreground line-through">
                <Ban className="mt-0.5 size-4 shrink-0" /> {b}
              </li>
            ))}
          </ul>
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Owner">
          {item.owner ? (
            <>
              <p>{item.owner}</p>
              {p.owner?.value === item.owner && <Evidence text={p.owner.evidence} verified />}
            </>
          ) : (
            <Missing>Not stated{item.incident?.owner ? ` (keeps ${item.incident.owner})` : ""}</Missing>
          )}
        </Field>
        <Field label="Next update">
          {item.nextUpdateAt ? (
            <>
              <p>{formatUtc(utcInputToIso(item.nextUpdateAt))}</p>
              {p.nextUpdateAt && utcInputToIso(item.nextUpdateAt) === p.nextUpdateAt.value && <Evidence text={p.nextUpdateAt.evidence} verified />}
            </>
          ) : (
            <Missing>Not stated</Missing>
          )}
        </Field>
      </div>
      {item.status && item.status !== item.incident?.status && (
        <Field label="Status change">
          <StatusBadge status={item.status} />
          {p.proposedStatus?.value === item.status && <Evidence text={p.proposedStatus.evidence} verified />}
        </Field>
      )}
    </>
  );
}

function EditFields({ item, onChange }: { item: ReviewItem; onChange: (patch: Partial<ReviewItem>) => void }) {
  const inc = item.incident;
  return (
    <div className="flex flex-col gap-4">
      <Field label="Current situation (replaces summary)">
        <Textarea
          value={item.currentSituation}
          onChange={(e) => onChange({ currentSituation: e.target.value.slice(0, 2000) })}
          className="min-h-20 text-sm"
          placeholder="Leave empty to keep the existing summary"
        />
      </Field>
      <ListEditor label="Actions completed (added)" values={item.actionsCompleted} onChange={(v) => onChange({ actionsCompleted: v })} />
      {inc && inc.openPendingActions.length > 0 && (
        <Field label="Existing pending actions — mark done">
          <ul className="space-y-1">
            {inc.openPendingActions.map((a) => (
              <li key={a}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4"
                    checked={item.completeExisting.includes(a)}
                    onChange={(e) =>
                      onChange({ completeExisting: e.target.checked ? [...item.completeExisting, a] : item.completeExisting.filter((x) => x !== a) })
                    }
                  />
                  {a}
                </label>
              </li>
            ))}
          </ul>
        </Field>
      )}
      <Field label="New pending actions">
        <div className="flex flex-col gap-2">
          {item.pendingActions.map((a, idx) => (
            <div key={idx} className="flex flex-col gap-1.5 rounded-lg border p-2">
              <div className="flex gap-1.5">
                <Input
                  value={a.description}
                  placeholder="Action"
                  maxLength={500}
                  onChange={(e) => onChange({ pendingActions: item.pendingActions.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)) })}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove action"
                  onClick={() => onChange({ pendingActions: item.pendingActions.filter((_, i) => i !== idx) })}
                >
                  <Trash2 />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <Input
                  value={a.owner}
                  placeholder="Owner (if known)"
                  maxLength={120}
                  onChange={(e) => onChange({ pendingActions: item.pendingActions.map((x, i) => (i === idx ? { ...x, owner: e.target.value } : x)) })}
                />
                <Input
                  type="datetime-local"
                  value={a.dueAt}
                  aria-label="Due (UTC)"
                  onChange={(e) => onChange({ pendingActions: item.pendingActions.map((x, i) => (i === idx ? { ...x, dueAt: e.target.value } : x)) })}
                />
              </div>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() => onChange({ pendingActions: [...item.pendingActions, { description: "", owner: "", dueAt: "" }] })}
          >
            <Plus /> Add pending action
          </Button>
          <p className="text-[11px] text-muted-foreground">Times are UTC.</p>
        </div>
      </Field>
      <ListEditor label="Blockers (added)" values={item.blockers} onChange={(v) => onChange({ blockers: v })} />
      {inc && inc.blockers.length > 0 && (
        <Field label="Existing blockers — clear">
          <ul className="space-y-1">
            {inc.blockers.map((b) => (
              <li key={b}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4"
                    checked={item.blockersCleared.includes(b)}
                    onChange={(e) =>
                      onChange({ blockersCleared: e.target.checked ? [...item.blockersCleared, b] : item.blockersCleared.filter((x) => x !== b) })
                    }
                  />
                  {b}
                </label>
              </li>
            ))}
          </ul>
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Owner">
          <Input value={item.owner} maxLength={120} placeholder={inc?.owner ? `Keep ${inc.owner}` : "Unassigned"} onChange={(e) => onChange({ owner: e.target.value })} />
        </Field>
        <Field label="Next update (UTC)">
          <Input type="datetime-local" value={item.nextUpdateAt} onChange={(e) => onChange({ nextUpdateAt: e.target.value })} />
        </Field>
      </div>
      <Field label="Status">
        <select
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
          value={item.status}
          onChange={(e) => onChange({ status: e.target.value as ReviewItem["status"], resolutionConfirmed: false })}
        >
          <option value="">No change{inc ? ` (${inc.status})` : ""}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {item.status === "Resolved" && (
          <label className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={item.resolutionConfirmed}
              onChange={(e) => onChange({ resolutionConfirmed: e.target.checked })}
            />
            I confirm this incident is resolved (not just improving).
          </label>
        )}
      </Field>
    </div>
  );
}

function ListEditor({ label, values, onChange }: { label: string; values: string[]; onChange: (v: string[]) => void }) {
  return (
    <Field label={label}>
      <div className="flex flex-col gap-1.5">
        {values.map((v, idx) => (
          <div key={idx} className="flex gap-1.5">
            <Input value={v} maxLength={500} onChange={(e) => onChange(values.map((x, i) => (i === idx ? e.target.value : x)))} />
            <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => onChange(values.filter((_, i) => i !== idx))}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button size="sm" variant="outline" className="self-start" onClick={() => onChange([...values, ""])}>
          <Plus /> Add
        </Button>
      </div>
    </Field>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  maxLength,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength: number;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Input value={value} maxLength={maxLength} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Field({ label, count, children }: { label: string; count?: number; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
        {count !== undefined && <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">{count}</span>}
      </p>
      {children}
    </div>
  );
}

function Missing({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-amber-700 italic">{children}</p>;
}

function Evidence({ text, verified }: { text: string; verified: boolean }) {
  if (!text) return null;
  return (
    <p className={cn("mt-1 flex gap-1 text-xs", verified ? "text-muted-foreground" : "text-amber-700")}>
      <Quote className="mt-0.5 size-3 shrink-0" />
      <span className="italic">{text}</span>
      {!verified && <span className="shrink-0 font-medium not-italic">(unverified)</span>}
    </p>
  );
}

function Pill({ tone, children }: { tone: "ok" | "warn" | "neutral"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        tone === "ok" && "bg-emerald-50 text-emerald-700 ring-emerald-200",
        tone === "warn" && "bg-amber-50 text-amber-800 ring-amber-200",
        tone === "neutral" && "bg-muted text-foreground ring-border",
      )}
    >
      {children}
    </span>
  );
}
