import { describe, expect, it } from "vitest";
import { groundNotes } from "../src/grounding.js";
import type { ModelOutput } from "../src/schemas.js";

const item = (
  owner: string | null,
  dueDate: string | null = null,
  deadlineSource: string | null = null,
) => ({ task: "Send report", owner, dueDate, deadlineSource });

const output = (...actionItems: ModelOutput["actionItems"]): ModelOutput => ({
  summary: "Sum",
  decisions: ["D1"],
  participants: ["Ana"],
  actionItems,
});

describe("groundNotes owner", () => {
  it("keeps an owner present in the transcript", () => {
    const { notes, corrections } = groundNotes(output(item("Ana")), "Ana: I'll send it");
    expect(notes.actionItems[0]?.owner).toBe("Ana");
    expect(corrections).toEqual([]);
  });

  it("nulls an owner that only matches inside another word", () => {
    const { notes, corrections } = groundNotes(output(item("Ana")), "We ordered banana bread");
    expect(notes.actionItems[0]?.owner).toBeNull();
    expect(corrections).toEqual([{ index: 0, field: "owner", reason: "owner_not_in_transcript" }]);
  });

  it("matches owners ignoring accents and case", () => {
    expect(groundNotes(output(item("Joao")), "João: ok").notes.actionItems[0]?.owner).toBe("Joao");
    expect(groundNotes(output(item("joão")), "JOÃO: ok").notes.actionItems[0]?.owner).toBe("joão");
  });
});

describe("groundNotes dueDate", () => {
  const transcript = "Ana: done by next Friday";

  it("keeps a date with a found source when meetingDate is given", () => {
    const { notes, corrections } = groundNotes(
      output(item("Ana", "2026-11-27", "by next Friday")),
      transcript,
      "2026-11-21",
    );
    expect(notes.actionItems[0]?.dueDate).toBe("2026-11-27");
    expect(corrections).toEqual([]);
  });

  it("nulls a date without a source", () => {
    const { notes, corrections } = groundNotes(
      output(item("Ana", "2026-11-27", null)),
      transcript,
      "2026-11-21",
    );
    expect(notes.actionItems[0]?.dueDate).toBeNull();
    expect(corrections).toEqual([{ index: 0, field: "dueDate", reason: "deadline_source_not_found" }]);
  });

  it("nulls a date whose source is blank", () => {
    const { notes, corrections } = groundNotes(
      output(item("Ana", "2026-11-28", "   ")),
      transcript,
      "2026-11-21",
    );
    expect(notes.actionItems[0]?.dueDate).toBeNull();
    expect(corrections).toEqual([{ index: 0, field: "dueDate", reason: "deadline_source_not_found" }]);
  });

  it("nulls a date whose source is not in the transcript", () => {
    const { corrections } = groundNotes(
      output(item("Ana", "2026-11-27", "by tomorrow")),
      transcript,
      "2026-11-21",
    );
    expect(corrections).toEqual([{ index: 0, field: "dueDate", reason: "deadline_source_not_found" }]);
  });

  it("without meetingDate keeps a stated absolute date", () => {
    const { notes } = groundNotes(
      output(item("Ana", "2026-12-04", "until December 4, 2026")),
      "Ana: until December 4, 2026",
    );
    expect(notes.actionItems[0]?.dueDate).toBe("2026-12-04");
  });

  it("without meetingDate nulls a date whose year is not stated", () => {
    const { notes, corrections } = groundNotes(
      output(item("Ana", "2023-03-07", "by March 7")),
      "Ana: send it by March 7",
    );
    expect(notes.actionItems[0]?.dueDate).toBeNull();
    expect(corrections).toEqual([{ index: 0, field: "dueDate", reason: "date_not_stated" }]);
  });

  it("without meetingDate nulls a relative date", () => {
    const { notes, corrections } = groundNotes(output(item("Ana", "2026-12-04", "next Friday")), transcript);
    expect(notes.actionItems[0]?.dueDate).toBeNull();
    expect(corrections).toEqual([{ index: 0, field: "dueDate", reason: "date_not_stated" }]);
  });
});

describe("groundNotes passthrough", () => {
  it("drops deadlineSource and keeps other fields", () => {
    const { notes } = groundNotes(output(item("Ana", "2026-11-27", "by next Friday")), "Ana: by next Friday", "2026-11-21");
    expect(notes.actionItems[0]).not.toHaveProperty("deadlineSource");
    expect(notes.summary).toBe("Sum");
    expect(notes.decisions).toEqual(["D1"]);
    expect(notes.participants).toEqual(["Ana"]);
  });
});
