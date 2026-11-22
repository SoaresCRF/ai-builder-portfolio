import { createHandler } from "../src/handler.js";
import { createGeminiGenerate, extractNotes } from "../src/gemini.js";

export default {
  async fetch(request: Request): Promise<Response> {
    const { ACCESS_KEY, GEMINI_MODEL, GEMINI_API_KEY } = process.env;
    // The Gemini client is built per request, only once env is present (no import-time crash).
    const handler = createHandler({
      env: { ACCESS_KEY, GEMINI_MODEL, GEMINI_API_KEY },
      extract: (req) =>
        extractNotes(req, {
          generate: createGeminiGenerate(GEMINI_API_KEY as string),
          model: GEMINI_MODEL as string,
        }),
    });
    return handler(request);
  },
};
