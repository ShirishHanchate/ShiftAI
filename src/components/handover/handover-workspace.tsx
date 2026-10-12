"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileAudio,
  Keyboard,
  Loader2,
  Mic,
  RotateCcw,
  Sparkles,
  Square,
  Upload,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SeverityBadge } from "@/components/incidents/badges";
import { ExtractionReview } from "./extraction-review";
import { AutoHandoverPanel } from "@/components/briefing/auto-handover-panel";
import { MAX_RECORDING_SECONDS, useRecorder } from "./use-recorder";
import { prepareSegments } from "@/lib/audio";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HandoverDraft } from "@/types/handover";
import type { Incident } from "@/types/incident";

const LANGUAGES = {
  "en-IN": "English (India)",
  unknown: "Auto-detect",
  "hi-IN": "Hindi",
  "ta-IN": "Tamil",
  "te-IN": "Telugu",
  "kn-IN": "Kannada",
  "ml-IN": "Malayalam",
  "mr-IN": "Marathi",
  "bn-IN": "Bengali",
  "gu-IN": "Gujarati",
} as const;

const MIN_TRANSCRIPT = 20;
const MAX_TRANSCRIPT = 20_000;

type TranscribeState =
  | { phase: "idle" }
  | { phase: "preparing" }
  | { phase: "uploading"; done: number; total: number }
  | { phase: "done"; segments: number; seconds: number }
  | { phase: "error"; message: string };

type ExtractState = { phase: "idle" } | { phase: "processing" } | { phase: "error"; message: string } | { phase: "done" };

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.error?.message ?? `Request failed (HTTP ${res.status}).`;
  } catch {
    return `Request failed (HTTP ${res.status}).`;
  }
}

export function HandoverWorkspace({ incidents, preselected }: { incidents: Incident[]; preselected: string[] }) {
  const recorder = useRecorder();
  const [language, setLanguage] = useState<string>("en-IN");
  const [transcribe, setTranscribe] = useState<TranscribeState>({ phase: "idle" });
  const [transcript, setTranscript] = useState("");
  /** Raw speech-to-text output, kept so the original transcript is preserved with the handover. */
  const [asrTranscript, setAsrTranscript] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(preselected);
  const [extract, setExtract] = useState<ExtractState>({ phase: "idle" });
  const [draft, setDraft] = useState<HandoverDraft | null>(null);
  const [draftSource, setDraftSource] = useState<string | null>(null);
  const [showTextEntry, setShowTextEntry] = useState(false);
  // Synchronous guards against double submission (state updates are async).
  const transcribingRef = useRef(false);
  const extractingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);

  // Audio preview URL: derived from the blob, revoked when the blob changes or on unmount.
  const audioUrl = useMemo(() => (recorder.blob ? URL.createObjectURL(recorder.blob) : null), [recorder.blob]);
  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  const micUnavailable = recorder.status === "denied" || recorder.status === "unsupported" || recorder.status === "error";
  const textEntryVisible = showTextEntry || micUnavailable || transcribe.phase === "error" || transcript.length > 0;
  const isTranscribing = transcribe.phase === "preparing" || transcribe.phase === "uploading";
  const isExtracting = extract.phase === "processing";
  const trimmed = transcript.trim();
  const draftStale = draft !== null && draftSource !== null && draftSource !== trimmed;

  const activeIncidents = useMemo(() => incidents.filter((i) => i.status !== "Resolved"), [incidents]);

  async function runTranscription() {
    if (!recorder.blob || transcribingRef.current) return;
    transcribingRef.current = true;
    setTranscribe({ phase: "preparing" });
    try {
      let prepared;
      try {
        prepared = await prepareSegments(recorder.blob);
      } catch {
        throw new Error("Could not decode the recording in this browser. Try recording again or type the handover.");
      }
      if (prepared.silent) throw new Error("The recording appears to be silent. Check your microphone input level and try again.");

      const parts: string[] = [];
      for (let i = 0; i < prepared.segments.length; i++) {
        setTranscribe({ phase: "uploading", done: i, total: prepared.segments.length });
        const form = new FormData();
        form.append("file", prepared.segments[i], `handover-part-${i + 1}.wav`);
        form.append("languageCode", language);
        const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
        if (!res.ok) {
          const msg = await readError(res);
          // A silent segment in the middle of a long handover should not fail the whole run.
          if (res.status === 422 && prepared.segments.length > 1 && /no speech/i.test(msg)) continue;
          throw new Error(prepared.segments.length > 1 ? `Segment ${i + 1}/${prepared.segments.length}: ${msg}` : msg);
        }
        const body = (await res.json()) as { transcript: string };
        if (body.transcript) parts.push(body.transcript);
      }
      if (parts.length === 0) throw new Error("No speech was detected in the recording.");
      const text = parts.join(" ").replace(/\s+/g, " ").trim();
      setTranscript(text);
      setAsrTranscript(text);
      setTranscribe({ phase: "done", segments: prepared.segments.length, seconds: prepared.durationSeconds });
    } catch (err) {
      setTranscribe({ phase: "error", message: (err as Error).message });
    } finally {
      transcribingRef.current = false;
    }
  }

  async function runExtraction() {
    if (extractingRef.current) return;
    if (trimmed.length < MIN_TRANSCRIPT) {
      setExtract({ phase: "error", message: `The transcript needs at least ${MIN_TRANSCRIPT} characters.` });
      return;
    }
    extractingRef.current = true;
    setExtract({ phase: "processing" });
    const source = trimmed;
    try {
      const res = await fetch("/api/handovers/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: source, incidentIds: selected.length ? selected : undefined }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as { draft: HandoverDraft };
      setDraft(body.draft);
      setDraftSource(source);
      setExtract({ phase: "done" });
      requestAnimationFrame(() => reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (err) {
      setExtract({ phase: "error", message: (err as Error).message });
    } finally {
      extractingRef.current = false;
    }
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("audio/") && !file.type.startsWith("video/webm")) {
      setTranscribe({ phase: "error", message: "Please choose an audio file (WAV, MP3, M4A, OGG, WebM, FLAC)." });
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setTranscribe({ phase: "error", message: "Audio files must be 50 MB or smaller." });
      return;
    }
    setTranscribe({ phase: "idle" });
    recorder.loadFile(file);
  }

  function toggleIncident(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  const recording = recorder.status === "recording";
  const levelPct = Math.min(100, Math.round(recorder.level * 160));

  return (
    <div className="flex flex-col gap-6">
      <Steps
        current={draft ? 3 : trimmed ? 2 : 1}
        labels={["Record handover", "Review transcript", "Review proposed updates"]}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* ---------------- Recorder ---------------- */}
          <section className="rounded-xl bg-card ring-1 ring-foreground/10">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold">1 · Voice handover</h2>
              <RecorderStatusBadge status={recorder.status} hasAudio={!!recorder.blob} />
            </div>
            <div className="flex flex-col items-center gap-4 px-4 py-6">
              <div className="relative flex items-center justify-center">
                {recording && (
                  <span
                    className="absolute rounded-full bg-red-500/15 transition-all duration-100"
                    style={{ width: 96 + levelPct * 0.8, height: 96 + levelPct * 0.8 }}
                  />
                )}
                <button
                  type="button"
                  onClick={recording ? recorder.stop : recorder.start}
                  disabled={recorder.status === "requesting" || recorder.status === "unsupported" || isTranscribing}
                  className={cn(
                    "relative flex size-20 items-center justify-center rounded-full text-white shadow-lg transition-all focus-visible:ring-4 focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40",
                    recording ? "bg-red-600 hover:bg-red-700" : "bg-primary hover:bg-primary/90",
                  )}
                  aria-label={recording ? "Stop recording" : "Start recording"}
                >
                  {recorder.status === "requesting" ? (
                    <Loader2 className="size-7 animate-spin" />
                  ) : recording ? (
                    <Square className="size-7 fill-current" />
                  ) : (
                    <Mic className="size-8" />
                  )}
                </button>
              </div>

              <div className="text-center">
                <p className={cn("font-mono text-2xl tabular-nums", recording ? "text-red-600" : "text-foreground")}>
                  {formatDuration(recorder.elapsed)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {recording
                    ? `Recording… speak through each incident. Max ${MAX_RECORDING_SECONDS / 60} min.`
                    : recorder.status === "requesting"
                      ? "Waiting for microphone permission…"
                      : "Press to start recording. Mention incident IDs (e.g. “INC 1042”) for best matching."}
                </p>
              </div>

              <div className="flex flex-wrap justify-center gap-2">
                {!recording ? (
                  <Button onClick={recorder.start} disabled={recorder.status === "requesting" || recorder.status === "unsupported" || isTranscribing}>
                    <Mic /> {recorder.blob ? "Record again" : "Start recording"}
                  </Button>
                ) : (
                  <Button variant="destructive" onClick={recorder.stop}>
                    <Square /> Stop recording
                  </Button>
                )}
                <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={recording || isTranscribing}>
                  <Upload /> Upload audio
                </Button>
                <input ref={fileInputRef} type="file" accept="audio/*,video/webm" className="hidden" onChange={onFilePicked} />
                {!textEntryVisible && (
                  <Button variant="ghost" onClick={() => setShowTextEntry(true)} disabled={recording}>
                    <Keyboard /> Type instead
                  </Button>
                )}
              </div>

              {recorder.error && (
                <div className="flex w-full items-start gap-2 rounded-lg bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  {recorder.error}
                </div>
              )}

              {audioUrl && !recording && (
                <div className="flex w-full flex-col gap-3 rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FileAudio className="size-4" />
                    Audio preview · {(recorder.blob!.size / 1024).toFixed(0)} KB
                  </div>
                  <audio src={audioUrl} controls className="w-full" />
                  <div className="flex flex-wrap items-center gap-2">
                    <Select items={LANGUAGES} value={language} onValueChange={(v) => setLanguage(v ?? "en-IN")}>
                      <SelectTrigger className="w-44" aria-label="Spoken language" disabled={isTranscribing}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(LANGUAGES).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button onClick={runTranscription} disabled={isTranscribing} className="ml-auto">
                      {isTranscribing ? <Loader2 className="animate-spin" /> : transcribe.phase === "error" ? <RotateCcw /> : <Sparkles />}
                      {isTranscribing ? "Transcribing…" : transcribe.phase === "error" ? "Retry transcription" : transcribe.phase === "done" ? "Transcribe again" : "Transcribe with Sarvam"}
                    </Button>
                  </div>
                  <TranscribeProgress state={transcribe} />
                </div>
              )}
              {!audioUrl && transcribe.phase === "error" && <TranscribeProgress state={transcribe} />}
            </div>
          </section>

          {/* ---------------- No recording: generate from records ---------------- */}
          {!recording && (
            <AutoHandoverPanel
              autoGenerate={false}
              onUseAsTranscript={(text) => {
                setTranscript(text.slice(0, MAX_TRANSCRIPT));
                setShowTextEntry(true);
                requestAnimationFrame(() => document.getElementById("handover-transcript")?.scrollIntoView({ behavior: "smooth", block: "center" }));
              }}
            />
          )}

          {/* ---------------- Transcript ---------------- */}
          {textEntryVisible && (
            <section className="rounded-xl bg-card ring-1 ring-foreground/10">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h2 className="text-sm font-semibold">2 · Transcript</h2>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {transcript.length.toLocaleString()} / {MAX_TRANSCRIPT.toLocaleString()}
                </span>
              </div>
              <div className="flex flex-col gap-3 p-4">
                {micUnavailable && !transcript && (
                  <p className="text-xs text-muted-foreground">
                    Microphone unavailable — type or paste the handover notes below. Extraction works the same way.
                  </p>
                )}
                <Textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value.slice(0, MAX_TRANSCRIPT))}
                  placeholder="e.g. “INC 1042, payments 5xx in eu-west: Asha rolled back the config at 06:10, error rate is down to 1%. Still waiting on the processor to confirm. Next update in 30 minutes…”"
                  className="min-h-48 font-[inherit] text-sm leading-relaxed"
                  disabled={isTranscribing}
                  aria-label="Handover transcript"
                  id="handover-transcript"
                />
                <p className="text-xs text-muted-foreground">
                  Correct any speech-recognition mistakes before generating — the edited text is what gets analysed.
                </p>
              </div>
            </section>
          )}
        </div>

        {/* ---------------- Scope + generate ---------------- */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          <section className="rounded-xl bg-card ring-1 ring-foreground/10">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Incidents in scope</h2>
              <p className="text-xs text-muted-foreground">
                {selected.length ? `${selected.length} selected` : "None selected — the AI matches against all incidents."}
              </p>
            </div>
            <ul className="max-h-80 divide-y overflow-y-auto">
              {activeIncidents.map((i) => {
                const on = selected.includes(i.id);
                return (
                  <li key={i.id}>
                    <label className="flex cursor-pointer items-start gap-2.5 px-4 py-2.5 hover:bg-muted/40">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleIncident(i.id)}
                        className="mt-0.5 size-4 accent-[var(--primary)]"
                        disabled={isExtracting}
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <SeverityBadge severity={i.severity} />
                          <span className="font-mono text-xs">{i.id}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{i.title}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
              {activeIncidents.length === 0 && <li className="px-4 py-6 text-center text-xs text-muted-foreground">No active incidents.</li>}
            </ul>
            {selected.length > 0 && (
              <div className="border-t px-4 py-2">
                <button className="text-xs text-primary hover:underline" onClick={() => setSelected([])} disabled={isExtracting}>
                  Clear selection
                </button>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <Button
              size="lg"
              className="h-11 w-full gap-2"
              onClick={runExtraction}
              disabled={isExtracting || isTranscribing || trimmed.length < MIN_TRANSCRIPT}
            >
              {isExtracting ? <Loader2 className="animate-spin" /> : <Wand2 />}
              {isExtracting ? "Generating draft…" : draft ? "Regenerate Handover Draft" : "Generate Handover Draft"}
            </Button>
            <p className="text-xs text-muted-foreground">
              {trimmed.length < MIN_TRANSCRIPT
                ? "Record, upload or type a handover to enable drafting."
                : "Sarvam extracts proposed updates. Nothing is written to incident records."}
            </p>
            {isExtracting && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Matching incidents and validating output — this can take up to a minute.
              </p>
            )}
            {extract.phase === "error" && (
              <div className="flex flex-col gap-2 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
                <span className="flex gap-2">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  {extract.message}
                </span>
                <Button variant="outline" size="sm" onClick={runExtraction} className="self-start">
                  <RotateCcw /> Retry
                </Button>
              </div>
            )}
          </section>
        </aside>
      </div>

      {draft && (
        <div ref={reviewRef} className="scroll-mt-6">
          <h2 className="mb-3 text-sm font-semibold">3 · Review proposed updates</h2>
          <ExtractionReview
            key={draft.generatedAt}
            draft={draft}
            stale={draftStale}
            incidents={incidents}
            originalTranscript={asrTranscript ?? draftSource ?? trimmed}
            editedTranscript={draftSource ?? trimmed}
          />
        </div>
      )}
    </div>
  );
}

function TranscribeProgress({ state }: { state: TranscribeState }) {
  if (state.phase === "idle") return null;
  if (state.phase === "preparing") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Preparing audio (16 kHz mono WAV)…
      </p>
    );
  }
  if (state.phase === "uploading") {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Uploading & transcribing segment {state.done + 1} of {state.total}…
        </p>
        <Progress value={Math.round(((state.done + 0.5) / state.total) * 100)} />
      </div>
    );
  }
  if (state.phase === "done") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-700">
        <CheckCircle2 className="size-3.5" /> Transcribed {formatDuration(state.seconds)} of audio
        {state.segments > 1 ? ` in ${state.segments} segments` : ""}. Review the transcript below.
      </p>
    );
  }
  return (
    <div className="flex w-full items-start gap-2 rounded-lg bg-destructive/5 px-3 py-2 text-sm text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>
        {state.message} <span className="text-muted-foreground">You can retry, or type the handover below.</span>
      </span>
    </div>
  );
}

function RecorderStatusBadge({ status, hasAudio }: { status: string; hasAudio: boolean }) {
  const map: Record<string, [string, string]> = {
    idle: ["Ready", "bg-muted text-muted-foreground"],
    requesting: ["Requesting mic…", "bg-blue-50 text-blue-700"],
    recording: ["● Recording", "bg-red-50 text-red-700"],
    stopped: [hasAudio ? "Audio captured" : "Stopped", "bg-emerald-50 text-emerald-700"],
    denied: ["Mic blocked", "bg-amber-50 text-amber-800"],
    unsupported: ["Mic unsupported", "bg-amber-50 text-amber-800"],
    error: ["Mic error", "bg-destructive/10 text-destructive"],
  };
  const [label, cls] = map[status] ?? map.idle;
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", cls)}>{label}</span>;
}

function Steps({ current, labels }: { current: number; labels: string[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
      {labels.map((label, idx) => {
        const n = idx + 1;
        const state = n < current ? "done" : n === current ? "active" : "todo";
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full text-[11px] font-semibold",
                state === "done" && "bg-emerald-600 text-white",
                state === "active" && "bg-primary text-primary-foreground",
                state === "todo" && "bg-muted text-muted-foreground",
              )}
            >
              {state === "done" ? <CheckCircle2 className="size-3.5" /> : n}
            </span>
            <span className={cn(state === "todo" ? "text-muted-foreground" : "font-medium")}>{label}</span>
            {n < labels.length && <span className="mx-1 h-px w-6 bg-border sm:w-10" />}
          </li>
        );
      })}
    </ol>
  );
}
