import { z } from "zod";
import { handleRouteError, jsonError } from "@/lib/api";
import { TTS_LANGUAGES, TTS_MAX_CHARS, textToSpeech } from "@/lib/sarvam";

const speakSchema = z.object({
  text: z.string().trim().min(1, "Text is empty.").max(TTS_MAX_CHARS, `Text exceeds ${TTS_MAX_CHARS} characters.`),
  languageCode: z.enum(TTS_LANGUAGES).default("en-IN"),
});

/** Make text friendlier to speak: "INC-1042" → "INC 1042", drop markdown symbols. */
function speakable(text: string): string {
  return text
    .replace(/\bINC-(\d+)/g, "INC $1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Converts text to MP3 speech via Sarvam. Returns audio/mpeg bytes. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_json", "Request body must be JSON.");
  }
  const parsed = speakSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request.");
  try {
    const audio = await textToSpeech({ text: speakable(parsed.data.text), languageCode: parsed.data.languageCode });
    return new Response(audio as BodyInit, {
      status: 200,
      headers: { "Content-Type": "audio/mpeg", "Content-Length": String(audio.byteLength), "Cache-Control": "private, max-age=3600" },
    });
  } catch (err) {
    return handleRouteError(err, "POST /api/voice/speak");
  }
}
