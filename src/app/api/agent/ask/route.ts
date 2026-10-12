import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleRouteError, jsonError } from "@/lib/api";
import { askAgent } from "@/lib/agent";
import { sttLanguageSchema, transcribeValidated, validateAudioUpload } from "@/lib/audio-upload";
import { MAX_AUDIO_BYTES } from "@/lib/validation";

const historySchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().max(4000),
      incidentIds: z.array(z.string().max(20)).max(20).optional(),
    }),
  )
  .max(12)
  .default([]);

const askSchema = z.object({
  question: z.string().trim().min(3, "Question is too short.").max(1000, "Question is too long (max 1000 characters)."),
  history: historySchema,
});

/**
 * Read-only incident Q&A.
 *  - JSON:      { question, history? }
 *  - Multipart: audio (≤30 s), languageCode?, history? (JSON string) — transcribed with Sarvam first.
 */
export async function POST(request: Request) {
  try {
    const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
    let question: string;
    let historyRaw: unknown = [];
    let transcript: string | null = null;

    if (contentType.startsWith("multipart/form-data")) {
      if (Number(request.headers.get("content-length") ?? 0) > MAX_AUDIO_BYTES + 64 * 1024) {
        return jsonError(413, "audio_too_large", "Audio question is too large.");
      }
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return jsonError(400, "invalid_form", "Could not parse multipart form data.");
      }
      const language = sttLanguageSchema.safeParse(form.get("languageCode") ?? undefined);
      if (!language.success) return jsonError(400, "invalid_language", "Unsupported languageCode.");
      const h = form.get("history");
      if (typeof h === "string" && h) {
        try {
          historyRaw = JSON.parse(h);
        } catch {
          return jsonError(400, "invalid_history", "history must be a JSON array.");
        }
      }
      const audio = await validateAudioUpload(form.get("audio"));
      const stt = await transcribeValidated(audio, language.data);
      transcript = stt.transcript;
      question = stt.transcript;
    } else if (contentType.startsWith("application/json")) {
      let body: { question?: unknown; history?: unknown };
      try {
        body = await request.json();
      } catch {
        return jsonError(400, "invalid_json", "Request body must be JSON.");
      }
      question = typeof body.question === "string" ? body.question : "";
      historyRaw = body.history ?? [];
    } else {
      return jsonError(415, "unsupported_media_type", "Send JSON { question } or multipart audio.");
    }

    const parsed = askSchema.safeParse({ question, history: historyRaw });
    if (!parsed.success) {
      throw new ApiError(400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request.");
    }
    const answer = await askAgent(parsed.data.question, parsed.data.history);
    return NextResponse.json({ question: parsed.data.question, transcript, ...answer });
  } catch (err) {
    return handleRouteError(err, "POST /api/agent/ask");
  }
}
