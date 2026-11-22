import { timingSafeEqual } from "node:crypto";
import { RateLimitedError, UpstreamError } from "./errors.js";
import { groundNotes } from "./grounding.js";
import { errorResponse, jsonResponse } from "./http.js";
import { NotesRequestSchema, type ModelOutput, type NotesRequest } from "./schemas.js";

type HandlerDeps = {
  env: { ACCESS_KEY?: string; GEMINI_MODEL?: string; GEMINI_API_KEY?: string };
  extract: (req: NotesRequest) => Promise<ModelOutput>;
};

function keyMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createHandler({ env, extract }: HandlerDeps) {
  return async (request: Request): Promise<Response> => {
    // Fail closed: a misconfigured deployment must never serve requests.
    if (!env.ACCESS_KEY || !env.GEMINI_MODEL || !env.GEMINI_API_KEY) {
      console.error("Server misconfigured: missing required environment variable");
      return errorResponse(500, "internal_error", "Internal server error");
    }
    if (request.method !== "POST") {
      return errorResponse(405, "method_not_allowed", "Use POST", { Allow: "POST" });
    }
    if (!keyMatches(request.headers.get("x-api-key") ?? "", env.ACCESS_KEY)) {
      return errorResponse(401, "unauthorized", "Invalid or missing API key");
    }

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return errorResponse(400, "invalid_request", "Body must be valid JSON");
    }
    const parsed = NotesRequestSchema.safeParse(json);
    if (!parsed.success) {
      return errorResponse(400, "invalid_request", "Invalid request body");
    }

    try {
      const output = await extract(parsed.data);
      const { notes, corrections } = groundNotes(output, parsed.data.transcript, parsed.data.meetingDate);
      for (const c of corrections) {
        console.warn(JSON.stringify({ event: "grounding_correction", ...c }));
      }
      return jsonResponse(notes);
    } catch (err) {
      if (err instanceof RateLimitedError) {
        console.warn(JSON.stringify({ event: "rate_limited" }));
        return errorResponse(429, "rate_limited", "Rate limit reached, retry later");
      }
      if (err instanceof UpstreamError) {
        // reason is a fixed string authored in gemini.ts, safe to log.
        console.error(
          JSON.stringify({ event: "upstream_error", reason: err.message, errorName: err.errorName, status: err.status }),
        );
        return errorResponse(502, "upstream_error", "Upstream model failure");
      }
      // Log the name only: messages could echo transcript content.
      console.error(`Unexpected error: ${err instanceof Error ? err.name : "unknown"}`);
      return errorResponse(500, "internal_error", "Internal server error");
    }
  };
}
