import { z } from "zod";
import { SEVERITIES, STATUSES } from "@/types/incident";

/** Incident IDs look like INC-1042. Strictly validated before any DB lookup. */
export const incidentIdSchema = z
  .string()
  .trim()
  .regex(/^INC-\d{3,6}$/, "Incident ID must look like INC-1234");

const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .trim()
    .optional()
    .transform((raw, ctx) => {
      if (!raw) return undefined;
      const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
      const invalid = parts.filter((p) => !(values as readonly string[]).includes(p));
      if (invalid.length) {
        ctx.addIssue({
          code: "custom",
          message: `Invalid value(s): ${invalid.join(", ")}. Allowed: ${values.join(", ")}`,
        });
        return z.NEVER;
      }
      return parts as T[number][];
    });

export const incidentListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  severity: csvEnum(SEVERITIES),
  status: csvEnum(STATUSES),
  includeResolved: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v !== "false"),
});

export type IncidentListQuery = z.infer<typeof incidentListQuerySchema>;

// ---------------------------------------------------------------------------
// Voice transcription
// ---------------------------------------------------------------------------

/** 30 s of 16 kHz mono 16-bit WAV is ~1 MB; allow headroom for other codecs. */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/**
 * Formats accepted by Sarvam's REST speech-to-text endpoint (per docs):
 * WAV, MP3, AAC, AIFF, OGG/Opus, FLAC, MP4/M4A, AMR, WMA, WebM.
 * Raw PCM is deliberately excluded because it needs extra codec metadata.
 */
export const ALLOWED_AUDIO_MIME_TYPES = [
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/vnd.wave",
  "audio/mpeg",
  "audio/mp3",
  "audio/aac",
  "audio/x-aac",
  "audio/aiff",
  "audio/x-aiff",
  "audio/ogg",
  "audio/opus",
  "audio/flac",
  "audio/x-flac",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/amr",
  "audio/x-ms-wma",
  "audio/webm",
  "video/webm",
] as const;

export function normalizeMimeType(type: string): string {
  return type.split(";")[0].trim().toLowerCase();
}

export const transcribeResponseSchema = z.object({
  transcript: z.string(),
  languageCode: z.string().nullable(),
  requestId: z.string().nullable(),
});
export type TranscribeResponse = z.infer<typeof transcribeResponseSchema>;

// ---------------------------------------------------------------------------
// Handover extraction
// ---------------------------------------------------------------------------

export const MAX_TRANSCRIPT_CHARS = 20_000;

export const extractRequestSchema = z.object({
  transcript: z
    .string()
    .trim()
    .min(20, "Transcript is too short to extract a handover (minimum 20 characters).")
    .max(MAX_TRANSCRIPT_CHARS, `Transcript exceeds ${MAX_TRANSCRIPT_CHARS} characters.`),
  incidentIds: z.array(incidentIdSchema).max(50).optional(),
});
export type ExtractRequest = z.infer<typeof extractRequestSchema>;

const nonEmpty = z.string().trim().min(1);

/**
 * Shape the LLM must return. Every field is required (nullable where the
 * information may be absent) so strict JSON-schema mode can be used and so the
 * model is forced to make "unknown" explicit rather than omitting it.
 */
export const llmPendingActionSchema = z.object({
  description: nonEmpty,
  owner: z.string().trim().min(1).nullable(),
  dueAt: z.string().trim().min(1).nullable(),
  evidence: z.string(),
});

export const llmIncidentUpdateSchema = z.object({
  incidentId: z.string().trim().min(1).nullable(),
  mentionedAs: nonEmpty,
  matchConfidence: z.enum(["high", "medium", "low"]),
  matchReason: z.string(),
  currentSituation: z.string(),
  actionsCompleted: z.array(z.object({ description: nonEmpty, evidence: z.string() })),
  pendingActions: z.array(llmPendingActionSchema),
  blockers: z.array(nonEmpty),
  owner: z.string().trim().min(1).nullable(),
  ownerEvidence: z.string().nullable(),
  nextUpdateAt: z.string().trim().min(1).nullable(),
  nextUpdateEvidence: z.string().nullable(),
  proposedStatus: z.enum(["Open", "Investigating", "Monitoring", "Resolved"]).nullable(),
  statusEvidence: z.string().nullable(),
  unresolvedQuestions: z.array(nonEmpty),
  missingFields: z.array(nonEmpty),
  recommendations: z.array(nonEmpty),
  confidence: z.number().min(0).max(1),
});

export const llmExtractionSchema = z.object({
  incidents: z.array(llmIncidentUpdateSchema).max(50),
  generalNotes: z.array(z.string()),
});

export type LlmExtraction = z.infer<typeof llmExtractionSchema>;
export type LlmIncidentUpdate = z.infer<typeof llmIncidentUpdateSchema>;

// ---------------------------------------------------------------------------
// Handover confirmation (Phase 3)
// ---------------------------------------------------------------------------

const isoDateTime = z.iso.datetime({ offset: true });
const shortText = (max: number) => z.string().trim().min(1).max(max);

export const incidentChangesSchema = z.object({
  /** Replaces the incident summary when non-null. */
  currentSituation: z.string().trim().max(2000).nullable(),
  actionsCompletedAdd: z.array(shortText(500)).max(30),
  pendingActionsAdd: z
    .array(z.object({ description: shortText(500), owner: shortText(120).nullable(), dueAt: isoDateTime.nullable() }))
    .max(30),
  /** Descriptions of EXISTING pending actions the reviewer marked as done. */
  completeExistingActions: z.array(shortText(500)).max(30),
  blockersAdd: z.array(shortText(500)).max(20),
  /** Existing blockers the reviewer explicitly cleared. */
  blockersCleared: z.array(shortText(500)).max(20),
  owner: shortText(120).nullable(),
  nextUpdateAt: isoDateTime.nullable(),
  status: z.enum(["Open", "Investigating", "Monitoring", "Resolved"]).nullable(),
  /** Must be true to move an incident to Resolved — an explicit human confirmation. */
  resolutionConfirmed: z.boolean().default(false),
});
export type IncidentChanges = z.infer<typeof incidentChangesSchema>;

const approveDecision = z.object({
  decision: z.literal("approve"),
  incidentId: incidentIdSchema,
  /** incident.updatedAt as seen by the reviewer — guards against concurrent edits. */
  expectedUpdatedAt: isoDateTime,
  changes: incidentChangesSchema,
  recommendations: z.array(z.string().max(500)).max(20).default([]),
  missingFields: z.array(z.string().max(100)).max(20).default([]),
  unresolvedQuestions: z.array(z.string().max(500)).max(20).default([]),
});

const rejectDecision = z.object({
  decision: z.literal("reject"),
  incidentId: incidentIdSchema.nullable(),
  mentionedAs: z.string().max(300).default(""),
  reason: z.string().max(500).optional(),
});

export const confirmRequestSchema = z
  .object({
    idempotencyKey: z.uuid(),
    originalTranscript: z.string().trim().min(1).max(MAX_TRANSCRIPT_CHARS),
    editedTranscript: z.string().trim().min(1).max(MAX_TRANSCRIPT_CHARS),
    outgoingShift: shortText(80),
    incomingShift: shortText(80),
    submittedBy: z.string().trim().max(80).optional(),
    decisions: z.array(z.discriminatedUnion("decision", [approveDecision, rejectDecision])).min(1).max(50),
  })
  .superRefine((req, ctx) => {
    const seen = new Set<string>();
    req.decisions.forEach((d, i) => {
      if (d.decision !== "approve") return;
      if (seen.has(d.incidentId)) {
        ctx.addIssue({ code: "custom", path: ["decisions", i, "incidentId"], message: `${d.incidentId} is approved more than once.` });
      }
      seen.add(d.incidentId);
      if (d.changes.status === "Resolved" && !d.changes.resolutionConfirmed) {
        ctx.addIssue({
          code: "custom",
          path: ["decisions", i, "changes", "resolutionConfirmed"],
          message: `Resolving ${d.incidentId} requires explicit confirmation.`,
        });
      }
    });
  });
export type ConfirmRequest = z.infer<typeof confirmRequestSchema>;
export type ApproveDecision = z.infer<typeof approveDecision>;
