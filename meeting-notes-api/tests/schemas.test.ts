import { describe, expect, it } from "vitest";
import {
  ModelOutputSchema,
  NotesRequestSchema,
  modelOutputJsonSchema,
} from "../src/schemas.js";

describe("NotesRequestSchema", () => {
  it.each([{ transcript: "Ana: hi" }, { transcript: "x", meetingDate: "2026-11-21" }])(
    "accepts %j",
    (input) => expect(NotesRequestSchema.safeParse(input).success).toBe(true),
  );

  it.each([
    {},
    { transcript: "   " },
    { transcript: "a".repeat(50_001) },
    { transcript: "x", meetingDate: "21/11/2026" },
  ])("rejects %j", (input) =>
    expect(NotesRequestSchema.safeParse(input).success).toBe(false),
  );
});

describe("ModelOutputSchema", () => {
  const base = { summary: "s", decisions: [], participants: [] };
  const item = { task: "t", owner: null, deadlineSource: null };

  it("rejects a non-ISO dueDate", () => {
    const r = ModelOutputSchema.safeParse({
      ...base,
      actionItems: [{ ...item, dueDate: "next Friday" }],
    });
    expect(r.success).toBe(false);
  });

  it("accepts a null dueDate", () => {
    const r = ModelOutputSchema.safeParse({
      ...base,
      actionItems: [{ ...item, dueDate: null }],
    });
    expect(r.success).toBe(true);
  });
});

describe("modelOutputJsonSchema", () => {
  it("is an object requiring actionItems", () => {
    expect(modelOutputJsonSchema.type).toBe("object");
    expect(modelOutputJsonSchema.required).toContain("actionItems");
  });
});
