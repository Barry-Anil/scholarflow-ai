import "server-only";

import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { countWords } from "@/features/assignments/parser";
import {
  getRunAiProvider,
  resolveAiProvider,
} from "@/features/settings/ai-provider";
import {
  createGenerationProvider,
  generationModelFor,
} from "@/lib/ai/provider";
import { requireAssignmentAccess } from "@/lib/auth/course-access";
import { getDatabase } from "@/lib/db";
import {
  agentRunEvents,
  agentRuns,
  answerCitations,
  assignmentDrafts,
  assignmentQuestions,
  assignments,
  documentChunks,
  documents,
  draftAnswers,
  processingJobs,
  processingJobDiagnostics,
  researchFindings,
  reviewReports,
  rubricCriteria,
  usageRecords,
} from "@/lib/db/schema";
import { getAiEnv } from "@/lib/env/server";
import { AppError, errorFingerprint } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { searchCrossref } from "@/lib/research/crossref";
import {
  DRAFT_JOB_TYPE,
  isDraftRunContextValid,
  RESEARCH_JOB_TYPE,
  REVIEW_JOB_TYPE,
  REVISION_JOB_TYPE,
} from "./contracts";
import { buildResearchQuery } from "./research";
import {
  finalizeReviewRun,
  processReviewQuestionJob,
  type ReviewJobPayload,
} from "./review-workflow";
import {
  finalizeRevisionRun,
  processRevisionQuestionJob,
  type RevisionJobPayload,
} from "./revision-workflow";
import { draftQuestionWithEvidence } from "./student";
import { renewAgentJobLease } from "./agent-job-queue";
import {
  instrumentProvider,
  questionLabel,
  recordAgentStage,
  runWithAgentJobTelemetry,
  type AgentJobTelemetryContext,
  type AgentStagePrefix,
} from "./agent-telemetry";
import {
  agentDiagnostic,
  agentPublicError,
  agentRetryDelayMs,
  isRetryableAgentError,
} from "./job-policy";

export { enqueueReviewAgent } from "./review-workflow";
export { enqueueRevisionAgent } from "./revision-workflow";

type AgentJobPayload = {
  runId: string;
  questionId: string;
  draftId?: string;
  reportId?: string;
  fromDraftId?: string;
  researchRunId?: string;
  iteration?: number;
};

const agentJobPayloadSchema = z.object({
  runId: z.uuid(),
  questionId: z.uuid(),
  draftId: z.uuid().optional(),
  reportId: z.uuid().optional(),
  fromDraftId: z.uuid().optional(),
  researchRunId: z.uuid().optional(),
  iteration: z.number().int().min(1).optional(),
});

async function ownedAssignment(assignmentId: string, ownerId: string) {
  await requireAssignmentAccess(assignmentId, ownerId, "edit");
  const db = getDatabase();
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);
  if (!assignment) {
    throw new AppError(
      "FORBIDDEN",
      "You cannot run agents for this assignment.",
      {
        status: 403,
      },
    );
  }
  return assignment;
}

async function questionsFor(assignmentId: string) {
  return getDatabase()
    .select()
    .from(assignmentQuestions)
    .where(eq(assignmentQuestions.assignmentId, assignmentId))
    .orderBy(assignmentQuestions.position);
}

async function event(
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

async function assertNoActiveRun(assignmentId: string, ownerId: string) {
  const db = getDatabase();
  const env = getAiEnv();
  const [active, daily] = await Promise.all([
    db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.assignmentId, assignmentId),
          inArray(agentRuns.status, ["queued", "running"]),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]),
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
  if (active) {
    throw new AppError(
      "INVALID_INPUT",
      "An agent operation is already queued or running for this assignment.",
      { status: 409 },
    );
  }
  if (daily >= env.DAILY_AI_REQUEST_LIMIT) {
    throw new AppError(
      "INVALID_INPUT",
      "The daily agent request limit has been reached. Try again later.",
      { status: 429 },
    );
  }
}

export async function enqueueResearchAgent(
  assignmentId: string,
  ownerId: string,
) {
  const assignment = await ownedAssignment(assignmentId, ownerId);
  const questions = await questionsFor(assignmentId);
  if (!questions.length) {
    throw new AppError(
      "INVALID_INPUT",
      "This assignment has no questions to research.",
    );
  }
  await assertNoActiveRun(assignmentId, ownerId);
  const db = getDatabase();
  const runId = await db.transaction(async (tx) => {
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
        agent: "researcher",
        status: "queued",
        workflowState: "RESEARCHING",
        provider: assignment.externalResearchAllowed
          ? "local+crossref"
          : "local",
        inputSnapshot: {
          questionIds: questions.map((question) => question.id),
          externalResearchAllowed: assignment.externalResearchAllowed,
        },
      })
      .returning({ id: agentRuns.id });
    if (!run)
      throw new AppError(
        "UNEXPECTED_ERROR",
        "The research run could not be queued.",
      );
    await tx.insert(processingJobs).values(
      questions.map((question) => ({
        ownerId,
        courseId: assignment.courseId,
        assignmentId,
        type: RESEARCH_JOB_TYPE,
        payload: { runId: run.id, questionId: question.id },
      })),
    );
    await tx
      .update(assignments)
      .set({ status: "RESEARCHING" })
      .where(eq(assignments.id, assignmentId));
    return run.id;
  });
  await event(
    runId,
    assignmentId,
    ownerId,
    "research.queued",
    `Agent C queued ${questions.length} bounded research task${questions.length === 1 ? "" : "s"}.`,
  );
  return { runId, jobCount: questions.length };
}

export async function enqueueStudentAgent(
  assignmentId: string,
  ownerId: string,
) {
  const assignment = await ownedAssignment(assignmentId, ownerId);
  const questions = await questionsFor(assignmentId);
  if (!questions.length) {
    throw new AppError(
      "INVALID_INPUT",
      "This assignment has no questions to draft.",
    );
  }
  await assertNoActiveRun(assignmentId, ownerId);
  const db = getDatabase();
  const env = getAiEnv();
  const [researchRun] = await db
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
    .limit(1);
  if (!researchRun) {
    throw new AppError(
      "INVALID_INPUT",
      "Run Agent C research before drafting.",
    );
  }
  const [finding] = await db
    .select({ id: researchFindings.id })
    .from(researchFindings)
    .where(eq(researchFindings.runId, researchRun.id))
    .limit(1);
  if (!finding) {
    throw new AppError(
      "INVALID_INPUT",
      "Agent C found no traceable evidence. Add course material and retry.",
    );
  }

  const aiProvider = await resolveAiProvider(ownerId);
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
    const [latest] = await tx
      .select({ version: assignmentDrafts.version })
      .from(assignmentDrafts)
      .where(eq(assignmentDrafts.assignmentId, assignmentId))
      .orderBy(desc(assignmentDrafts.version))
      .limit(1);
    const version = (latest?.version ?? 0) + 1;
    const [run] = await tx
      .insert(agentRuns)
      .values({
        assignmentId,
        ownerId,
        agent: "student",
        status: "queued",
        workflowState: "DRAFTING",
        provider: aiProvider,
        model: generationModelFor(aiProvider, env.AI_MODEL_WRITER),
        inputSnapshot: {
          questionIds: questions.map((question) => question.id),
          researchRunId: researchRun.id,
        },
      })
      .returning({ id: agentRuns.id });
    if (!run)
      throw new AppError(
        "UNEXPECTED_ERROR",
        "The drafting run could not be queued.",
      );
    const [draft] = await tx
      .insert(assignmentDrafts)
      .values({
        assignmentId,
        ownerId,
        version,
        markdown: "",
        wordCount: 0,
        createdByAgent: "student",
        sourceRunId: run.id,
      })
      .returning({ id: assignmentDrafts.id });
    if (!draft)
      throw new AppError(
        "UNEXPECTED_ERROR",
        "The working draft could not be created.",
      );
    await tx.insert(processingJobs).values(
      questions.map((question) => ({
        ownerId,
        courseId: assignment.courseId,
        assignmentId,
        type: DRAFT_JOB_TYPE,
        payload: { runId: run.id, questionId: question.id, draftId: draft.id },
      })),
    );
    await tx
      .update(assignments)
      .set({ status: "DRAFTING", approvedAt: null })
      .where(eq(assignments.id, assignmentId));
    return { runId: run.id, draftId: draft.id, version };
  });
  await event(
    result.runId,
    assignmentId,
    ownerId,
    "draft.queued",
    `Agent B queued ${questions.length} bounded drafting task${questions.length === 1 ? "" : "s"}.`,
    { version: result.version },
  );
  return { ...result, jobCount: questions.length };
}

export async function processClaimedAgentJob(
  jobId: string,
  workerId: string,
  options: { leaseMs: number; heartbeatMs: number },
) {
  const db = getDatabase();
  const [job] = await db
    .select()
    .from(processingJobs)
    .where(
      and(
        eq(processingJobs.id, jobId),
        eq(processingJobs.status, "processing"),
        eq(processingJobs.lockedBy, workerId),
      ),
    )
    .limit(1);
  if (!job) {
    throw new AppError("FORBIDDEN", "The worker no longer owns this job.", {
      status: 409,
    });
  }
  const ownerId = job.ownerId;
  let payload: AgentJobPayload;
  try {
    payload = parsePayload(job.payload);
  } catch (error) {
    await failInvalidJob(job.id, ownerId, workerId, job.attempts, error);
    return { status: "failed" as const };
  }

  if (job.lastErrorCode === "WORKER_LEASE_EXHAUSTED") {
    const exhaustedError = new AppError(
      "AI_UNAVAILABLE",
      "The agent worker stopped repeatedly while processing this task.",
    );
    let validContext = false;
    try {
      await assertJobContext(job, payload, ownerId);
      validContext = true;
    } catch (error) {
      logger.warn("agent.job_exhausted_context_rejected", {
        jobId: job.id,
        workerId,
        ...errorFingerprint(error),
      });
    }
    await failRun(
      job,
      payload,
      ownerId,
      workerId,
      exhaustedError,
      validContext,
    );
    return { status: "failed" as const };
  }

  let leaseLost = false;
  let heartbeatRunning = false;
  const heartbeat = setInterval(() => {
    if (heartbeatRunning || leaseLost) return;
    heartbeatRunning = true;
    void renewAgentJobLease(job.id, workerId, options.leaseMs)
      .then((renewed) => {
        leaseLost = !renewed;
      })
      .catch((error) => {
        logger.error("agent.job_heartbeat_failed", {
          jobId: job.id,
          workerId,
          ...errorFingerprint(error),
        });
      })
      .finally(() => {
        heartbeatRunning = false;
      });
  }, options.heartbeatMs);

  let contextValidated = false;
  let telemetry: AgentJobTelemetryContext | null = null;
  try {
    const recoveringFinalization =
      job.lastErrorCode === "WORKER_FINALIZATION_RECOVERY";
    await assertJobContext(job, payload, ownerId, recoveringFinalization);
    contextValidated = true;
    if (recoveringFinalization) {
      const remaining = await remainingJobs(payload.runId, job.id);
      if (!remaining) {
        const [run] = await db
          .select({ status: agentRuns.status })
          .from(agentRuns)
          .where(
            and(
              eq(agentRuns.id, payload.runId),
              eq(agentRuns.ownerId, ownerId),
            ),
          )
          .limit(1);
        if (run?.status !== "completed") {
          await finalizeAgentRun(job, ownerId, payload);
        } else {
          await ensureTerminalEvent(job, ownerId, payload);
        }
      }
      const [released] = await db
        .update(processingJobs)
        .set({
          status: "completed",
          completedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          lastError: null,
        })
        .where(
          and(
            eq(processingJobs.id, job.id),
            eq(processingJobs.status, "processing"),
            eq(processingJobs.lockedBy, workerId),
          ),
        )
        .returning({ id: processingJobs.id });
      if (!released) {
        throw new AppError(
          "DATABASE_UNAVAILABLE",
          "The worker lost its lease during finalization recovery.",
        );
      }
      return {
        status: "completed" as const,
        completed: !remaining,
        remaining,
      };
    }
    await db
      .update(agentRuns)
      .set({
        status: "running",
        startedAt: sql`coalesce(${agentRuns.startedAt}, now())`,
      })
      .where(
        and(eq(agentRuns.id, payload.runId), eq(agentRuns.ownerId, ownerId)),
      );
    const [questionRow] = await db
      .select({ position: assignmentQuestions.position })
      .from(assignmentQuestions)
      .where(eq(assignmentQuestions.id, payload.questionId))
      .limit(1);
    telemetry = {
      prefix: stagePrefix(job.type),
      runId: payload.runId,
      assignmentId: job.assignmentId!,
      ownerId,
      jobId: job.id,
      questionId: payload.questionId,
      questionNumber: questionRow ? questionRow.position + 1 : null,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
    };
    const jobTelemetry = telemetry;
    await runWithAgentJobTelemetry(jobTelemetry, async () => {
      await recordAgentStage(
        "question_started",
        `${agentLabelFor(jobTelemetry.prefix)} started ${questionLabel(jobTelemetry)} (attempt ${job.attempts} of ${job.maxAttempts}).`,
      );
      if (job.type === RESEARCH_JOB_TYPE) {
        await processResearchQuestion(job.assignmentId!, ownerId, payload);
      } else if (job.type === DRAFT_JOB_TYPE) {
        await processDraftQuestion(job.assignmentId!, ownerId, payload);
      } else if (job.type === REVIEW_JOB_TYPE) {
        await processReviewQuestionJob(
          job.assignmentId!,
          ownerId,
          asReviewPayload(payload),
        );
      } else {
        await processRevisionQuestionJob(
          job.assignmentId!,
          ownerId,
          asRevisionPayload(payload),
        );
      }
    });
    if (
      leaseLost ||
      !(await renewAgentJobLease(job.id, workerId, options.leaseMs))
    ) {
      throw new AppError(
        "DATABASE_UNAVAILABLE",
        "The worker lost its lease before saving completion.",
      );
    }
    const [completedJob] = await db
      .update(processingJobs)
      .set({
        status: "completed",
        completedAt: new Date(),
        lastErrorCode: null,
        lastError: null,
      })
      .where(
        and(
          eq(processingJobs.id, job.id),
          eq(processingJobs.status, "processing"),
          eq(processingJobs.lockedBy, workerId),
        ),
      )
      .returning({ id: processingJobs.id });
    if (!completedJob) {
      throw new AppError(
        "DATABASE_UNAVAILABLE",
        "The worker lost its lease before saving completion.",
      );
    }
    const remaining = await remainingJobs(payload.runId);
    // A run stopped by an editor keeps its saved tasks but is never finalized.
    if (!remaining && !(await isRunCancelled(payload.runId))) {
      await finalizeAgentRun(job, ownerId, payload);
    }
    await db
      .update(processingJobs)
      .set({ lockedAt: null, lockedBy: null, leaseExpiresAt: null })
      .where(
        and(
          eq(processingJobs.id, job.id),
          eq(processingJobs.status, "completed"),
          eq(processingJobs.lockedBy, workerId),
        ),
      );
    return { status: "completed" as const, completed: !remaining, remaining };
  } catch (error) {
    // An editor stopped or re-queued this job while it ran: the worker no
    // longer owns it, so it must neither retry nor fail it.
    const [current] = await db
      .select({ lockedBy: processingJobs.lockedBy })
      .from(processingJobs)
      .where(eq(processingJobs.id, job.id))
      .limit(1);
    if (current?.lockedBy !== workerId) {
      logger.info("agent.job_released_by_editor", {
        jobId: job.id,
        workerId,
        ...errorFingerprint(error),
      });
      return { status: "released" as const };
    }
    const retryable = isRetryableAgentError(error);
    const recoveringFinalization =
      job.lastErrorCode === "WORKER_FINALIZATION_RECOVERY";
    if (
      retryable &&
      (recoveringFinalization || job.attempts < job.maxAttempts)
    ) {
      const delayMs = agentRetryDelayMs(job.attempts);
      await requeueJob(job, workerId, error, delayMs, recoveringFinalization);
      if (telemetry) {
        const errorCode =
          error instanceof AppError ? error.code : "UNEXPECTED_ERROR";
        await recordAgentStage(
          "retry_scheduled",
          `Attempt ${job.attempts} of ${job.maxAttempts} for ${questionLabel(telemetry)} failed (${errorCode}); retrying in ${Math.round(delayMs / 1000)}s.`,
          { errorCode, retryInMs: delayMs },
          telemetry,
        );
      }
      return { status: "queued" as const, retryInMs: delayMs };
    }
    await failRun(job, payload, ownerId, workerId, error, contextValidated);
    return { status: "failed" as const };
  } finally {
    clearInterval(heartbeat);
  }
}

async function assertJobContext(
  job: typeof processingJobs.$inferSelect,
  payload: AgentJobPayload,
  ownerId: string,
  allowCompletedRun = false,
) {
  if (!job.assignmentId) {
    throw new AppError("FORBIDDEN", "This agent task is unavailable.", {
      status: 403,
    });
  }
  const db = getDatabase();
  const expectedAgent =
    job.type === RESEARCH_JOB_TYPE
      ? "researcher"
      : job.type === DRAFT_JOB_TYPE || job.type === REVISION_JOB_TYPE
        ? "student"
        : "reviewer";
  const [run] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.id, payload.runId),
        eq(agentRuns.assignmentId, job.assignmentId),
        eq(agentRuns.ownerId, ownerId),
        eq(agentRuns.agent, expectedAgent),
        inArray(
          agentRuns.status,
          allowCompletedRun
            ? ["queued", "running", "completed"]
            : ["queued", "running"],
        ),
      ),
    )
    .limit(1);
  if (!run) {
    throw new AppError("FORBIDDEN", "This agent task is unavailable.", {
      status: 403,
    });
  }
  if (
    job.type === DRAFT_JOB_TYPE ||
    job.type === REVIEW_JOB_TYPE ||
    job.type === REVISION_JOB_TYPE
  ) {
    if (!payload.draftId) {
      throw new AppError("FORBIDDEN", "This agent task is unavailable.", {
        status: 403,
      });
    }
    const [draft] = await db
      .select({
        id: assignmentDrafts.id,
        sourceRunId: assignmentDrafts.sourceRunId,
      })
      .from(assignmentDrafts)
      .where(
        and(
          eq(assignmentDrafts.id, payload.draftId),
          eq(assignmentDrafts.assignmentId, job.assignmentId),
        ),
      )
      .limit(1);
    if (
      !draft ||
      !isDraftRunContextValid(job.type, draft.sourceRunId, payload.runId)
    ) {
      throw new AppError("FORBIDDEN", "This agent task is unavailable.", {
        status: 403,
      });
    }
  }
  if (job.type === REVIEW_JOB_TYPE) {
    const reviewPayload = asReviewPayload(payload);
    const [report] = await db
      .select({ id: reviewReports.id })
      .from(reviewReports)
      .where(
        and(
          eq(reviewReports.id, reviewPayload.reportId),
          eq(reviewReports.assignmentId, job.assignmentId),
          eq(reviewReports.draftId, reviewPayload.draftId),
          eq(reviewReports.runId, reviewPayload.runId),
        ),
      )
      .limit(1);
    if (!report) {
      throw new AppError("FORBIDDEN", "This agent task is unavailable.", {
        status: 403,
      });
    }
  }
  if (job.type === REVISION_JOB_TYPE) {
    const revisionPayload = asRevisionPayload(payload);
    const [baseDraft, report, researchRun] = await Promise.all([
      db
        .select({ id: assignmentDrafts.id })
        .from(assignmentDrafts)
        .where(
          and(
            eq(assignmentDrafts.id, revisionPayload.fromDraftId),
            eq(assignmentDrafts.assignmentId, job.assignmentId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select({ id: reviewReports.id })
        .from(reviewReports)
        .where(
          and(
            eq(reviewReports.id, revisionPayload.reportId),
            eq(reviewReports.assignmentId, job.assignmentId),
            eq(reviewReports.draftId, revisionPayload.fromDraftId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.id, revisionPayload.researchRunId),
            eq(agentRuns.assignmentId, job.assignmentId),
            eq(agentRuns.ownerId, ownerId),
            eq(agentRuns.agent, "researcher"),
            eq(agentRuns.status, "completed"),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
    ]);
    if (!baseDraft || !report || !researchRun) {
      throw new AppError("FORBIDDEN", "This agent task is unavailable.", {
        status: 403,
      });
    }
  }
}

async function processResearchQuestion(
  assignmentId: string,
  ownerId: string,
  payload: AgentJobPayload,
) {
  const db = getDatabase();
  const env = getAiEnv();
  const assignment = await ownedAssignment(assignmentId, ownerId);
  const [question] = await db
    .select()
    .from(assignmentQuestions)
    .where(
      and(
        eq(assignmentQuestions.id, payload.questionId),
        eq(assignmentQuestions.assignmentId, assignmentId),
      ),
    )
    .limit(1);
  if (!question)
    throw new AppError(
      "INVALID_INPUT",
      "The research question no longer exists.",
    );
  const [completedEvent, existingFinding] = await Promise.all([
    db
      .select({ id: agentRunEvents.id })
      .from(agentRunEvents)
      .where(
        and(
          eq(agentRunEvents.runId, payload.runId),
          inArray(agentRunEvents.eventType, [
            "research.question_completed",
            "research.gap_found",
          ]),
          sql`${agentRunEvents.metadata}->>'questionId' = ${question.id}`,
        ),
      )
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select({ id: researchFindings.id })
      .from(researchFindings)
      .where(
        and(
          eq(researchFindings.runId, payload.runId),
          eq(researchFindings.questionId, question.id),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]),
  ]);
  if (completedEvent) return;
  if (existingFinding) {
    await event(
      payload.runId,
      assignmentId,
      ownerId,
      "research.question_completed",
      `Agent C recovered completed research for question ${question.position + 1}.`,
      { questionId: question.id, recovered: true },
    );
    return;
  }
  const vector = sql`to_tsvector('english', ${documentChunks.content})`;
  const query = sql`websearch_to_tsquery('english', ${buildResearchQuery(question.prompt)})`;
  const rank = sql<number>`ts_rank(${vector}, ${query})`;
  const local = await db
    .select({
      sourceId: documentChunks.id,
      evidence: documentChunks.content,
      pageStart: documentChunks.pageStart,
      pageEnd: documentChunks.pageEnd,
      filename: documents.originalFilename,
      documentId: documents.id,
      relevanceScore: rank,
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documents.id, documentChunks.documentId))
    .where(
      and(
        eq(documentChunks.courseId, assignment.courseId),
        sql`${vector} @@ ${query}`,
      ),
    )
    .orderBy(desc(rank))
    .limit(5);
  await recordAgentStage(
    "retrieval_completed",
    `Keyword retrieval returned ${local.length} course passage${local.length === 1 ? "" : "s"} for question ${question.position + 1}.`,
    { sourceCount: local.length, retrieval: "keyword" },
  );
  const values: Array<typeof researchFindings.$inferInsert> = local.map(
    (source) => ({
      assignmentId,
      questionId: question.id,
      runId: payload.runId,
      ownerId,
      claim: question.prompt,
      evidence: source.evidence,
      sourceType: "course_material",
      sourceId: source.sourceId,
      citationMetadata: {
        documentId: source.documentId,
        title: source.filename,
        pageStart: source.pageStart,
        pageEnd: source.pageEnd,
      },
      relevanceScore: Math.max(0, Math.min(1, Number(source.relevanceScore))),
      limitations:
        "Keyword retrieval relevance; claim support still requires review.",
    }),
  );
  if (values.length < 2 && assignment.externalResearchAllowed) {
    try {
      const external = await searchCrossref(
        question.prompt,
        env.AI_REQUEST_TIMEOUT_MS,
        env.CROSSREF_CONTACT_EMAIL,
      );
      await recordAgentStage(
        "external_completed",
        `Crossref returned ${external.length} scholarly record${external.length === 1 ? "" : "s"} for question ${question.position + 1}.`,
        { sourceCount: external.length },
      );
      external.forEach((source, index) =>
        values.push({
          assignmentId,
          questionId: question.id,
          runId: payload.runId,
          ownerId,
          claim: question.prompt,
          evidence: source.evidence,
          sourceType: "external",
          sourceId: source.sourceId,
          citationMetadata: {
            title: source.title,
            url: source.url,
            ...source.metadata,
            accessedAt: new Date().toISOString(),
          },
          relevanceScore: Math.max(0.5, 0.8 - index * 0.1),
          limitations:
            "Crossref-supplied abstract metadata; inspect the complete publication before relying on the claim.",
        }),
      );
    } catch (error) {
      await event(
        payload.runId,
        assignmentId,
        ownerId,
        "research.external_unavailable",
        "External research was unavailable; Agent C continued with course materials.",
        errorFingerprint(error),
      );
    }
  }
  if (values.length) await db.insert(researchFindings).values(values);
  await event(
    payload.runId,
    assignmentId,
    ownerId,
    values.length ? "research.question_completed" : "research.gap_found",
    values.length
      ? `Agent C retrieved ${values.length} source${values.length === 1 ? "" : "s"} for question ${question.position + 1}.`
      : `No traceable evidence was found for question ${question.position + 1}.`,
    { questionId: question.id, sourceCount: values.length },
  );
}

async function processDraftQuestion(
  assignmentId: string,
  ownerId: string,
  payload: AgentJobPayload,
) {
  if (!payload.draftId)
    throw new AppError("INVALID_INPUT", "The working draft is missing.");
  const db = getDatabase();
  const env = getAiEnv();
  const assignment = await ownedAssignment(assignmentId, ownerId);
  const [question, rubric, researchRun] = await Promise.all([
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
      .from(rubricCriteria)
      .where(eq(rubricCriteria.assignmentId, assignmentId))
      .orderBy(rubricCriteria.position),
    db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.assignmentId, assignmentId),
          eq(agentRuns.ownerId, ownerId),
          eq(agentRuns.agent, "researcher"),
          eq(agentRuns.status, "completed"),
        ),
      )
      .orderBy(desc(agentRuns.createdAt))
      .limit(1)
      .then((rows) => rows[0]),
  ]);
  if (!question || !researchRun)
    throw new AppError("INVALID_INPUT", "Draft context is incomplete.");
  const [existingAnswer] = await db
    .select({ id: draftAnswers.id })
    .from(draftAnswers)
    .where(
      and(
        eq(draftAnswers.draftId, payload.draftId),
        eq(draftAnswers.questionId, question.id),
      ),
    )
    .limit(1);
  if (existingAnswer) {
    await event(
      payload.runId,
      assignmentId,
      ownerId,
      "draft.question_recovered",
      `Agent B recovered the saved answer for question ${question.position + 1}.`,
      { questionId: question.id, recovered: true },
    );
    return;
  }
  const sources = await db
    .select()
    .from(researchFindings)
    .where(
      and(
        eq(researchFindings.runId, researchRun.id),
        eq(researchFindings.questionId, question.id),
      ),
    )
    .orderBy(desc(researchFindings.relevanceScore))
    .limit(8);
  let answer;
  let usage: {
    provider: string;
    model: string;
    inputTokens: number | null;
    outputTokens: number | null;
    latencyMs: number;
  } | null = null;
  if (sources.length) {
    const drafted = await draftQuestionWithEvidence(
      instrumentProvider(
        createGenerationProvider(await getRunAiProvider(payload.runId)),
        {
          timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
        },
      ),
      env.AI_MODEL_WRITER,
      {
        prompt: question.prompt,
        requirements: question.requirements,
        wordLimit: question.wordLimit,
        rubric: rubric.map((criterion) => ({
          title: criterion.title,
          description: criterion.description,
          weight: criterion.weight,
        })),
        evidence: sources.map((finding) => ({
          sourceId: finding.sourceId,
          sourceLabel:
            typeof finding.citationMetadata.title === "string"
              ? finding.citationMetadata.title
              : "Retrieved source",
          evidence: finding.evidence,
        })),
      },
    );
    answer = drafted.answer;
    usage = drafted.usage;
  } else {
    answer = {
      markdown:
        "_Agent B did not draft this answer because Agent C found no traceable evidence._",
      citations: [],
      confidenceScore: 0,
      confidenceReasons: [
        "No traceable evidence was available for this question.",
      ],
    };
  }
  await db.transaction(async (tx) => {
    const [saved] = await tx
      .insert(draftAnswers)
      .values({
        draftId: payload.draftId!,
        questionId: question.id,
        markdown: answer.markdown,
        confidenceScore: answer.confidenceScore,
        confidenceReasons: answer.confidenceReasons,
        wordCount: countWords(answer.markdown),
      })
      .returning({ id: draftAnswers.id });
    if (!saved)
      throw new AppError("UNEXPECTED_ERROR", "The answer could not be saved.");
    const citations = answer.citations.flatMap((citation) => {
      const finding = sources.find(
        (source) => source.sourceId === citation.sourceId,
      );
      return finding
        ? [
            {
              answerId: saved.id,
              researchFindingId: finding.id,
              sourceType: finding.sourceType,
              sourceId: finding.sourceId,
              claimText: citation.claimText,
              locator: verifiedLocator(finding.citationMetadata),
              metadata: finding.citationMetadata,
              verified: false,
            },
          ]
        : [];
    });
    if (citations.length) await tx.insert(answerCitations).values(citations);
    if (usage) {
      await tx.insert(usageRecords).values({
        ownerId,
        courseId: assignment.courseId,
        assignmentId,
        runId: payload.runId,
        agent: "student",
        provider: usage.provider,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        estimatedCostUsd: "0",
        latencyMs: usage.latencyMs,
        status: "completed",
      });
    }
  });
  await event(
    payload.runId,
    assignmentId,
    ownerId,
    "draft.question_completed",
    `Agent B drafted question ${question.position + 1} with ${answer.citations.length} traceable citation${answer.citations.length === 1 ? "" : "s"}.`,
    { questionId: question.id, confidenceScore: answer.confidenceScore },
  );
}

async function isRunCancelled(runId: string) {
  const [run] = await getDatabase()
    .select({ status: agentRuns.status })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1);
  return run?.status === "cancelled";
}

async function remainingJobs(runId: string, excludingJobId?: string) {
  const [row] = await getDatabase()
    .select({ total: count() })
    .from(processingJobs)
    .where(
      and(
        sql`${processingJobs.payload}->>'runId' = ${runId}`,
        inArray(processingJobs.status, ["queued", "processing"]),
        excludingJobId ? ne(processingJobs.id, excludingJobId) : sql`true`,
      ),
    );
  return row?.total ?? 0;
}

async function finalizeAgentRun(
  job: typeof processingJobs.$inferSelect,
  ownerId: string,
  payload: AgentJobPayload,
) {
  if (job.type === RESEARCH_JOB_TYPE) {
    await finalizeResearch(job.assignmentId!, ownerId, payload.runId);
  } else if (job.type === DRAFT_JOB_TYPE) {
    await finalizeDraft(job.assignmentId!, ownerId, payload);
  } else if (job.type === REVIEW_JOB_TYPE) {
    await finalizeReviewRun(
      job.assignmentId!,
      ownerId,
      asReviewPayload(payload),
    );
  } else {
    await finalizeRevisionRun(
      job.assignmentId!,
      ownerId,
      asRevisionPayload(payload),
    );
  }
}

async function ensureTerminalEvent(
  job: typeof processingJobs.$inferSelect,
  ownerId: string,
  payload: AgentJobPayload,
) {
  const terminal =
    job.type === RESEARCH_JOB_TYPE
      ? {
          eventType: "research.completed",
          message: "Agent C completed research.",
        }
      : job.type === DRAFT_JOB_TYPE
        ? {
            eventType: "draft.completed",
            message: "Agent B completed the evidence-backed draft.",
          }
        : job.type === REVIEW_JOB_TYPE
          ? {
              eventType: "review.completed",
              message: "Agent A completed the independent review.",
            }
          : {
              eventType: "revision.completed",
              message: "Agent B completed the revision cycle.",
            };
  const [existing] = await getDatabase()
    .select({ id: agentRunEvents.id })
    .from(agentRunEvents)
    .where(
      and(
        eq(agentRunEvents.runId, payload.runId),
        eq(agentRunEvents.eventType, terminal.eventType),
      ),
    )
    .limit(1);
  if (!existing) {
    await event(
      payload.runId,
      job.assignmentId!,
      ownerId,
      terminal.eventType,
      terminal.message,
      { recovered: true },
    );
  }
}

async function finalizeResearch(
  assignmentId: string,
  ownerId: string,
  runId: string,
) {
  const db = getDatabase();
  const findings = await db
    .select({ sourceType: researchFindings.sourceType })
    .from(researchFindings)
    .where(and(eq(researchFindings.runId, runId)));
  const localCount = findings.filter(
    (item) => item.sourceType === "course_material",
  ).length;
  const externalCount = findings.filter(
    (item) => item.sourceType === "external",
  ).length;
  await db.transaction(async (tx) => {
    await tx
      .update(agentRuns)
      .set({
        status: "completed",
        output: { localCount, externalCount, total: findings.length },
        completedAt: new Date(),
      })
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.ownerId, ownerId)));
    await tx
      .update(assignments)
      .set({ status: findings.length ? "PLANNING" : "NEEDS_INFORMATION" })
      .where(eq(assignments.id, assignmentId));
  });
  await event(
    runId,
    assignmentId,
    ownerId,
    "research.completed",
    findings.length
      ? `Agent C completed research with ${findings.length} traceable source${findings.length === 1 ? "" : "s"}.`
      : "Agent C completed research but found no traceable sources.",
    { localCount, externalCount },
  );
}

async function finalizeDraft(
  assignmentId: string,
  ownerId: string,
  payload: AgentJobPayload,
) {
  if (!payload.draftId) return;
  const db = getDatabase();
  const assignment = await ownedAssignment(assignmentId, ownerId);
  const answers = await db
    .select({
      position: assignmentQuestions.position,
      prompt: assignmentQuestions.prompt,
      markdown: draftAnswers.markdown,
    })
    .from(draftAnswers)
    .innerJoin(
      assignmentQuestions,
      eq(assignmentQuestions.id, draftAnswers.questionId),
    )
    .where(eq(draftAnswers.draftId, payload.draftId))
    .orderBy(assignmentQuestions.position);
  const markdown = answers
    .map(
      (answer, index) =>
        `## Question ${index + 1}\n\n${answer.prompt}\n\n${answer.markdown}`,
    )
    .join("\n\n");
  const [draft] = await db
    .select({ version: assignmentDrafts.version })
    .from(assignmentDrafts)
    .where(eq(assignmentDrafts.id, payload.draftId))
    .limit(1);
  await db.transaction(async (tx) => {
    await tx
      .update(assignmentDrafts)
      .set({
        markdown: `# ${assignment.title}\n\n${markdown}`,
        wordCount: countWords(
          answers.map((answer) => answer.markdown).join(" "),
        ),
      })
      .where(eq(assignmentDrafts.id, payload.draftId!));
    await tx
      .update(agentRuns)
      .set({
        status: "completed",
        output: {
          draftId: payload.draftId,
          version: draft?.version,
          questionCount: answers.length,
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
  await event(
    payload.runId,
    assignmentId,
    ownerId,
    "draft.completed",
    `Agent B saved evidence-backed draft version ${draft?.version ?? "unknown"}.`,
    { version: draft?.version },
  );
}

async function failRun(
  job: typeof processingJobs.$inferSelect,
  payload: AgentJobPayload,
  ownerId: string,
  workerId: string,
  error: unknown,
  contextValidated: boolean,
) {
  const db = getDatabase();
  const message = agentPublicError(error);
  if (!contextValidated) {
    await failInvalidJob(job.id, ownerId, workerId, job.attempts, error);
    return;
  }
  const failed = await db.transaction(async (tx) => {
    const [failedJob] = await tx
      .update(processingJobs)
      .set({
        status: "failed",
        lastErrorCode:
          error instanceof AppError ? error.code : "UNEXPECTED_ERROR",
        lastError: message,
        completedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(processingJobs.id, job.id),
          inArray(processingJobs.status, ["processing", "completed"]),
          eq(processingJobs.lockedBy, workerId),
        ),
      )
      .returning({ id: processingJobs.id });
    if (!failedJob) return false;
    await tx.insert(processingJobDiagnostics).values({
      jobId: job.id,
      attempt: job.attempts,
      errorCode: error instanceof AppError ? error.code : "UNEXPECTED_ERROR",
      detail: agentDiagnostic(error),
    });
    await tx
      .update(processingJobs)
      .set({
        status: "cancelled",
        lastError: "Cancelled after another task failed.",
      })
      .where(
        and(
          sql`${processingJobs.payload}->>'runId' = ${payload.runId}`,
          eq(processingJobs.status, "queued"),
        ),
      );
    await tx
      .update(agentRuns)
      .set({
        status: "failed",
        errorCode: error instanceof AppError ? error.code : "UNEXPECTED_ERROR",
        errorMessage: message,
        completedAt: new Date(),
      })
      .where(
        and(eq(agentRuns.id, payload.runId), eq(agentRuns.ownerId, ownerId)),
      );
    if (job.type === REVIEW_JOB_TYPE && payload.reportId) {
      await tx
        .update(reviewReports)
        .set({
          overallStatus: "failed",
          requiresAnotherCycle: true,
          unresolvedConcerns: [message],
        })
        .where(and(eq(reviewReports.id, payload.reportId)));
    }
    if (job.assignmentId) {
      await tx
        .update(assignments)
        .set({ status: "NEEDS_INFORMATION" })
        .where(eq(assignments.id, job.assignmentId));
    }
    return true;
  });
  if (!failed) {
    logger.warn("agent.job_terminal_update_skipped", {
      jobId: job.id,
      workerId,
    });
    return;
  }
  if (job.assignmentId) {
    await event(
      payload.runId,
      job.assignmentId,
      ownerId,
      job.type === REVIEW_JOB_TYPE
        ? "review.failed"
        : job.type === REVISION_JOB_TYPE
          ? "revision.failed"
          : job.type === DRAFT_JOB_TYPE
            ? "draft.failed"
            : "research.failed",
      message,
      errorFingerprint(error),
    );
  }
  logger.error("agent.job_failed", {
    jobId: job.id,
    userId: ownerId,
    ...errorFingerprint(error),
  });
}

async function requeueJob(
  job: typeof processingJobs.$inferSelect,
  workerId: string,
  error: unknown,
  delayMs: number,
  recoveringFinalization = false,
) {
  const [requeued] = await getDatabase()
    .update(processingJobs)
    .set({
      status: "queued",
      availableAt: new Date(Date.now() + delayMs),
      completedAt: null,
      lockedAt: null,
      lockedBy: null,
      leaseExpiresAt: null,
      lastErrorCode: recoveringFinalization
        ? "WORKER_FINALIZATION_RECOVERY"
        : error instanceof AppError
          ? error.code
          : "UNEXPECTED_ERROR",
      lastError: agentPublicError(error),
    })
    .where(
      and(
        eq(processingJobs.id, job.id),
        inArray(processingJobs.status, ["processing", "completed"]),
        eq(processingJobs.lockedBy, workerId),
      ),
    )
    .returning({ id: processingJobs.id });
  if (!requeued) {
    throw new AppError(
      "DATABASE_UNAVAILABLE",
      "The worker lost its lease before scheduling a retry.",
    );
  }
  await getDatabase()
    .insert(processingJobDiagnostics)
    .values({
      jobId: job.id,
      attempt: job.attempts,
      errorCode: error instanceof AppError ? error.code : "UNEXPECTED_ERROR",
      detail: agentDiagnostic(error),
    });
  logger.warn("agent.job_retry_scheduled", {
    jobId: job.id,
    workerId,
    attempt: job.attempts,
    maxAttempts: job.maxAttempts,
    retryInMs: delayMs,
    ...errorFingerprint(error),
  });
}

async function failInvalidJob(
  jobId: string,
  ownerId: string,
  workerId: string,
  attempt: number,
  error: unknown,
) {
  const message = agentPublicError(error);
  const [failed] = await getDatabase()
    .update(processingJobs)
    .set({
      status: "failed",
      lastErrorCode:
        error instanceof AppError ? error.code : "UNEXPECTED_ERROR",
      lastError: message,
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      leaseExpiresAt: null,
    })
    .where(
      and(
        eq(processingJobs.id, jobId),
        eq(processingJobs.ownerId, ownerId),
        eq(processingJobs.status, "processing"),
        eq(processingJobs.lockedBy, workerId),
      ),
    )
    .returning({ id: processingJobs.id });
  if (failed) {
    await getDatabase()
      .insert(processingJobDiagnostics)
      .values({
        jobId,
        attempt,
        errorCode: error instanceof AppError ? error.code : "UNEXPECTED_ERROR",
        detail: agentDiagnostic(error),
      });
  }
  logger.warn("agent.job_context_rejected", {
    jobId,
    userId: ownerId,
    ...errorFingerprint(error),
  });
}

function stagePrefix(jobType: string): AgentStagePrefix {
  if (jobType === RESEARCH_JOB_TYPE) return "research";
  if (jobType === DRAFT_JOB_TYPE) return "draft";
  if (jobType === REVIEW_JOB_TYPE) return "review";
  return "revision";
}

function agentLabelFor(prefix: AgentStagePrefix) {
  if (prefix === "research") return "Agent C";
  if (prefix === "review") return "Agent A";
  return "Agent B";
}

function parsePayload(payload: Record<string, unknown>): AgentJobPayload {
  const parsed = agentJobPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError("INVALID_INPUT", "The agent job payload is invalid.");
  }
  return parsed.data;
}

function asReviewPayload(payload: AgentJobPayload): ReviewJobPayload {
  if (!payload.draftId || !payload.reportId) {
    throw new AppError("INVALID_INPUT", "The review job payload is invalid.");
  }
  return {
    runId: payload.runId,
    questionId: payload.questionId,
    draftId: payload.draftId,
    reportId: payload.reportId,
  };
}

function asRevisionPayload(payload: AgentJobPayload): RevisionJobPayload {
  if (
    !payload.draftId ||
    !payload.fromDraftId ||
    !payload.reportId ||
    !payload.researchRunId ||
    !payload.iteration
  ) {
    throw new AppError("INVALID_INPUT", "The revision job payload is invalid.");
  }
  return {
    runId: payload.runId,
    questionId: payload.questionId,
    draftId: payload.draftId,
    fromDraftId: payload.fromDraftId,
    reportId: payload.reportId,
    researchRunId: payload.researchRunId,
    iteration: payload.iteration,
  };
}

function verifiedLocator(metadata: Record<string, unknown>) {
  if (typeof metadata.pageStart === "number")
    return `Page ${metadata.pageStart}`;
  if (typeof metadata.url === "string") return metadata.url;
  return null;
}
