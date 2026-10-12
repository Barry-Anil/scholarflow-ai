import { z } from "zod";

export const RESEARCH_JOB_TYPE = "agent.research.question";
export const DRAFT_JOB_TYPE = "agent.draft.question";
export const REVIEW_JOB_TYPE = "agent.review.question";
export const REVISION_JOB_TYPE = "agent.revision.question";

export function isDraftRunContextValid(
  jobType: string,
  draftSourceRunId: string | null,
  jobRunId: string,
) {
  if (jobType === DRAFT_JOB_TYPE || jobType === REVISION_JOB_TYPE)
    return draftSourceRunId === jobRunId;
  return jobType === REVIEW_JOB_TYPE;
}

export function acceptedFindingIdsForRevision(
  findings: ReadonlyArray<{ id: string }>,
) {
  return [...new Set(findings.map((finding) => finding.id))];
}

export const draftedAnswerSchema = z.object({
  markdown: z.string().min(1).max(60_000),
  citations: z
    .array(
      z.object({
        sourceId: z.string().min(1),
        claimText: z.string().min(1).max(2_000),
        locator: z.string().max(500).nullable(),
      }),
    )
    .max(30),
  confidenceScore: z.number().int().min(0).max(100),
  confidenceReasons: z.array(z.string().min(1).max(500)).min(1).max(10),
});

export type DraftedAnswer = z.infer<typeof draftedAnswerSchema>;

export const revisedAnswerSchema = draftedAnswerSchema.extend({
  changeSummary: z.array(z.string().min(1).max(500)).min(1).max(12),
});

export type RevisedAnswer = z.infer<typeof revisedAnswerSchema>;

export const reviewedQuestionSchema = z.object({
  findings: z
    .array(
      z.object({
        severity: z.enum(["critical", "major", "minor", "suggestion"]),
        required: z.boolean(),
        title: z.string().min(1).max(240),
        explanation: z.string().min(1).max(4_000),
        location: z.string().max(1_000).nullable(),
        evidence: z.string().max(4_000).nullable(),
        recommendedCorrection: z.string().min(1).max(4_000),
        rubricCriterionTitle: z.string().max(240).nullable(),
      }),
    )
    .max(12),
  verifiedCitationIds: z.array(z.string()).max(30),
  addressedFindingIds: z.array(z.string()).max(30),
  qualityGates: z.object({
    requirementCoverage: z.boolean(),
    evidenceGrounding: z.boolean(),
    citationTraceability: z.boolean(),
    criticalReasoning: z.boolean(),
    academicClarity: z.boolean(),
  }),
  confidenceScore: z.number().int().min(0).max(100),
  uncertaintyReasons: z.array(z.string().min(1).max(500)).max(10),
});

export type ReviewedQuestion = z.infer<typeof reviewedQuestionSchema>;
