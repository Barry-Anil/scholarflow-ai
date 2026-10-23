import { z } from "zod";

export const lessonModes = [
  "normal",
  "beginner",
  "example",
  "deep",
  "summary",
  "quiz",
  "dialogue",
] as const;
export const lessonModeSchema = z.enum(lessonModes);
export type LessonMode = z.infer<typeof lessonModeSchema>;

export const lessonSchema = z.object({
  title: z.string().min(1).max(300),
  introduction: z.string().min(1).max(2_000),
  explanation: z.array(z.string().min(1).max(2_500)).min(1).max(12),
  keyTerms: z
    .array(
      z.object({ term: z.string().max(120), definition: z.string().max(800) }),
    )
    .max(15),
  examples: z.array(z.string().min(1).max(1_500)).max(8),
  steps: z.array(z.string().min(1).max(1_000)).max(12),
  takeaways: z.array(z.string().min(1).max(700)).min(1).max(10),
  selfCheck: z
    .array(
      z.object({
        question: z.string().min(1).max(600),
        answer: z.string().min(1).max(1_000),
      }),
    )
    .max(8),
  sourceIds: z.array(z.uuid()).max(30),
  dialogue: z
    .array(
      z.object({
        speaker: z.enum(["Tutor", "Student"]),
        text: z.string().min(1).max(1_500),
        sourceIds: z.array(z.uuid()).max(10),
      }),
    )
    .max(20)
    .optional(),
});
export type StudyLesson = z.infer<typeof lessonSchema>;

export const chatAnswerSchema = z.object({
  answer: z.string().min(1).max(6_000),
  supportLevel: z.enum(["document", "mixed", "insufficient"]),
  sourceIds: z.array(z.uuid()).max(20),
  suggestedQuestions: z.array(z.string().min(1).max(240)).max(4),
});

export const explainRequestSchema = z.object({
  sessionId: z.uuid(),
  sectionId: z.uuid(),
  mode: lessonModeSchema,
});

export const chatRequestSchema = z.object({
  sessionId: z.uuid(),
  sectionId: z.uuid().optional(),
  message: z.string().trim().min(2).max(2_000),
});
