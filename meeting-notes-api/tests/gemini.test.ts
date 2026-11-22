import { afterEach, describe, expect, it, vi } from "vitest";
import { extractNotes, GEMINI_TIMEOUT_MS } from "../src/gemini.js";
import { RateLimitedError, UpstreamError } from "../src/errors.js";
import { buildUserPrompt } from "../src/prompt.js";

const VALID = {
  summary: "s",
  decisions: ["d"],
  participants: ["Ana"],
  actionItems: [{ task: "t", owner: "Ana", dueDate: "2026-11-28", deadlineSource: "next Friday" }],
};
const BAD_DATE = {
  summary: "x",
  decisions: [],
  participants: [],
  actionItems: [{ task: "t", owner: null, dueDate: "next Friday", deadlineSource: null }],
};
const req = { transcript: "Ana will send the report next Friday." };

describe("extractNotes", () => {
  it("returns parsed output and calls the model once with JSON config", async () => {
    const generate = vi.fn().mockResolvedValue({ text: JSON.stringify(VALID) });
    const out = await extractNotes(req, { generate, model: "m" });
    expect(out).toEqual(VALID);
    expect(generate).toHaveBeenCalledTimes(1);
    const arg = generate.mock.calls[0][0];
    expect(arg.config.responseMimeType).toBe("application/json");
    expect(arg.contents).toContain(req.transcript);
  });

  it("retries once on invalid JSON", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ text: "not json" })
      .mockResolvedValueOnce({ text: JSON.stringify(VALID) });
    await expect(extractNotes(req, { generate, model: "m" })).resolves.toEqual(VALID);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("throws UpstreamError after two schema-invalid outputs", async () => {
    const generate = vi.fn().mockResolvedValue({ text: JSON.stringify(BAD_DATE) });
    await expect(extractNotes(req, { generate, model: "m" })).rejects.toBeInstanceOf(UpstreamError);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("maps status 429 to RateLimitedError without retrying", async () => {
    const generate = vi.fn().mockRejectedValue(Object.assign(new Error("quota"), { status: 429 }));
    await expect(extractNotes(req, { generate, model: "m" })).rejects.toBeInstanceOf(RateLimitedError);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("maps an abort/timeout error to UpstreamError without retrying", async () => {
    const generate = vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
    await expect(extractNotes(req, { generate, model: "m" })).rejects.toBeInstanceOf(UpstreamError);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  describe("shared timeout budget", () => {
    afterEach(() => vi.useRealTimers());

    it("does not retry once the budget is spent and caps the retry signal", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      const generate = vi.fn().mockImplementationOnce(async () => {
        vi.setSystemTime(GEMINI_TIMEOUT_MS);
        return { text: "not json" };
      });
      await expect(extractNotes(req, { generate, model: "m" })).rejects.toBeInstanceOf(UpstreamError);
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it("gives the retry only the remaining time", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      const generate = vi
        .fn()
        .mockImplementationOnce(async () => {
          vi.setSystemTime(40_000);
          return { text: "not json" };
        })
        .mockResolvedValueOnce({ text: JSON.stringify(VALID) });
      await extractNotes(req, { generate, model: "m" });
      expect(generate).toHaveBeenCalledTimes(2);
    });
  });

  it("maps other thrown errors to UpstreamError without leaking the cause message", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("boom " + req.transcript));
    const err = await extractNotes(req, { generate, model: "m" }).catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.message).not.toContain(req.transcript);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("attaches errorName and status to UpstreamError without leaking the message", async () => {
    const cause = Object.assign(new Error("bad " + req.transcript), { name: "ApiError", status: 400 });
    const generate = vi.fn().mockRejectedValue(cause);
    const err = await extractNotes(req, { generate, model: "m" }).catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.errorName).toBe("ApiError");
    expect(err.status).toBe(400);
    expect(err.message).not.toContain(req.transcript);
  });
});

describe("buildUserPrompt", () => {
  it("includes the meeting date when present", () => {
    expect(buildUserPrompt({ transcript: "t", meetingDate: "2026-11-21" })).toContain("2026-11-21");
  });
  it("has no date line without meetingDate", () => {
    expect(buildUserPrompt({ transcript: "t" })).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
