import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { requireAssignmentAccess } from "@/lib/auth/course-access";
import { getDatabase } from "@/lib/db";
import {
  agentRunEvents,
  agentRuns,
  assignments,
  processingJobs,
  reviewReports,
} from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { agentJobTypes } from "./agent-job-queue";

export const CANCELLED_BY_USER = "CANCELLED_BY_USER";
const STOPPED_MESSAGE = "Stopped by a course editor.";

type Transaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
>[0];

function stagePrefix(run: { agent: string; workflowState: string }) {
  if (run.agent === "researcher") return "research";
  if (run.agent === "reviewer") return "review";
  return run.workflowState === "REVISING" ? "revision" : "draft";
}

function runJobs(runId: string) {
  return and(
    inArray(processingJobs.type, [...agentJobTypes]),
    sql`${processingJobs.payload}->>'runId' = ${runId}`,
  );
}

async function lockedRun(tx: Transaction, assignmentId: string, runId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${assignmentId}))`,
  );
  const [run] = await tx
    .select()
    .from(agentRuns)
    .where(
      and(eq(agentRuns.id, runId), eq(agentRuns.assignmentId, assignmentId)),
    )
    .limit(1);
  if (!run) {
    throw new AppError("FORBIDDEN", "This agent run is unavailable.", {
      status: 404,
    });
  }
  return run;
}

/**
 * Cancels a queued or running agent run. Saved per-question output is kept.
 * A model request already in flight cannot be interrupted, but once its job is
 * cancelled the worker can no longer complete it or finalize the run.
 */
export async function stopAgentRun(
  assignmentId: string,
  userId: string,
  runId: string,
) {
  await requireAssignmentAccess(assignmentId, userId, "edit");
  return getDatabase().transaction(async (tx) => {
    const run = await lockedRun(tx, assignmentId, runId);
    if (run.status !== "queued" && run.status !== "running") {
      throw new AppError(
        "INVALID_INPUT",
        "This agent run is no longer active.",
        { status: 409 },
      );
    }
    const cancelled = await tx
      .update(processingJobs)
      .set({
        status: "cancelled",
        lastErrorCode: CANCELLED_BY_USER,
        lastError: STOPPED_MESSAGE,
        completedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          runJobs(run.id),
          inArray(processingJobs.status, ["queued", "processing"]),
        ),
      )
      .returning({ id: processingJobs.id });
    // Saved output stays saved; only release a lease held for finalization.
    await tx
      .update(processingJobs)
      .set({ lockedAt: null, lockedBy: null, leaseExpiresAt: null })
      .where(and(runJobs(run.id), eq(processingJobs.status, "completed")));
    await tx
      .update(agentRuns)
      .set({
        status: "cancelled",
        errorCode: CANCELLED_BY_USER,
        errorMessage: STOPPED_MESSAGE,
        completedAt: new Date(),
      })
      .where(eq(agentRuns.id, run.id));
    if (run.agent === "reviewer") {
      await tx
        .update(reviewReports)
        .set({
          overallStatus: "cancelled",
          requiresAnotherCycle: true,
          unresolvedConcerns: [STOPPED_MESSAGE],
        })
        .where(eq(reviewReports.runId, run.id));
    }
    await tx
      .update(assignments)
      .set({ status: "READY" })
      .where(eq(assignments.id, assignmentId));
    await tx.insert(agentRunEvents).values({
      runId: run.id,
      assignmentId,
      ownerId: run.ownerId,
      eventType: `${stagePrefix(run)}.cancelled`,
      message: `Stopped by a course editor; ${cancelled.length} unfinished task${cancelled.length === 1 ? " was" : "s were"} cancelled and saved tasks were kept.`,
      metadata: { cancelledTasks: cancelled.length },
    });
    return { cancelledTasks: cancelled.length };
  });
}

/**
 * Re-queues the unfinished tasks of the latest failed or stopped run. Every
 * job type skips questions whose output is already saved, so completed work
 * is kept and nothing is duplicated.
 */
export async function retryAgentRun(
  assignmentId: string,
  userId: string,
  runId: string,
) {
  await requireAssignmentAccess(assignmentId, userId, "edit");
  return getDatabase().transaction(async (tx) => {
    const run = await lockedRun(tx, assignmentId, runId);
    if (run.status !== "failed" && run.status !== "cancelled") {
      throw new AppError(
        "INVALID_INPUT",
        "Only a failed or stopped run can be retried.",
        { status: 409 },
      );
    }
    const [latest] = await tx
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(eq(agentRuns.assignmentId, assignmentId))
      .orderBy(desc(agentRuns.createdAt))
      .limit(1);
    if (latest?.id !== run.id) {
      throw new AppError(
        "INVALID_INPUT",
        "A newer agent run exists. Start a new run from the Agents panel instead.",
        { status: 409 },
      );
    }
    const requeue = {
      status: "queued" as const,
      attempts: 0,
      availableAt: new Date(),
      lastErrorCode: null,
      lastError: null,
      completedAt: null,
      lockedAt: null,
      lockedBy: null,
      leaseExpiresAt: null,
    };
    let requeued = await tx
      .update(processingJobs)
      .set(requeue)
      .where(
        and(
          runJobs(run.id),
          inArray(processingJobs.status, ["failed", "cancelled"]),
        ),
      )
      .returning({ id: processingJobs.id });
    if (!requeued.length) {
      // Every task was saved but finalization failed: one idempotent pass over
      // a saved task lets the worker finalize the run again.
      const [last] = await tx
        .select({ id: processingJobs.id })
        .from(processingJobs)
        .where(runJobs(run.id))
        .orderBy(desc(processingJobs.createdAt))
        .limit(1);
      if (!last) {
        throw new AppError("INVALID_INPUT", "This run has no tasks to retry.", {
          status: 409,
        });
      }
      requeued = await tx
        .update(processingJobs)
        .set(requeue)
        .where(eq(processingJobs.id, last.id))
        .returning({ id: processingJobs.id });
    }
    await tx
      .update(agentRuns)
      .set({
        status: "queued",
        errorCode: null,
        errorMessage: null,
        completedAt: null,
      })
      .where(eq(agentRuns.id, run.id));
    if (run.agent === "reviewer") {
      await tx
        .update(reviewReports)
        .set({
          overallStatus: "in_progress",
          requiresAnotherCycle: true,
          unresolvedConcerns: [],
        })
        .where(eq(reviewReports.runId, run.id));
    }
    await tx
      .update(assignments)
      .set({ status: run.workflowState })
      .where(eq(assignments.id, assignmentId));
    await tx.insert(agentRunEvents).values({
      runId: run.id,
      assignmentId,
      ownerId: run.ownerId,
      eventType: `${stagePrefix(run)}.retry_requested`,
      message: `Retry requested: ${requeued.length} unfinished task${requeued.length === 1 ? "" : "s"} re-queued; saved tasks are kept.`,
      metadata: { requeuedTasks: requeued.length },
    });
    return { requeuedTasks: requeued.length };
  });
}
