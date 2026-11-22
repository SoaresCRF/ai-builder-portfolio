import { GoogleGenAI, type GenerateContentConfig } from "@google/genai";
import { RateLimitedError, UpstreamError } from "./errors.js";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt.js";
import {
  ModelOutputSchema,
  modelOutputJsonSchema,
  type ModelOutput,
  type NotesRequest,
} from "./schemas.js";

export const GEMINI_TIMEOUT_MS = 50_000;
const HTTP_TOO_MANY_REQUESTS = 429;
const TEMPERATURE = 0.2;
const MAX_ATTEMPTS = 2; // one retry, only on invalid model output

export type GenerateFn = (args: {
  model: string;
  contents: string;
  config: GenerateContentConfig;
}) => Promise<{ text?: string }>;

// The SDK's responseJsonSchema does not list `$schema` among supported keys.
const { $schema: _omit, ...responseJsonSchema } = modelOutputJsonSchema as Record<string, unknown>;

function parseOutput(text: string | undefined): ModelOutput | null {
  if (!text) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null; // invalid JSON is an expected model failure, handled by the retry
  }
  const parsed = ModelOutputSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export async function extractNotes(
  req: NotesRequest,
  deps: { generate: GenerateFn; model: string },
): Promise<ModelOutput> {
  const contents = buildUserPrompt(req);
  // GEMINI_TIMEOUT_MS is the budget for the whole call, retry included.
  const deadline = Date.now() + GEMINI_TIMEOUT_MS;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new UpstreamError("Model call timed out");
    let text: string | undefined;
    try {
      ({ text } = await deps.generate({
        model: deps.model,
        contents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseJsonSchema,
          temperature: TEMPERATURE,
          abortSignal: AbortSignal.timeout(remainingMs),
        },
      }));
    } catch (err) {
      // Duck-typed so it works for the SDK's ApiError and plain test fakes.
      const status = (err as { status?: unknown })?.status;
      if (status === HTTP_TOO_MANY_REQUESTS) {
        throw new RateLimitedError();
      }
      const name = err instanceof Error ? err.name : "unknown";
      // Do not forward err.message: it could echo prompt content.
      throw new UpstreamError(`Model call failed (${name})`, {
        errorName: name,
        status: typeof status === "number" ? status : undefined,
      });
    }
    const out = parseOutput(text);
    if (out) return out;
  }
  throw new UpstreamError("Model returned invalid output");
}

export function createGeminiGenerate(apiKey: string): GenerateFn {
  const ai = new GoogleGenAI({ apiKey });
  return (args) => ai.models.generateContent(args);
}
