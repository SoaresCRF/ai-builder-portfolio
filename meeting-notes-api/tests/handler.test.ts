import { afterEach, describe, expect, it, vi } from "vitest";
import { RateLimitedError, UpstreamError } from "../src/errors.js";
import { createHandler } from "../src/handler.js";
import type { ModelOutput } from "../src/schemas.js";

const KEY = "secret-key";
const TRANSCRIPT = "Ana will send the report. Confidential budget talk.";
const env = { ACCESS_KEY: KEY, GEMINI_MODEL: "m", GEMINI_API_KEY: "g" };

const output: ModelOutput = {
  summary: "s",
  decisions: [],
  participants: ["Ana"],
  actionItems: [{ task: "Send report", owner: "Zed", dueDate: null, deadlineSource: null }],
};

const post = (body: BodyInit | null, headers: Record<string, string> = { "x-api-key": KEY }) =>
  new Request("http://x/api/notes", { method: "POST", body, headers });
const valid = () => post(JSON.stringify({ transcript: TRANSCRIPT }));

const build = (extract = vi.fn().mockResolvedValue(output), e: object = env) => ({
  extract,
  handler: createHandler({ env: e, extract }),
});

const expectHeaders = (res: Response) => {
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("x-frame-options")).toBe("DENY");
  expect(res.headers.get("content-security-policy")).toBe(
    "default-src 'none'; frame-ancestors 'none'",
  );
};

afterEach(() => vi.restoreAllMocks());

describe("handler", () => {
  it("405 on GET", async () => {
    const res = await build().handler(new Request("http://x/api/notes"));
    expect(res.status).toBe(405);
    expect((await res.json()).error.code).toBe("method_not_allowed");
    expect(res.headers.get("allow")).toBe("POST");
    expectHeaders(res);
  });

  it.each<Record<string, string>>([{}, { "x-api-key": "wrong" }, { "x-api-key": "" }])("401 for key %j", async (h) => {
    const { handler, extract } = build();
    const res = await handler(post(JSON.stringify({ transcript: "t" }), h));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
    expect(extract).not.toHaveBeenCalled();
    expectHeaders(res);
  });

  it.each(["ACCESS_KEY", "GEMINI_MODEL", "GEMINI_API_KEY"])("500 when %s missing", async (k) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { handler, extract } = build(undefined, { ...env, [k]: undefined });
    const res = await handler(post("{}", { "x-api-key": "" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("internal_error");
    expect(extract).not.toHaveBeenCalled();
    expectHeaders(res);
  });

  it.each(["not json", ""])("400 for body %j", async (body) => {
    const res = await build().handler(post(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
    expectHeaders(res);
  });

  it("400 for schema failure", async () => {
    const res = await build().handler(post(JSON.stringify({ transcript: "" })));
    expect(res.status).toBe(400);
  });

  it("200 with grounded notes and warns once per correction", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await build().handler(valid());
    expect(res.status).toBe(200);
    expectHeaders(res);
    const body = await res.json();
    expect(body.actionItems).toEqual([{ task: "Send report", owner: null, dueDate: null }]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).not.toContain("Confidential");
  });

  it.each([
    [new RateLimitedError(), 429, "rate_limited"],
    [new UpstreamError("x"), 502, "upstream_error"],
    [new Error("boom Confidential"), 500, "internal_error"],
  ])("maps %s to %i", async (err, status, code) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await build(vi.fn().mockRejectedValue(err)).handler(valid());
    expect(res.status).toBe(status);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: { code, message: expect.any(String) } });
    expect(text).not.toContain("Confidential");
    expectHeaders(res);
  });

  it("logs upstream failures with status and errorName but no transcript", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new UpstreamError("Model call failed (ApiError)", { errorName: "ApiError", status: 400 });
    await build(vi.fn().mockRejectedValue(err)).handler(valid());
    expect(error).toHaveBeenCalledTimes(1);
    const line = error.mock.calls[0][0];
    expect(JSON.parse(line)).toEqual({
      event: "upstream_error",
      reason: "Model call failed (ApiError)",
      errorName: "ApiError",
      status: 400,
    });
    expect(line).not.toContain("Confidential");
  });

  it("logs rate limiting as a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await build(vi.fn().mockRejectedValue(new RateLimitedError())).handler(valid());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warn.mock.calls[0][0])).toEqual({ event: "rate_limited" });
  });
});
