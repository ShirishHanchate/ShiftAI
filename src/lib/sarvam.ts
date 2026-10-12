import "server-only";
import { requireEnv } from "./env";
import { ApiError } from "./api";

/**
 * Thin client for the Sarvam AI REST API, written against the official docs:
 *  - Speech-to-text:  POST https://api.sarvam.ai/speech-to-text  (multipart, header `api-subscription-key`)
 *    https://docs.sarvam.ai/api-reference-docs/speech-to-text/transcribe
 *  - Chat completion: POST https://api.sarvam.ai/v1/chat/completions (JSON)
 *    https://docs.sarvam.ai/api-reference-docs/chat/chat-completions
 *
 * The API key is read server-side only and is never logged or returned.
 */
const SARVAM_BASE_URL = "https://api.sarvam.ai";

/** Default / recommended STT model per Sarvam docs. */
export const STT_MODEL = "saaras:v4";
/** Sarvam's flagship chat model served on /v1/chat/completions. */
export const CHAT_MODEL = "sarvam-105b";

/** Sarvam's synchronous REST STT accepts at most 30 s of audio per request. */
export const STT_MAX_SECONDS = 30;

const STT_TIMEOUT_MS = 60_000;
const CHAT_TIMEOUT_MS = 120_000;

interface SarvamErrorBody {
  error?: { message?: string; code?: string; request_id?: string };
}

function authHeaders(): Record<string, string> {
  return { "api-subscription-key": requireEnv("SARVAM_API_KEY") };
}

/** Translate a non-2xx Sarvam response into a safe ApiError for our clients. */
async function toApiError(res: Response, operation: string): Promise<ApiError> {
  let body: SarvamErrorBody = {};
  try {
    body = (await res.json()) as SarvamErrorBody;
  } catch {
    /* non-JSON error body */
  }
  const upstreamCode = body.error?.code ?? "unknown";
  const requestId = body.error?.request_id;
  // Upstream messages describe the request (not secrets), but keep them short.
  const upstreamMessage = (body.error?.message ?? res.statusText ?? "").slice(0, 300);
  console.error(`[sarvam:${operation}] HTTP ${res.status} code=${upstreamCode} request_id=${requestId ?? "-"}`);

  const details = { upstreamStatus: res.status, upstreamCode, requestId };
  switch (res.status) {
    case 400:
    case 422:
      return new ApiError(422, "sarvam_rejected_input", `Sarvam could not process the ${operation} request: ${upstreamMessage}`, details);
    case 401:
    case 403:
      return new ApiError(502, "sarvam_auth_failed", "Sarvam rejected the API key. Check SARVAM_API_KEY on the server.", details);
    case 429:
      return new ApiError(429, "sarvam_rate_limited", "Sarvam rate limit or quota exceeded. Wait a moment and retry.", details);
    case 503:
      return new ApiError(503, "sarvam_overloaded", "Sarvam is temporarily overloaded. Please retry shortly.", details);
    default:
      return new ApiError(502, "sarvam_error", `Sarvam ${operation} failed (HTTP ${res.status}).`, details);
  }
}

async function sarvamFetch(path: string, init: RequestInit, timeoutMs: number, operation: string): Promise<Response> {
  try {
    return await fetch(`${SARVAM_BASE_URL}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  } catch (err) {
    const name = (err as Error).name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ApiError(504, "sarvam_timeout", `Sarvam ${operation} timed out after ${timeoutMs / 1000}s. Please retry.`);
    }
    console.error(`[sarvam:${operation}] network error: ${name}`);
    throw new ApiError(502, "sarvam_unreachable", `Could not reach Sarvam for ${operation}. Check network connectivity.`);
  }
}

// ---------------------------------------------------------------------------
// Speech-to-text
// ---------------------------------------------------------------------------

export interface SarvamTranscription {
  transcript: string;
  languageCode: string | null;
  requestId: string | null;
}

export async function transcribeAudio(params: {
  file: Blob;
  filename: string;
  languageCode?: string;
  keyterms?: string[];
}): Promise<SarvamTranscription> {
  const form = new FormData();
  form.append("file", params.file, params.filename);
  form.append("model", STT_MODEL);
  if (params.languageCode) form.append("language_code", params.languageCode);
  // keyterms: JSON-encoded array, ≤50 terms of ≤64 chars, saaras:v4 only.
  const keyterms = (params.keyterms ?? []).map((k) => k.slice(0, 64)).filter(Boolean).slice(0, 50);
  if (keyterms.length) form.append("keyterms", JSON.stringify(keyterms));

  const res = await sarvamFetch("/speech-to-text", { method: "POST", headers: authHeaders(), body: form }, STT_TIMEOUT_MS, "transcription");
  if (!res.ok) throw await toApiError(res, "transcription");

  const body = (await res.json()) as { transcript?: unknown; language_code?: unknown; request_id?: unknown };
  if (typeof body.transcript !== "string") {
    throw new ApiError(502, "sarvam_bad_response", "Sarvam returned an unexpected transcription response.");
  }
  return {
    transcript: body.transcript.trim(),
    languageCode: typeof body.language_code === "string" ? body.language_code : null,
    requestId: typeof body.request_id === "string" ? body.request_id : null,
  };
}

// ---------------------------------------------------------------------------
// Chat completion (structured output)
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StructuredChatResult {
  content: string;
  finishReason: string | null;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export async function structuredChat(params: {
  messages: ChatMessage[];
  schemaName?: string;
  schema?: Record<string, unknown>;
  maxTokens?: number;
  /** null disables reasoning ("thinking"), which leaves the full token budget for the answer. */
  reasoningEffort?: "low" | "medium" | "high" | null;
  responseFormat?: "json_schema" | "json_object" | "text";
  temperature?: number;
  /** Penalises repeated tokens; mitigates whitespace loops in constrained JSON output. */
  frequencyPenalty?: number;
  /** Used in error messages, e.g. "extraction" or "answer". */
  operation?: string;
}): Promise<StructuredChatResult> {
  const responseFormat =
    params.responseFormat === "json_object"
      ? { type: "json_object" }
      : params.responseFormat === "text"
        ? { type: "text" }
        : { type: "json_schema", json_schema: { name: params.schemaName ?? "output", strict: true, schema: params.schema ?? {} } };
  const operation = params.operation ?? "extraction";

  const payload = {
    model: CHAT_MODEL,
    messages: params.messages,
    temperature: params.temperature ?? 0.1,
    ...(params.frequencyPenalty ? { frequency_penalty: params.frequencyPenalty } : {}),
    max_tokens: params.maxTokens ?? 4096,
    reasoning_effort: params.reasoningEffort === undefined ? "low" : params.reasoningEffort,
    response_format: responseFormat,
  };

  const res = await sarvamFetch(
    "/v1/chat/completions",
    { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    CHAT_TIMEOUT_MS,
    operation,
  );
  if (!res.ok) throw await toApiError(res, operation);

  const body = (await res.json()) as {
    model?: string;
    choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
    usage?: StructuredChatResult["usage"];
  };
  const choice = body.choices?.[0];
  return {
    content: choice?.message?.content ?? "",
    finishReason: choice?.finish_reason ?? null,
    model: body.model ?? CHAT_MODEL,
    usage: body.usage,
  };
}

// ---------------------------------------------------------------------------
// Text-to-speech
// https://docs.sarvam.ai/api-reference-docs/text-to-speech/convert
// ---------------------------------------------------------------------------

export const TTS_MODEL = "bulbul:v3";
export const TTS_SPEAKER = "priya";
/** bulbul:v3 accepts up to 2500 characters per request. */
export const TTS_MAX_CHARS = 2500;
const TTS_TIMEOUT_MS = 45_000;

export const TTS_LANGUAGES = ["en-IN", "hi-IN", "bn-IN", "gu-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN"] as const;

/** Returns MP3 audio bytes for the given text. */
export async function textToSpeech(params: { text: string; languageCode?: (typeof TTS_LANGUAGES)[number] }): Promise<Uint8Array> {
  const payload = {
    text: params.text,
    language_code: params.languageCode ?? "en-IN",
    model: TTS_MODEL,
    speaker: TTS_SPEAKER,
    pace: 1.05,
    speech_sample_rate: 24000,
    output_audio_codec: "mp3",
  };
  const res = await sarvamFetch(
    "/text-to-speech",
    { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    TTS_TIMEOUT_MS,
    "speech synthesis",
  );
  if (!res.ok) throw await toApiError(res, "speech synthesis");
  const body = (await res.json()) as { audios?: unknown };
  if (!Array.isArray(body.audios) || body.audios.length === 0 || body.audios.some((a) => typeof a !== "string")) {
    throw new ApiError(502, "sarvam_bad_response", "Sarvam returned no audio.");
  }
  const chunks = (body.audios as string[]).map((b64) => Buffer.from(b64, "base64"));
  const audio = Buffer.concat(chunks);
  if (audio.length === 0) throw new ApiError(502, "sarvam_bad_response", "Sarvam returned empty audio.");
  return new Uint8Array(audio);
}
