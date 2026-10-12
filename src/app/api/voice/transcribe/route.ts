import { NextResponse } from "next/server";
import { handleRouteError, jsonError } from "@/lib/api";
import { STT_MODEL } from "@/lib/sarvam";
import { sttLanguageSchema, transcribeValidated, validateAudioUpload } from "@/lib/audio-upload";
import { MAX_AUDIO_BYTES, type TranscribeResponse } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return jsonError(415, "unsupported_media_type", "Send audio as multipart/form-data with a `file` field.");
    }
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_AUDIO_BYTES + 64 * 1024) {
      return jsonError(413, "audio_too_large", `Audio exceeds the ${MAX_AUDIO_BYTES / 1024 / 1024} MB limit.`);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError(400, "invalid_form", "Could not parse multipart form data.");
    }

    const language = sttLanguageSchema.safeParse(form.get("languageCode") ?? undefined);
    if (!language.success) return jsonError(400, "invalid_language", "Unsupported languageCode.");

    const audio = await validateAudioUpload(form.get("file"));
    const result = await transcribeValidated(audio, language.data);

    const response: TranscribeResponse & { model: string; durationSeconds: number | null } = {
      transcript: result.transcript,
      languageCode: result.languageCode,
      requestId: result.requestId,
      model: STT_MODEL,
      durationSeconds: audio.durationSeconds,
    };
    return NextResponse.json(response);
  } catch (err) {
    return handleRouteError(err, "POST /api/voice/transcribe");
  }
}
