import "server-only";

import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { OllamaProvider } from "@/lib/ai/ollama";
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
import { REVIEW_JOB_TYPE } from "./contracts";
import { reviewQuestionIndependently } from "./reviewer";

export type ReviewJobPayload = {
  runId: string;
  questionId: string;
  draftId: string;
  reportId: string;
};

export async function enqueueReviewAgent(
  assignmentId: string,
  ownerId: string,
) {
  await requireAssignmentAccess(assignmentId, ownerId, "edit");
  const db = getDatabase();
  const env = getAiEnv();
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);
  if (!assignment) {
    throw new AppError("FORBIDDEN", "You cannot review this assignment.", {
      status: 403,
    });
  }
  const [daily] = await db
    .select({ total: count() })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.ownerId, ownerId),
        sql`${agentRuns.createdAt} >= now() - interval '24 hours'`,
      ),
    );
  if ((daily?.total ?? 0) >= env.DAILY_AI_REQUEST_LIMIT) {
    throw new AppError(
      "INVALID_INPUT",
      "The daily agent request limit has been reached. Try again later.",
      { status: 429 },
    );
  }
  const [latestDraft, questions] = await Promise.all([
    db
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
      .limit(1)
      .then((rows) => rows[0]?.draft),
    db
      .select({ id: assignmentQuestions.id })
      .from(assignmentQuestions)
      .where(eq(assignmentQuestions.assignmentId, assignmentId))
      .orderBy(assignmentQuestions.position),
  ]);
  if (!latestDraft) {
    throw new AppError(
      "INVALID_INPUT",
      "Save or generate a draft before running Agent A review.",
    );
  }
  const answers = await db
    .select({ id: draftAnswers.id, questionId: draftAnswers.questionId })
    .from(draftAnswers)
    .where(eq(draftAnswers.draftId, latestDraft.id));
  if (!questions.length || answers.length !== questions.length) {
    throw new AppError(
      "INVALID_INPUT",
      "The latest draft does not contain every assignment question.",
    );
  }

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
    if (active) {
      throw new AppError(
        "INVALID_INPUT",
        "An agent operation is already queued or running for this assignment.",
        { status: 409 },
      );
    }
    const [run] = await tx
      .insert(agentRuns)
      .values({
        assignmentId,
        ownerId,
        agent: "reviewer",
        status: "queued",
        workflowState: "REVIEWING",
        provider: env.AI_PROVIDER,
        model: env.AI_MODEL_REVIEWER,
        inputSnapshot: {
          draftId: latestDraft.id,
          draftVersion: latestDraft.version,
          questionIds: questions.map((question) => question.id),
        },
      })
      .returning({ id: agentRuns.id });
    if (!run) {
      throw new AppError(
        "UNEXPECTED_ERROR",
        "The review run could not be queued.",
      );
    }
    const [report] = await tx
      .insert(reviewReports)
      .values({
        assignmentId,
        draftId: latestDraft.id,
        runId: run.id,
        ownerId,
        overallStatus: "in_progress",
        requiresAnotherCycle: true,
        unresolvedConcerns: [],
        qualityGateResults: {},
      })
      .returning({ id: reviewReports.id });
    if (!report) {
      throw new AppError(
        "UNEXPECTED_ERROR",
        "The review report could not be created.",
      );
    }
    await tx.insert(processingJobs).values(
      questions.map((question) => ({
        ownerId,
        courseId: assignment.courseId,
        assignmentId,
        type: REVIEW_JOB_TYPE,
        payload: {
          runId: run.id,
          questionId: question.id,
          draftId: latestDraft.id,
          reportId: report.id,
        },
      })),
    );
    await tx
      .update(assignments)
      .set({ status: "REVIEWING" })
      .where(eq(assignments.id, assignmentId));
    return { runId: run.id, reportId: report.id };
  });
  await addReviewEvent(
    result.runId,
    assignmentId,
    ownerId,
    "review.queued",
    `Agent A queued ${questions.length} independent review task${questions.length === 1 ? "" : "s"} for draft version ${latestDraft.version}.`,
    { reportId: result.reportId, draftId: latestDraft.id },
  );
  return { ...result, jobCount: questions.length };
}

export async function processReviewQuestionJob(
  assignmentId: string,
  ownerId: string,
  payload: ReviewJobPayload,
) {
  const db = getDatabase();
  const env = getAiEnv();
  const [completedEvent] = await db
    .select({ id: agentRunEvents.id })
    .from(agentRunEvents)
    .where(
      and(
        eq(agentRunEvents.runId, payload.runId),
        eq(agentRunEvents.eventType, "review.question_completed"),
        sql`${agentRunEvents.metadata}->>'questionId' = ${payload.questionId}`,
      ),
    )
    .limit(1);
  if (completedEvent) return;

  const [question, answer, rubric, citations, assignment, priorFindings] =
    await Promise.all([
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
            eq(draftAnswers.draftId, payload.draftId),
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
          id: answerCitations.id,
          sourceId: answerCitations.sourceId,
          claimText: answerCitations.claimText,
          locator: answerCitations.locator,
          evidence: researchFindings.evidence,
        })
        .from(answerCitations)
        .innerJoin(draftAnswers, eq(draftAnswers.id, answerCitations.answerId))
        .leftJoin(
          researchFindings,
          eq(researchFindings.id, answerCitations.researchFindingId),
        )
        .where(
          and(
            eq(draftAnswers.draftId, payload.draftId),
            eq(draftAnswers.questionId, payload.questionId),
          ),
        ),
      db
        .select({ courseId: assignments.courseId })
        .from(assignments)
        .where(and(eq(assignments.id, assignmentId)))
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select({
          id: reviewFindings.id,
          explanation: reviewFindings.explanation,
          recommendedCorrection: reviewFindings.recommendedCorrection,
        })
        .from(revisionHistory)
        .innerJoin(
          reviewFindings,
          eq(reviewFindings.reportId, revisionHistory.reportId),
        )
        .innerJoin(draftAnswers, eq(draftAnswers.id, reviewFindings.answerId))
        .where(
          and(
            eq(revisionHistory.toDraftId, payload.draftId),
            eq(reviewFindings.resolution, "accepted"),
            eq(draftAnswers.questionId, payload.questionId),
          ),
        ),
    ]);
  if (!question || !answer || !assignment) {
    throw new AppError("INVALID_INPUT", "The review context is incomplete.");
  }
  const result = await reviewQuestionIndependently(
    new OllamaProvider(env.OLLAMA_BASE_URL, env.AI_REQUEST_TIMEOUT_MS),
    env.AI_MODEL_REVIEWER,
    {
      question: question.prompt,
      requirements: question.requirements,
      wordLimit: question.wordLimit,
      answer: answer.markdown,
      rubric: rubric.map((criterion) => ({
        title: criterion.title,
        description: criterion.description,
        weight: criterion.weight,
      })),
      citations,
      priorFindings,
    },
  );
  const criterionByTitle = new Map(
    rubric.map((criterion) => [criterion.title, criterion.id]),
  );
  const verifiedIds = new Set(result.review.verifiedCitationIds);
  const addressedFindingIds = new Set(result.review.addressedFindingIds);

  await db.transaction(async (tx) => {
    if (addressedFindingIds.size) {
      await tx
        .update(reviewFindings)
        .set({ resolution: "resolved", resolvedAt: new Date() })
        .where(
          and(
            inArray(reviewFindings.id, [...addressedFindingIds]),
            eq(reviewFindings.resolution, "accepted"),
          ),
        );
    }
    if (result.review.findings.length) {
      await tx.insert(reviewFindings).values(
        result.review.findings.map((finding) => ({
          reportId: payload.reportId,
          rubricCriterionId: finding.rubricCriterionTitle
            ? (criterionByTitle.get(finding.rubricCriterionTitle) ?? null)
            : null,
          answerId: answer.id,
          severity: finding.severity,
          required: finding.required,
          title: finding.title,
          explanation: finding.explanation,
          location: finding.location,
          evidence: finding.evidence,
          recommendedCorrection: finding.recommendedCorrection,
        })),
      );
    }
    if (citations.length) {
      await tx
        .update(answerCitations)
        .set({ verified: false })
        .where(eq(answerCitations.answerId, answer.id));
      if (verifiedIds.size) {
        await tx
          .update(answerCitations)
          .set({ verified: true })
          .where(
            and(
              eq(answerCitations.answerId, answer.id),
              inArray(answerCitations.id, [...verifiedIds]),
            ),
          );
      }
    }
    await tx.insert(usageRecords).values({
      ownerId,
      courseId: assignment.courseId,
      assignmentId,
      runId: payload.runId,
      agent: "reviewer",
      provider: result.usage.provider,
      model: result.usage.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estimatedCostUsd: "0",
      latencyMs: result.usage.latencyMs,
      status: "completed",
    });
    await tx.insert(agentRunEvents).values({
      runId: payload.runId,
      assignmentId,
      ownerId,
      eventType: "review.question_completed",
      message: `Agent A reviewed question ${question.position + 1} and recorded ${result.review.findings.length} finding${result.review.findings.length === 1 ? "" : "s"}.`,
      metadata: {
        questionId: question.id,
        answerId: answer.id,
        qualityGates: result.review.qualityGates,
        confidenceScore: result.review.confidenceScore,
        uncertaintyReasons: result.review.uncertaintyReasons,
        verifiedCitationCount: verifiedIds.size,
        citationCount: citations.length,
        addressedFindingIds: [...addressedFindingIds],
      },
    });
  });
}

export async function finalizeReviewRun(
  assignmentId: string,
  ownerId: string,
  payload: ReviewJobPayload,
) {
  const db = getDatabase();
  const [report, expected, findings, events, citations, unresolvedPrior] =
    await Promise.all([
      db
        .select({ id: reviewReports.id })
        .from(reviewReports)
        .where(
          and(
            eq(reviewReports.id, payload.reportId),
            eq(reviewReports.ownerId, ownerId),
            eq(reviewReports.runId, payload.runId),
            eq(reviewReports.draftId, payload.draftId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select({ total: count() })
        .from(assignmentQuestions)
        .where(eq(assignmentQuestions.assignmentId, assignmentId))
        .then((rows) => rows[0]?.total ?? 0),
      db
        .select({
          severity: reviewFindings.severity,
          required: reviewFindings.required,
          title: reviewFindings.title,
        })
        .from(reviewFindings)
        .where(eq(reviewFindings.reportId, payload.reportId)),
      db
        .select({ metadata: agentRunEvents.metadata })
        .from(agentRunEvents)
        .where(
          and(
            eq(agentRunEvents.runId, payload.runId),
            eq(agentRunEvents.eventType, "review.question_completed"),
          ),
        ),
      db
        .select({ verified: answerCitations.verified })
        .from(answerCitations)
        .innerJoin(draftAnswers, eq(draftAnswers.id, answerCitations.answerId))
        .where(eq(draftAnswers.draftId, payload.draftId)),
      db
        .select({ title: reviewFindings.title })
        .from(revisionHistory)
        .innerJoin(
          reviewFindings,
          eq(reviewFindings.reportId, revisionHistory.reportId),
        )
        .where(
          and(
            eq(revisionHistory.toDraftId, payload.draftId),
            eq(reviewFindings.resolution, "accepted"),
            eq(reviewFindings.required, true),
          ),
        ),
    ]);
  if (!report) {
    throw new AppError("FORBIDDEN", "The review report is unavailable.", {
      status: 403,
    });
  }
  const severityCounts = {
    critical: findings.filter((item) => item.severity === "critical").length,
    major: findings.filter((item) => item.severity === "major").length,
    minor: findings.filter((item) => item.severity === "minor").length,
    suggestion: findings.filter((item) => item.severity === "suggestion")
      .length,
  };
  const requiredFindings = findings.filter((item) => item.required);
  const everyQuestionReviewed = events.length === expected;
  const everyQuestionGatePassed = events.every((item) =>
    qualityGatesPassed(item.metadata.qualityGates),
  );
  const everyReviewConfident = events.every(
    (item) =>
      typeof item.metadata.confidenceScore === "number" &&
      item.metadata.confidenceScore >= 60,
  );
  const allCitationsVerified =
    citations.length > 0 && citations.every((citation) => citation.verified);
  const passed =
    everyQuestionReviewed &&
    everyQuestionGatePassed &&
    everyReviewConfident &&
    allCitationsVerified &&
    unresolvedPrior.length === 0 &&
    requiredFindings.length === 0;
  const unresolvedConcerns = [
    ...requiredFindings.map((finding) => finding.title),
    ...unresolvedPrior.map(
      (finding) => `Prior correction not verified: ${finding.title}`,
    ),
    ...events.flatMap((item) =>
      Array.isArray(item.metadata.uncertaintyReasons)
        ? item.metadata.uncertaintyReasons.filter(
            (reason): reason is string => typeof reason === "string",
          )
        : [],
    ),
    ...(!citations.length ? ["The draft has no traceable citations."] : []),
    ...(citations.length && !allCitationsVerified
      ? ["One or more citations remain unverified."]
      : []),
    ...(!everyReviewConfident
      ? ["Agent A reported low confidence for at least one question review."]
      : []),
  ];
  const qualityGateResults = {
    ...severityCounts,
    questionsReviewed: events.length,
    expectedQuestions: expected,
    everyQuestionReviewed,
    everyQuestionGatePassed,
    everyReviewConfident,
    requiredFindings: requiredFindings.length,
    unresolvedPriorFindings: unresolvedPrior.length,
    citationsVerified: citations.filter((citation) => citation.verified).length,
    citationCount: citations.length,
    allCitationsVerified,
    passed,
    studentApprovalRequired: true,
  };

  await db.transaction(async (tx) => {
    await tx
      .update(reviewReports)
      .set({
        overallStatus: passed ? "quality_gates_passed" : "changes_required",
        requiresAnotherCycle: !passed,
        unresolvedConcerns: [...new Set(unresolvedConcerns)].slice(0, 30),
        qualityGateResults,
      })
      .where(
        and(
          eq(reviewReports.id, payload.reportId),
          eq(reviewReports.ownerId, ownerId),
        ),
      );
    await tx
      .update(agentRuns)
      .set({
        status: "completed",
        output: { reportId: payload.reportId, ...qualityGateResults },
        completedAt: new Date(),
      })
      .where(
        and(eq(agentRuns.id, payload.runId), eq(agentRuns.ownerId, ownerId)),
      );
    await tx
      .update(assignments)
      .set({ status: passed ? "READY_FOR_STUDENT_APPROVAL" : "REVISING" })
      .where(eq(assignments.id, assignmentId));
  });
  await addReviewEvent(
    payload.runId,
    assignmentId,
    ownerId,
    "review.completed",
    passed
      ? "Agent A completed review: the defined quality gates passed, but student approval is still required."
      : `Agent A completed review with ${requiredFindings.length} required correction${requiredFindings.length === 1 ? "" : "s"}.`,
    qualityGateResults,
  );
}

async function addReviewEvent(
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

function qualityGatesPassed(value: unknown) {
  if (!value || typeof value !== "object") return false;
  return Object.values(value).every((item) => item === true);
}
