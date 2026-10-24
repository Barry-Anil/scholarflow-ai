import "server-only";

import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { countWords } from "@/features/assignments/parser";
import { createGenerationProvider } from "@/lib/ai/provider";
import { requireAssignmentAccess } from "@/lib/auth/course-access";
import { getDatabase } from "@/lib/db";
import {
  agentRunEvents,
  agentRuns,
  answerCitations,
  assignmentDrafts,
  assignmentQuestions,
  assignments,
  draftAnswers,
  processingJobs,
  researchFindings,
  reviewFindings,
  reviewReports,
  revisionHistory,
  rubricCriteria,
  usageRecords,
} from "@/lib/db/schema";
import { getAiEnv } from "@/lib/env/server";
import { AppError } from "@/lib/errors";
import { instrumentProvider } from "./agent-telemetry";
import { acceptedFindingIdsForRevision, REVISION_JOB_TYPE } from "./contracts";
import { reviseQuestionFromFindings } from "./reviser";

export type RevisionJobPayload = {
  runId: string;
  questionId: string;
  draftId: string;
  fromDraftId: string;
  reportId: string;
  researchRunId: string;
  iteration: number;
};

export async function enqueueRevisionAgent(
  assignmentId: string,
  ownerId: string,
) {
  await requireAssignmentAccess(assignmentId, ownerId, "edit");
  const db = getDatabase();
  const env = getAiEnv();
  const [assignment] = await db
    .select({ id: assignments.id, courseId: assignments.courseId })
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);
  if (!assignment)
    throw new AppError("FORBIDDEN", "You cannot revise this assignment.", {
      status: 403,
    });
  const [latestDraftRow] = await db
    .select({ draft: assignmentDrafts })
    .from(assignmentDrafts)
    .leftJoin(agentRuns, eq(agentRuns.id, assignmentDrafts.sourceRunId))
    .where(
      and(
        eq(assignmentDrafts.assignmentId, assignmentId),
        or(
          isNull(assignmentDrafts.sourceRunId),
          eq(agentRuns.status, "completed"),
        ),
      ),
    )
    .orderBy(desc(assignmentDrafts.version))
    .limit(1);
  const latestDraft = latestDraftRow?.draft;
  if (!latestDraft)
    throw new AppError("INVALID_INPUT", "Save a draft before revising it.");
  const [report] = await db
    .select()
    .from(reviewReports)
    .where(
      and(
        eq(reviewReports.assignmentId, assignmentId),
        eq(reviewReports.draftId, latestDraft.id),
        eq(reviewReports.overallStatus, "changes_required"),
      ),
    )
    .orderBy(desc(reviewReports.createdAt))
    .limit(1);
  if (!report)
    throw new AppError(
      "INVALID_INPUT",
      "Run Agent A on the latest draft before starting a revision.",
    );
  const [questions, researchRun, revisionCount, daily] = await Promise.all([
    db
      .select({ id: assignmentQuestions.id })
      .from(assignmentQuestions)
      .where(eq(assignmentQuestions.assignmentId, assignmentId))
      .orderBy(assignmentQuestions.position),
    db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.assignmentId, assignmentId),
          eq(agentRuns.agent, "researcher"),
          eq(agentRuns.status, "completed"),
        ),
      )
      .orderBy(desc(agentRuns.createdAt))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select({ total: count() })
      .from(revisionHistory)
      .where(eq(revisionHistory.assignmentId, assignmentId))
      .then((rows) => rows[0]?.total ?? 0),
    db
      .select({ total: count() })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.ownerId, ownerId),
          sql`${agentRuns.createdAt} >= now() - interval '24 hours'`,
        ),
      )
      .then((rows) => rows[0]?.total ?? 0),
  ]);
  if (!researchRun)
    throw new AppError(
      "INVALID_INPUT",
      "Run Agent C before revision so Agent B has saved evidence.",
    );
  if (revisionCount >= env.MAX_AGENT_ITERATIONS) {
    await db
      .update(assignments)
      .set({ status: "MAX_ITERATIONS_REACHED" })
      .where(eq(assignments.id, assignmentId));
    throw new AppError(
      "INVALID_INPUT",
      "The automated revision limit has been reached. Continue with manual editing.",
    );
  }
  if (daily >= env.DAILY_AI_REQUEST_LIMIT)
    throw new AppError(
      "INVALID_INPUT",
      "The daily agent request limit has been reached. Try again later.",
      { status: 429 },
    );

  const iteration = revisionCount + 1;
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${assignmentId}))`,
    );
    const [active] = await tx
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.assignmentId, assignmentId),
          inArray(agentRuns.status, ["queued", "running"]),
        ),
      )
      .limit(1);
    if (active)
      throw new AppError(
        "INVALID_INPUT",
        "An agent operation is already queued or running for this assignment.",
        { status: 409 },
      );
    const lockedAccepted = await tx
      .select({ id: reviewFindings.id })
      .from(reviewFindings)
      .where(
        and(
          eq(reviewFindings.reportId, report.id),
          eq(reviewFindings.resolution, "accepted"),
        ),
      );
    const acceptedFindingIds = acceptedFindingIdsForRevision(lockedAccepted);
    if (!acceptedFindingIds.length)
      throw new AppError(
        "INVALID_INPUT",
        "Accept at least one Agent A finding before starting revision.",
      );
    const [latestVisible, highestVersion] = await Promise.all([
      tx
        .select({ id: assignmentDrafts.id })
        .from(assignmentDrafts)
        .leftJoin(agentRuns, eq(agentRuns.id, assignmentDrafts.sourceRunId))
        .where(
          and(
            eq(assignmentDrafts.assignmentId, assignmentId),
            eq(assignmentDrafts.ownerId, ownerId),
            or(
              isNull(assignmentDrafts.sourceRunId),
              eq(agentRuns.status, "completed"),
            ),
          ),
        )
        .orderBy(desc(assignmentDrafts.version))
        .limit(1)
        .then((rows) => rows[0]),
      tx
        .select({ version: assignmentDrafts.version })
        .from(assignmentDrafts)
        .where(eq(assignmentDrafts.assignmentId, assignmentId))
        .orderBy(desc(assignmentDrafts.version))
        .limit(1)
        .then((rows) => rows[0]),
    ]);
    if (latestVisible?.id !== latestDraft.id)
      throw new AppError(
        "INVALID_INPUT",
        "The draft changed. Review the latest version before revising.",
        { status: 409 },
      );
    const [run] = await tx
      .insert(agentRuns)
      .values({
        assignmentId,
        ownerId,
        agent: "student",
        status: "queued",
        workflowState: "REVISING",
        iteration,
        provider: env.AI_PROVIDER,
        model: env.AI_MODEL_WRITER,
        inputSnapshot: {
          fromDraftId: latestDraft.id,
          reportId: report.id,
          acceptedFindingIds,
          researchRunId: researchRun.id,
        },
      })
      .returning({ id: agentRuns.id });
    if (!run)
      throw new AppError("UNEXPECTED_ERROR", "The revision could not start.");
    const [draft] = await tx
      .insert(assignmentDrafts)
      .values({
        assignmentId,
        ownerId,
        version: (highestVersion?.version ?? latestDraft.version) + 1,
        markdown: "",
        wordCount: 0,
        createdByAgent: "student",
        sourceRunId: run.id,
      })
      .returning({ id: assignmentDrafts.id });
    if (!draft)
      throw new AppError(
        "UNEXPECTED_ERROR",
        "The revision draft could not be created.",
      );
    await tx.insert(processingJobs).values(
      questions.map((question) => ({
        ownerId,
        courseId: assignment.courseId,
        assignmentId,
        type: REVISION_JOB_TYPE,
        payload: {
          runId: run.id,
          questionId: question.id,
          draftId: draft.id,
          fromDraftId: latestDraft.id,
          reportId: report.id,
          researchRunId: researchRun.id,
          iteration,
        },
      })),
    );
    await tx
      .update(assignments)
      .set({ status: "REVISING", approvedAt: null })
      .where(eq(assignments.id, assignmentId));
    return {
      runId: run.id,
      draftId: draft.id,
      acceptedFindingCount: acceptedFindingIds.length,
    };
  });
  await addEvent(
    result.runId,
    assignmentId,
    ownerId,
    "revision.queued",
    `Agent B queued revision cycle ${iteration} using ${result.acceptedFindingCount} accepted finding${result.acceptedFindingCount === 1 ? "" : "s"}.`,
    { iteration, reportId: report.id, fromDraftId: latestDraft.id },
  );
  return { ...result, iteration, jobCount: questions.length };
}

export async function processRevisionQuestionJob(
  assignmentId: string,
  ownerId: string,
  payload: RevisionJobPayload,
) {
  const db = getDatabase();
  const env = getAiEnv();
  const [existing] = await db
    .select({ id: draftAnswers.id })
    .from(draftAnswers)
    .where(
      and(
        eq(draftAnswers.draftId, payload.draftId),
        eq(draftAnswers.questionId, payload.questionId),
      ),
    )
    .limit(1);
  if (existing) return;
  const [assignment, question, baseAnswer, rubric, findings, sources] =
    await Promise.all([
      db
        .select({ courseId: assignments.courseId })
        .from(assignments)
        .where(and(eq(assignments.id, assignmentId)))
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select()
        .from(assignmentQuestions)
        .where(
          and(
            eq(assignmentQuestions.id, payload.questionId),
            eq(assignmentQuestions.assignmentId, assignmentId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select()
        .from(draftAnswers)
        .where(
          and(
            eq(draftAnswers.draftId, payload.fromDraftId),
            eq(draftAnswers.questionId, payload.questionId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select()
        .from(rubricCriteria)
        .where(eq(rubricCriteria.assignmentId, assignmentId))
        .orderBy(rubricCriteria.position),
      db
        .select({
          id: reviewFindings.id,
          severity: reviewFindings.severity,
          explanation: reviewFindings.explanation,
          recommendedCorrection: reviewFindings.recommendedCorrection,
          studentNote: reviewFindings.decisionNote,
        })
        .from(reviewFindings)
        .innerJoin(draftAnswers, eq(draftAnswers.id, reviewFindings.answerId))
        .where(
          and(
            eq(reviewFindings.reportId, payload.reportId),
            eq(reviewFindings.resolution, "accepted"),
            eq(draftAnswers.questionId, payload.questionId),
          ),
        ),
      db
        .select()
        .from(researchFindings)
        .where(
          and(
            eq(researchFindings.runId, payload.researchRunId),
            eq(researchFindings.questionId, payload.questionId),
          ),
        )
        .orderBy(desc(researchFindings.relevanceScore))
        .limit(8),
    ]);
  if (!assignment || !question || !baseAnswer)
    throw new AppError("INVALID_INPUT", "The revision context is incomplete.");

  if (!findings.length) {
    await copyAnswer(baseAnswer, payload.draftId);
    await addEvent(
      payload.runId,
      assignmentId,
      ownerId,
      "revision.question_copied",
      `Agent B preserved question ${question.position + 1} because it had no accepted findings.`,
      { questionId: question.id },
    );
    return;
  }
  const revised = await reviseQuestionFromFindings(
    instrumentProvider(createGenerationProvider(), {
      timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
    }),
    env.AI_MODEL_WRITER,
    {
      question: question.prompt,
      requirements: question.requirements,
      wordLimit: question.wordLimit,
      currentAnswer: baseAnswer.markdown,
      rubric: rubric.map((criterion) => ({
        title: criterion.title,
        description: criterion.description,
        weight: criterion.weight,
      })),
      findings,
      evidence: sources.map((source) => ({
        sourceId: source.sourceId,
        sourceLabel:
          typeof source.citationMetadata.title === "string"
            ? source.citationMetadata.title
            : "Retrieved source",
        evidence: source.evidence,
      })),
    },
  );
  await db.transaction(async (tx) => {
    const [saved] = await tx
      .insert(draftAnswers)
      .values({
        draftId: payload.draftId,
        questionId: question.id,
        markdown: revised.answer.markdown,
        confidenceScore: revised.answer.confidenceScore,
        confidenceReasons: revised.answer.confidenceReasons,
        wordCount: countWords(revised.answer.markdown),
      })
      .returning({ id: draftAnswers.id });
    if (!saved)
      throw new AppError(
        "UNEXPECTED_ERROR",
        "The revised answer could not be saved.",
      );
    const citations = revised.answer.citations.flatMap((citation) => {
      const source = sources.find(
        (candidate) => candidate.sourceId === citation.sourceId,
      );
      return source
        ? [
            {
              answerId: saved.id,
              researchFindingId: source.id,
              sourceType: source.sourceType,
              sourceId: source.sourceId,
              claimText: citation.claimText,
              locator: citation.locator,
              metadata: source.citationMetadata,
              verified: false,
            },
          ]
        : [];
    });
    if (citations.length) await tx.insert(answerCitations).values(citations);
    await tx.insert(usageRecords).values({
      ownerId,
      courseId: assignment.courseId,
      assignmentId,
      runId: payload.runId,
      agent: "student",
      provider: revised.usage.provider,
      model: revised.usage.model,
      inputTokens: revised.usage.inputTokens,
      outputTokens: revised.usage.outputTokens,
      estimatedCostUsd: "0",
      latencyMs: revised.usage.latencyMs,
      status: "completed",
    });
  });
  await addEvent(
    payload.runId,
    assignmentId,
    ownerId,
    "revision.question_completed",
    `Agent B revised question ${question.position + 1} from ${findings.length} accepted finding${findings.length === 1 ? "" : "s"}.`,
    {
      questionId: question.id,
      findingIds: findings.map((finding) => finding.id),
      changeSummary: revised.answer.changeSummary,
    },
  );
}

export async function finalizeRevisionRun(
  assignmentId: string,
  ownerId: string,
  payload: RevisionJobPayload,
) {
  const db = getDatabase();
  const [assignment, draft, answers, prior] = await Promise.all([
    db
      .select({ title: assignments.title })
      .from(assignments)
      .where(eq(assignments.id, assignmentId))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select({ version: assignmentDrafts.version })
      .from(assignmentDrafts)
      .where(and(eq(assignmentDrafts.id, payload.draftId)))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select({
        markdown: draftAnswers.markdown,
        position: assignmentQuestions.position,
      })
      .from(draftAnswers)
      .innerJoin(
        assignmentQuestions,
        eq(assignmentQuestions.id, draftAnswers.questionId),
      )
      .where(eq(draftAnswers.draftId, payload.draftId))
      .orderBy(assignmentQuestions.position),
    db
      .select({ id: revisionHistory.id })
      .from(revisionHistory)
      .where(eq(revisionHistory.toDraftId, payload.draftId))
      .limit(1)
      .then((rows) => rows[0]),
  ]);
  if (!assignment || !draft)
    throw new AppError("INVALID_INPUT", "The revision draft is unavailable.");
  const body = answers
    .map((answer) => `## Question ${answer.position + 1}\n\n${answer.markdown}`)
    .join("\n\n");
  await db.transaction(async (tx) => {
    await tx
      .update(assignmentDrafts)
      .set({
        markdown: `# ${assignment.title}\n\n${body}`,
        wordCount: countWords(
          answers.map((answer) => answer.markdown).join(" "),
        ),
      })
      .where(eq(assignmentDrafts.id, payload.draftId));
    if (!prior) {
      await tx.insert(revisionHistory).values({
        assignmentId,
        fromDraftId: payload.fromDraftId,
        toDraftId: payload.draftId,
        reportId: payload.reportId,
        ownerId,
        iteration: payload.iteration,
        changeSummary: {
          questionCount: answers.length,
          source: "accepted_agent_a_findings",
        },
      });
    }
    await tx
      .update(agentRuns)
      .set({
        status: "completed",
        output: {
          draftId: payload.draftId,
          version: draft.version,
          iteration: payload.iteration,
        },
        completedAt: new Date(),
      })
      .where(
        and(eq(agentRuns.id, payload.runId), eq(agentRuns.ownerId, ownerId)),
      );
    await tx
      .update(assignments)
      .set({ status: "READY", approvedAt: null })
      .where(eq(assignments.id, assignmentId));
  });
  await addEvent(
    payload.runId,
    assignmentId,
    ownerId,
    "revision.completed",
    `Agent B saved revision cycle ${payload.iteration} as draft version ${draft.version}. Inspect it before running Agent A again.`,
    { version: draft.version, iteration: payload.iteration },
  );
}

async function copyAnswer(
  baseAnswer: typeof draftAnswers.$inferSelect,
  draftId: string,
) {
  const db = getDatabase();
  const citations = await db
    .select()
    .from(answerCitations)
    .where(eq(answerCitations.answerId, baseAnswer.id));
  await db.transaction(async (tx) => {
    const [saved] = await tx
      .insert(draftAnswers)
      .values({
        draftId,
        questionId: baseAnswer.questionId,
        markdown: baseAnswer.markdown,
        confidenceScore: baseAnswer.confidenceScore,
        confidenceReasons: baseAnswer.confidenceReasons,
        wordCount: baseAnswer.wordCount,
      })
      .returning({ id: draftAnswers.id });
    if (saved && citations.length) {
      await tx.insert(answerCitations).values(
        citations.map((citation) => ({
          answerId: saved.id,
          researchFindingId: citation.researchFindingId,
          sourceType: citation.sourceType,
          sourceId: citation.sourceId,
          claimText: citation.claimText,
          locator: citation.locator,
          metadata: citation.metadata,
          verified: citation.verified,
        })),
      );
    }
  });
}

async function addEvent(
  runId: string,
  assignmentId: string,
  ownerId: string,
  eventType: string,
  message: string,
  metadata: Record<string, unknown> = {},
) {
  await getDatabase().insert(agentRunEvents).values({
    runId,
    assignmentId,
    ownerId,
    eventType,
    message,
    metadata,
  });
}
