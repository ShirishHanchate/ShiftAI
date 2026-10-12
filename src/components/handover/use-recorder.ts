"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pickRecorderMimeType } from "@/lib/audio";

export type RecorderStatus = "idle" | "requesting" | "recording" | "stopped" | "denied" | "unsupported" | "error";

/** Hard cap so a forgotten recording cannot grow without bound. */
export const MAX_RECORDING_SECONDS = 10 * 60;

export function useRecorder() {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [level, setLevel] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const startedAtRef = useRef(0);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    timerRef.current = null;
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevel(0);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  useEffect(() => {
    if (typeof window !== "undefined" && (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")) {
      // Feature detection must run on the client after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("unsupported");
    }
  }, []);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const start = useCallback(async () => {
    if (status === "recording" || status === "requesting") return;
    setError(null);
    setBlob(null);
    setElapsed(0);
    if (!window.isSecureContext) {
      setStatus("unsupported");
      setError("Microphone access requires HTTPS or localhost.");
      return;
    }
    setStatus("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      const name = (err as DOMException).name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        setStatus("denied");
        setError("Microphone permission was denied. Allow microphone access in your browser's site settings, or type the handover below.");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setStatus("error");
        setError("No microphone was found. Connect a microphone or use the text entry fallback.");
      } else {
        setStatus("error");
        setError(`Could not access the microphone (${name}).`);
      }
      return;
    }
    streamRef.current = stream;

    // Live input level meter.
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
        setLevel(peak);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* meter is cosmetic */
    }

    const mimeType = pickRecorderMimeType();
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = rec;
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const out = new Blob(chunksRef.current, { type: rec.mimeType || mimeType || "audio/webm" });
      cleanup();
      setBlob(out.size > 0 ? out : null);
      setStatus("stopped");
      if (out.size === 0) setError("The recording was empty. Please try again.");
    };
    rec.onerror = () => {
      cleanup();
      setStatus("error");
      setError("Recording failed unexpectedly. Please try again.");
    };
    rec.start(1000);
    startedAtRef.current = Date.now();
    setStatus("recording");
    timerRef.current = setInterval(() => {
      const secs = (Date.now() - startedAtRef.current) / 1000;
      setElapsed(secs);
      if (secs >= MAX_RECORDING_SECONDS) rec.stop();
    }, 250);
  }, [status, cleanup]);

  const reset = useCallback(() => {
    stop();
    cleanup();
    setBlob(null);
    setElapsed(0);
    setError(null);
    setStatus((s) => (s === "unsupported" ? s : "idle"));
  }, [stop, cleanup]);

  /** Use an uploaded file in place of a microphone recording. */
  const loadFile = useCallback((file: Blob) => {
    setBlob(file);
    setError(null);
    setElapsed(0);
    setStatus((s) => (s === "unsupported" || s === "denied" ? s : "stopped"));
  }, []);

  return { status, error, elapsed, blob, level, start, stop, reset, loadFile };
}
