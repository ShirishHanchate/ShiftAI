import "server-only";
import { z } from "zod";
import { ApiError } from "./api";
import { structuredChat, type ChatMessage } from "./sarvam";

/** Remove validation keywords some strict-mode implementations reject; Zod re-validates afterwards. */
function stripKeywords(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripKeywords);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (["$schema", "minLength", "maxLength", "minimum", "maximum", "maxItems", "minItems", "pattern", "format"].includes(k)) continue;
      out[k] = stripKeywords(v);
    }
    return out;
  }
  return node;
}

/** JSON schema for Sarvam structured output, derived from the Zod schema so they cannot drift. */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  return stripKeywords(z.toJSONSchema(schema, { target: "draft-7", io: "output" })) as Record<string, unknown>;
}

function parseModelJson(content: string): unknown {
  // Tolerate leading reasoning or prose by taking the outermost JSON object.
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  const trimmed = (start >= 0 && end > start ? content.slice(start, end + 1) : content).trim();
  // Tolerate a fenced code block, but nothing else: no free-form "JSON hunting".
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

/**
 * Calls Sarvam with a strict JSON-schema response format and validates the result with Zod.
 * Attempt 1 uses low reasoning; if the output is truncated or malformed, attempt 2 disables
 * reasoning so the whole token budget goes to the answer. Malformed output is never returned.
 */
export interface ChatAttempt {
  reasoningEffort: "low" | "medium" | null;
  maxTokens?: number;
  temperature?: number;
  frequencyPenalty?: number;
  /**
   * "text": unconstrained output with the JSON schema given in the prompt (avoids sarvam-105b's
   * whitespace loops under constrained decoding). "json_schema": strict structured output.
   * Either way the result is validated with Zod.
   */
  mode?: "text" | "json_schema";
}

export async function chatJson<T extends z.ZodType>(params: {
  schema: T;
  schemaName: string;
  messages: ChatMessage[];
  maxTokens?: number;
  /**
   * Settings to try in order. Default: low reasoning, then none. With reasoning off the model is
   * fast but occasionally loops on whitespace inside strict JSON, so callers that disable reasoning
   * should use a small maxTokens to fail fast and retry with a different temperature.
   */
  attempts?: readonly ChatAttempt[];
}): Promise<{ data: z.infer<T>; model: string }> {
  const jsonSchema = jsonSchemaFor(params.schema);
  let lastProblem = "";
  const attempts = params.attempts ?? [{ reasoningEffort: "low" }, { reasoningEffort: null }];
  for (const attempt of attempts) {
    const textMode = attempt.mode === "text";
    const result = await structuredChat({
      messages: textMode
        ? [
            ...params.messages,
            {
              role: "system" as const,
              content:
                "Output ONLY one JSON object — no prose, no markdown, no code fences — that validates against this JSON Schema (every property is required; use null or [] when unknown):\n" +
                JSON.stringify(jsonSchema),
            },
          ]
        : params.messages,
      responseFormat: textMode ? "text" : "json_schema",
      schemaName: params.schemaName,
      schema: jsonSchema,
      maxTokens: attempt.maxTokens ?? params.maxTokens ?? 4096,
      reasoningEffort: attempt.reasoningEffort,
      temperature: attempt.temperature,
      frequencyPenalty: attempt.frequencyPenalty,
    });
    if (result.finishReason === "length") {
      lastProblem = "The model response was truncated (token limit reached).";
      continue;
    }
    let json: unknown;
    try {
      json = parseModelJson(result.content);
    } catch {
      lastProblem = "The model returned invalid JSON.";
      continue;
    }
    const parsed = params.schema.safeParse(json);
    if (!parsed.success) {
      lastProblem = `The model response failed schema validation (${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}).`;
      continue;
    }
    return { data: parsed.data, model: result.model };
  }
  throw new ApiError(502, "malformed_model_output", `${lastProblem} The response was rejected — please retry.`);
}
