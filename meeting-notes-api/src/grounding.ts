import type { ModelOutput, NotesResponse } from "./schemas.js";

export type Correction = {
  index: number;
  field: "owner" | "dueDate";
  reason: "owner_not_in_transcript" | "deadline_source_not_found" | "date_not_stated";
};

const normalize = (s: string): string =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

const containsWord = (haystack: string, word: string): boolean =>
  new RegExp(String.raw`(?<![\p{L}\p{N}])${escapeRegExp(word)}(?![\p{L}\p{N}])`, "u").test(haystack);

// ponytail: day-number + year-number heuristic for stated absolute dates (an unstated year is not stated);
// parse full dates per locale if false positives show up.
const sourceStatesDate = (deadlineSource: string, dueDate: string): boolean => {
  const day = Number(dueDate.slice(8, 10));
  const year = dueDate.slice(0, 4);
  return (
    new RegExp(String.raw`(?<!\d)0?${day}(?!\d)`).test(deadlineSource) &&
    new RegExp(String.raw`(?<!\d)${year}(?!\d)`).test(deadlineSource)
  );
};

export function groundNotes(
  output: ModelOutput,
  transcript: string,
  meetingDate?: string,
): { notes: NotesResponse; corrections: Correction[] } {
  const corrections: Correction[] = [];
  const normTranscript = normalize(transcript);

  const actionItems = output.actionItems.map(({ deadlineSource, ...item }, index) => {
    let { owner, dueDate } = item;

    if (owner !== null) {
      const normOwner = normalize(owner.trim());
      if (normOwner === "" || !containsWord(normTranscript, normOwner)) {
        owner = null;
        corrections.push({ index, field: "owner", reason: "owner_not_in_transcript" });
      }
    }

    if (dueDate !== null) {
      const normSource = deadlineSource === null ? "" : normalize(deadlineSource.trim());
      if (normSource === "" || !normTranscript.includes(normSource)) {
        dueDate = null;
        corrections.push({ index, field: "dueDate", reason: "deadline_source_not_found" });
      } else if (meetingDate === undefined && !sourceStatesDate(normSource, dueDate)) {
        dueDate = null;
        corrections.push({ index, field: "dueDate", reason: "date_not_stated" });
      }
    }

    return { ...item, owner, dueDate };
  });

  return { notes: { ...output, actionItems }, corrections };
}
