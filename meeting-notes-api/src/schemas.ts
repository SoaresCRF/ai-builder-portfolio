import { z } from "zod";

export const MAX_TRANSCRIPT_CHARS = 50_000;

export const NotesRequestSchema = z.object({
  transcript: z.string().trim().min(1).max(MAX_TRANSCRIPT_CHARS),
  meetingDate: z.iso.date().optional(),
});
export type NotesRequest = z.infer<typeof NotesRequestSchema>;

export const ModelOutputSchema = z.object({
  summary: z.string(),
  decisions: z.array(z.string()),
  participants: z.array(z.string()),
  actionItems: z.array(
    z.object({
      task: z.string(),
      owner: z.string().nullable(),
      dueDate: z.iso.date().nullable(),
      // Exact transcript phrase the deadline was derived from (used for grounding).
      deadlineSource: z.string().nullable(),
    }),
  ),
});
export type ModelOutput = z.infer<typeof ModelOutputSchema>;

export type NotesResponse = Omit<ModelOutput, "actionItems"> & {
  actionItems: Omit<ModelOutput["actionItems"][number], "deadlineSource">[];
};

export const modelOutputJsonSchema = z.toJSONSchema(ModelOutputSchema);
