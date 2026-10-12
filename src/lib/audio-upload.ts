import "server-only";
import { z } from "zod";
import { ApiError } from "./api";
import { STT_MAX_SECONDS, transcribeAudio } from "./sarvam";
import { listIncidents } from "./incidents";
import { ALLOWED_AUDIO_MIME_TYPES, MAX_AUDIO_BYTES, normalizeMimeType } from "./validation";

/** BCP-47 codes accepted by Sarvam STT that we expose in the UI ("unknown" = auto-detect). */
export const sttLanguageSchema = z
  .enum(["unknown", "en-IN", "hi-IN", "bn-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN", "gu-IN"])
  .default("en-IN");

const MIN_AUDIO_BYTES = 1024;

/** Read duration from a PCM WAV header. Returns null when the file is not a parseable WAV. */
export function wavDurationSeconds(buf: Uint8Array): number | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (buf.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= buf.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") byteRate = view.getUint32(offset + 16, true);
    if (id === "data") return byteRate ? size / byteRate : null;
    offset += 8 + size + (size % 2);
  }
  return null;
}

/** Light magic-byte sniffing so obviously non-audio uploads are rejected before reaching Sarvam. */
export function looksLikeAudio(buf: Uint8Array): boolean {
  const ascii = (o: number, n: number) => String.fromCharCode(...buf.slice(o, o + n));
  return (
    ascii(0, 4) === "RIFF" || // WAV
    ascii(0, 4) === "OggS" || // OGG / Opus
    ascii(0, 4) === "fLaC" || // FLAC
    ascii(0, 3) === "ID3" || // MP3 with ID3
    (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) || // MP3 / AAC frame sync
    ascii(4, 4) === "ftyp" || // MP4 / M4A
    (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) || // WebM / Matroska
    ascii(0, 4) === "FORM" || // AIFF
    ascii(0, 5) === "#!AMR" // AMR
  );
}

export interface ValidatedAudio {
  bytes: Uint8Array;
  mime: string;
  filename: string;
  durationSeconds: number | null;
}

/** Validates an uploaded audio file (presence, size, type, magic bytes, ≤30 s for WAV). */
export async function validateAudioUpload(file: FormDataEntryValue | null): Promise<ValidatedAudio> {
  if (!(file instanceof File)) throw new ApiError(400, "missing_file", "Missing audio file.");
  if (file.size < MIN_AUDIO_BYTES) throw new ApiError(422, "audio_empty", "The audio recording is empty or too short.");
  if (file.size > MAX_AUDIO_BYTES) {
    throw new ApiError(413, "audio_too_large", `Audio exceeds the ${MAX_AUDIO_BYTES / 1024 / 1024} MB limit.`);
  }
  const mime = normalizeMimeType(file.type || "");
  if (!(ALLOWED_AUDIO_MIME_TYPES as readonly string[]).includes(mime)) {
    throw new ApiError(415, "unsupported_audio_type", `Unsupported audio type "${mime || "unknown"}". Use WAV, MP3, OGG, FLAC, M4A or WebM.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikeAudio(bytes)) throw new ApiError(422, "invalid_audio", "The uploaded file does not look like a valid audio file.");
  const durationSeconds = wavDurationSeconds(bytes);
  if (durationSeconds !== null && durationSeconds > STT_MAX_SECONDS + 0.5) {
    throw new ApiError(
      422,
      "audio_too_long",
      `Each audio segment must be ${STT_MAX_SECONDS}s or shorter (got ${durationSeconds.toFixed(1)}s). The recorder splits long handovers automatically.`,
    );
  }
  return { bytes, mime, filename: file.name || "audio.wav", durationSeconds };
}

/** Bias recognition toward incident IDs and service names (best effort; skipped if DB unavailable). */
async function incidentKeyterms(): Promise<string[]> {
  try {
    const incidents = await listIncidents({ includeResolved: false });
    const terms = new Set<string>();
    for (const i of incidents) {
      terms.add(i.id);
      terms.add(i.affectedService);
    }
    return [...terms].slice(0, 50);
  } catch {
    return [];
  }
}

/** Transcribes validated audio with Sarvam; throws 422 when no speech is detected. */
export async function transcribeValidated(audio: ValidatedAudio, languageCode: string) {
  const result = await transcribeAudio({
    file: new Blob([audio.bytes as BlobPart], { type: audio.mime }),
    filename: audio.filename,
    languageCode,
    keyterms: await incidentKeyterms(),
  });
  if (!result.transcript) {
    throw new ApiError(422, "empty_transcript", "No speech was detected in this audio. Try recording again closer to the microphone.");
  }
  return result;
}
