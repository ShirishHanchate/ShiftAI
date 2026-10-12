"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  CircleHelp,
  Lightbulb,
  Loader2,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Send,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SeverityBadge, StatusBadge } from "@/components/incidents/badges";
import { useRecorder } from "@/components/handover/use-recorder";
import { prepareSegments } from "@/lib/audio";
import { formatDuration } from "@/lib/format";
import type { Incident } from "@/types/incident";

interface AgentReply {
  answer: string;
  incidentIds: string[];
  references: { id: string; title: string; severity: Incident["severity"]; status: Incident["status"] }[];
  missingInformation: string[];
  recommendations: string[];
  unknownIncidentIds: string[];
  warnings: string[];
}

type Tts = { state: "idle" } | { state: "loading" } | { state: "ready"; url: string } | { state: "error"; message: string };

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  viaVoice?: boolean;
  reply?: AgentReply;
  tts?: Tts;
  error?: string;
  retryQuestion?: string;
}

const SUGGESTIONS = [
  "What should I prioritize at the start of my shift?",
  "Which follow-ups are overdue?",
  "Which incidents are blocked by another team?",
  "What is pending on INC-1042?",
  "What troubleshooting has been done on INC-1044?",
  "What information is missing from the last handover?",
];

const MAX_QUESTION_SECONDS = 25;

async function readError(res: Response) {
  const body = await res.json().catch(() => null);
  return (body?.error?.message as string) ?? `Request failed (HTTP ${res.status}).`;
}

export function AgentChat() {
  const recorder = useRecorder();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<false | "transcribing" | "thinking">(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const busyRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const handledBlob = useRef<Blob | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  // Revoke cached audio URLs on unmount.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  useEffect(
    () => () => {
      for (const m of messagesRef.current) if (m.tts?.state === "ready") URL.revokeObjectURL(m.tts.url);
      audioRef.current?.pause();
    },
    [],
  );

  const patch = (id: string, p: Partial<Message>) => setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...p } : m)));

  function history() {
    return messages
      .filter((m) => !m.error)
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.role === "assistant" ? (m.reply?.answer ?? m.content) : m.content, incidentIds: m.reply?.incidentIds }));
  }

  function stopAudio() {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    setPlayingId(null);
  }

  function playUrl(id: string, url: string) {
    stopAudio();
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.src = url;
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => setPlayingId(null);
    audio
      .play()
      .then(() => setPlayingId(id))
      .catch(() => setPlayingId(null)); // autoplay may be blocked; the Play button still works
  }

  /** Fetches TTS once per answer and caches the audio URL on the message. */
  async function speak(msg: Message) {
    if (msg.tts?.state === "ready") return playUrl(msg.id, msg.tts.url);
    if (msg.tts?.state === "loading" || !msg.reply) return;
    patch(msg.id, { tts: { state: "loading" } });
    try {
      const res = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: msg.reply.answer }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const url = URL.createObjectURL(await res.blob());
      patch(msg.id, { tts: { state: "ready", url } });
      playUrl(msg.id, url);
    } catch (err) {
      patch(msg.id, { tts: { state: "error", message: (err as Error).message } });
    }
  }

  async function ask(question: string, opts: { audio?: Blob } = {}) {
    if (busyRef.current) return;
    busyRef.current = true;
    stopAudio();
    const userId = crypto.randomUUID();
    const hist = history();
    setMessages((ms) => [...ms, { id: userId, role: "user", content: opts.audio ? "🎙️ Voice question…" : question, viaVoice: !!opts.audio }]);
    try {
      let res: Response;
      if (opts.audio) {
        setBusy("transcribing");
        const form = new FormData();
        form.append("audio", opts.audio, "question.wav");
        form.append("languageCode", "en-IN");
        form.append("history", JSON.stringify(hist));
        res = await fetch("/api/agent/ask", { method: "POST", body: form });
      } else {
        setBusy("thinking");
        res = await fetch("/api/agent/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, history: hist }),
        });
      }
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as AgentReply & { question: string; transcript: string | null };
      if (body.transcript) patch(userId, { content: body.transcript });
      const reply: Message = { id: crypto.randomUUID(), role: "assistant", content: body.answer, reply: body, tts: { state: "idle" } };
      setMessages((ms) => [...ms, reply]);
      if (autoSpeak) void speak(reply);
    } catch (err) {
      const message = (err as Error).message;
      if (opts.audio) patch(userId, { content: "🎙️ Voice question (not understood)" });
      setMessages((ms) => [
        ...ms,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          error: err instanceof TypeError ? "Network error — please retry." : message,
          retryQuestion: opts.audio ? undefined : question,
        },
      ]);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // When a recording finishes, prepare it and send it.
  useEffect(() => {
    const blob = recorder.blob;
    if (!blob || recorder.status !== "stopped" || handledBlob.current === blob) return;
    handledBlob.current = blob;
    void (async () => {
      try {
        const prepared = await prepareSegments(blob);
        if (prepared.silent) throw new Error("I didn't hear anything — check your microphone and try again.");
        if (prepared.durationSeconds > MAX_QUESTION_SECONDS + 5 || prepared.segments.length > 1) {
          throw new Error(`Keep spoken questions under ${MAX_QUESTION_SECONDS} seconds, or type the question.`);
        }
        await ask("", { audio: prepared.segments[0] });
      } catch (err) {
        setMessages((ms) => [...ms, { id: crypto.randomUUID(), role: "assistant", content: "", error: (err as Error).message }]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.blob, recorder.status]);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const q = input.trim();
    if (q.length < 3 || busy) return;
    setInput("");
    void ask(q);
  }

  const recording = recorder.status === "recording";
  const micBlocked = recorder.status === "denied" || recorder.status === "unsupported";

  return (
    <div className="flex h-[calc(100vh-11rem)] min-h-[520px] flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="flex items-center gap-2 border-b px-4 py-2.5 text-xs text-muted-foreground">
        <Bot className="size-4 text-primary" />
        Read-only copilot · answers only from saved incidents and confirmed handovers
        <button
          type="button"
          onClick={() => {
            setAutoSpeak((v) => !v);
            stopAudio();
          }}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted"
          aria-pressed={autoSpeak}
        >
          {autoSpeak ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
          {autoSpeak ? "Speak answers" : "Muted"}
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-8 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Bot className="size-6" />
            </span>
            <div>
              <p className="font-semibold">Ask about incidents, actions and handovers</p>
              <p className="mt-1 text-sm text-muted-foreground">Type a question or hold a short voice conversation.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void ask(s)}
                  disabled={!!busy}
                  className="rounded-full border bg-background px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                {m.viaVoice && <span className="mb-0.5 block text-[10px] tracking-wide uppercase opacity-70">Heard</span>}
                {m.content}
              </div>
            </div>
          ) : m.error ? (
            <div key={m.id} className="flex max-w-[85%] items-start gap-2 rounded-2xl rounded-bl-md bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p>{m.error}</p>
                {m.retryQuestion && (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => void ask(m.retryQuestion!)} disabled={!!busy}>
                    <RotateCcw /> Retry
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <AssistantBubble
              key={m.id}
              message={m}
              playing={playingId === m.id}
              onPlay={() => void speak(m)}
              onStop={stopAudio}
            />
          ),
        )}

        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {busy === "transcribing" ? "Transcribing your question and checking records…" : "Checking incident records…"}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="flex items-end gap-2 border-t p-3">
        <Button
          type="button"
          size="icon-lg"
          variant={recording ? "destructive" : "outline"}
          onClick={recording ? recorder.stop : recorder.start}
          disabled={(!!busy && !recording) || micBlocked}
          aria-label={recording ? "Stop recording" : "Ask by voice"}
          title={micBlocked ? "Microphone unavailable — type your question" : undefined}
          className="shrink-0"
        >
          {recording ? <Square className="fill-current" /> : <Mic />}
        </Button>
        {recording ? (
          <div className="flex h-10 flex-1 items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 text-sm text-red-700">
            <span className="size-2 animate-pulse rounded-full bg-red-600" />
            Listening… {formatDuration(recorder.elapsed)} — press stop when done
          </div>
        ) : (
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 1000))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={micBlocked ? "Microphone unavailable — type your question…" : "Ask a question, e.g. “What is pending on INC-1042?”"}
            className="max-h-32 min-h-10 flex-1 resize-none text-sm"
            rows={1}
            aria-label="Question"
          />
        )}
        <Button type="submit" size="icon-lg" disabled={!!busy || recording || input.trim().length < 3} aria-label="Send" className="shrink-0">
          <Send />
        </Button>
      </form>
      {recorder.error && <p className="border-t bg-amber-50 px-4 py-2 text-xs text-amber-900">{recorder.error}</p>}
    </div>
  );
}

function AssistantBubble({ message: m, playing, onPlay, onStop }: { message: Message; playing: boolean; onPlay: () => void; onStop: () => void }) {
  const r = m.reply!;
  const tts = m.tts ?? { state: "idle" };
  return (
    <div className="flex max-w-[90%] flex-col gap-2">
      <div className="rounded-2xl rounded-bl-md bg-muted/60 px-3.5 py-2.5 text-sm leading-relaxed">
        <p className="whitespace-pre-wrap">{r.answer}</p>

        {r.references.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {r.references.map((ref) => (
              <Link
                key={ref.id}
                href={`/incidents/${ref.id}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-background px-2 py-1 text-xs ring-1 ring-border hover:bg-muted"
                title={ref.title}
              >
                <SeverityBadge severity={ref.severity} className="h-4 text-[10px]" />
                <span className="font-mono">{ref.id}</span>
                <StatusBadge status={ref.status} className="h-4 text-[10px]" />
              </Link>
            ))}
          </div>
        )}

        {r.missingInformation.length > 0 && (
          <div className="mt-2.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
            <p className="mb-0.5 flex items-center gap-1 font-medium">
              <CircleHelp className="size-3" /> Not recorded
            </p>
            <ul className="list-disc pl-4">
              {r.missingInformation.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        )}
        {r.recommendations.length > 0 && (
          <div className="mt-2 rounded-lg bg-blue-50/70 p-2 text-xs text-blue-950">
            <p className="mb-0.5 flex items-center gap-1 font-medium">
              <Lightbulb className="size-3" /> Suggestions (AI, not recorded facts)
            </p>
            <ul className="list-disc pl-4">
              {r.recommendations.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        )}
        {r.warnings.length > 0 && (
          <p className="mt-2 flex gap-1 text-xs text-amber-800">
            <AlertCircle className="mt-0.5 size-3 shrink-0" /> {r.warnings.join(" ")}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1.5 pl-1 text-xs text-muted-foreground">
        {tts.state === "loading" ? (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" /> Generating speech…
          </span>
        ) : playing ? (
          <button onClick={onStop} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted">
            <Pause className="size-3" /> Stop
          </button>
        ) : (
          <button onClick={onPlay} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted">
            {tts.state === "ready" ? <RotateCcw className="size-3" /> : <Play className="size-3" />}
            {tts.state === "ready" ? "Replay" : "Play answer"}
          </button>
        )}
        {tts.state === "error" && <span className="text-amber-700">Audio unavailable: {tts.message}</span>}
      </div>
    </div>
  );
}

