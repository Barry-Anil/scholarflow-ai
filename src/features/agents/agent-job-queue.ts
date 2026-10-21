import "server-only";

import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { getDatabase } from "@/lib/db";
import { processingJobs } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import {
  DRAFT_JOB_TYPE,
  RESEARCH_JOB_TYPE,
  REVIEW_JOB_TYPE,
  REVISION_JOB_TYPE,
} from "./contracts";

export const agentJobTypes = [
  RESEARCH_JOB_TYPE,
  DRAFT_JOB_TYPE,
  REVIEW_JOB_TYPE,
  REVISION_JOB_TYPE,
] as const;

const workerEnvSchema = z
  .object({
    leaseMs: z.coerce.number().int().min(60_000).default(120_000),
    heartbeatMs: z.coerce.number().int().min(5_000).default(30_000),
    pollMs: z.coerce.number().int().min(250).default(2_000),
  })
  .refine((value) => value.heartbeatMs * 2 < value.leaseMs, {
    message: "AGENT_WORKER_HEARTBEAT_MS must be less than half the lease.",
  });

export function getAgentWorkerConfig() {
  return workerEnvSchema.parse({
    leaseMs: process.env.AGENT_JOB_LEASE_MS,
    heartbeatMs: process.env.AGENT_WORKER_HEARTBEAT_MS,
    pollMs: process.env.AGENT_WORKER_POLL_MS,
  });
}

export async function claimNextAgentJob(workerId: string, leaseMs: number) {
  const db = getDatabase();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('scholarflow-agent-job-claim'))`,
    );
    const [active] = await tx
      .select({ id: processingJobs.id, status: processingJobs.status })
      .from(processingJobs)
      .where(
        and(
          or(
            eq(processingJobs.status, "processing"),
            and(
              eq(processingJobs.status, "completed"),
              isNotNull(processingJobs.lockedBy),
            ),
          ),
          inArray(processingJobs.type, [...agentJobTypes]),
          sql`${processingJobs.leaseExpiresAt} > now()`,
        ),
      )
      .limit(1);
    if (active) return null;

    const [exhausted] = await tx
      .select({
        id: processingJobs.id,
        status: processingJobs.status,
        lastErrorCode: processingJobs.lastErrorCode,
      })
      .from(processingJobs)
      .where(
        and(
          or(
            eq(processingJobs.status, "processing"),
            and(
              eq(processingJobs.status, "completed"),
              isNotNull(processingJobs.lockedBy),
            ),
          ),
          inArray(processingJobs.type, [...agentJobTypes]),
          or(
            isNull(processingJobs.leaseExpiresAt),
            lte(processingJobs.leaseExpiresAt, new Date()),
          ),
          sql`${processingJobs.attempts} >= ${processingJobs.maxAttempts}`,
        ),
      )
      .orderBy(asc(processingJobs.availableAt), asc(processingJobs.createdAt))
      .limit(1);
    if (exhausted) {
      const recoveringFinalization =
        exhausted.status === "completed" ||
        exhausted.lastErrorCode === "WORKER_FINALIZATION_RECOVERY";
      const [claimed] = await tx
        .update(processingJobs)
        .set({
          status: "processing",
          lockedAt: new Date(),
          lockedBy: workerId,
          leaseExpiresAt: new Date(Date.now() + leaseMs),
          lastErrorCode: recoveringFinalization
            ? "WORKER_FINALIZATION_RECOVERY"
            : "WORKER_LEASE_EXHAUSTED",
        })
        .where(eq(processingJobs.id, exhausted.id))
        .returning({ id: processingJobs.id });
      return claimed
        ? { jobId: claimed.id, exhausted: !recoveringFinalization }
        : null;
    }

    const [candidate] = await tx
      .select({
        id: processingJobs.id,
        status: processingJobs.status,
        lastErrorCode: processingJobs.lastErrorCode,
      })
      .from(processingJobs)
      .where(
        and(
          inArray(processingJobs.type, [...agentJobTypes]),
          or(
            sql`${processingJobs.attempts} < ${processingJobs.maxAttempts}`,
            eq(processingJobs.lastErrorCode, "WORKER_FINALIZATION_RECOVERY"),
          ),
          or(
            and(
              eq(processingJobs.status, "queued"),
              lte(processingJobs.availableAt, new Date()),
            ),
            and(
              or(
                eq(processingJobs.status, "processing"),
                and(
                  eq(processingJobs.status, "completed"),
                  isNotNull(processingJobs.lockedBy),
                ),
              ),
              or(
                isNull(processingJobs.leaseExpiresAt),
                lte(processingJobs.leaseExpiresAt, new Date()),
              ),
            ),
          ),
        ),
      )
      .orderBy(asc(processingJobs.availableAt), asc(processingJobs.createdAt))
      .limit(1);
    if (!candidate) return null;
    const recoveringFinalization =
      candidate.status === "completed" ||
      candidate.lastErrorCode === "WORKER_FINALIZATION_RECOVERY";
    const [claimed] = await tx
      .update(processingJobs)
      .set({
        status: "processing",
        lockedAt: new Date(),
        lockedBy: workerId,
        leaseExpiresAt: new Date(Date.now() + leaseMs),
        attempts: recoveringFinalization
          ? sql`${processingJobs.attempts}`
          : sql`${processingJobs.attempts} + 1`,
        lastErrorCode: recoveringFinalization
          ? "WORKER_FINALIZATION_RECOVERY"
          : null,
        lastError: null,
        completedAt: null,
      })
      .where(eq(processingJobs.id, candidate.id))
      .returning({ id: processingJobs.id });
    return claimed ? { jobId: claimed.id, exhausted: false } : null;
  });
}

export async function renewAgentJobLease(
  jobId: string,
  workerId: string,
  leaseMs: number,
) {
  const [renewed] = await getDatabase()
    .update(processingJobs)
    .set({ leaseExpiresAt: new Date(Date.now() + leaseMs) })
    .where(
      and(
        eq(processingJobs.id, jobId),
        inArray(processingJobs.status, ["processing", "completed"]),
        eq(processingJobs.lockedBy, workerId),
      ),
    )
    .returning({ id: processingJobs.id });
  return Boolean(renewed);
}

export async function getOwnedAgentJobStatus(jobId: string, ownerId: string) {
  const [job] = await getDatabase()
    .select({
      id: processingJobs.id,
      status: processingJobs.status,
      attempts: processingJobs.attempts,
      maxAttempts: processingJobs.maxAttempts,
      availableAt: processingJobs.availableAt,
      completedAt: processingJobs.completedAt,
      message: processingJobs.lastError,
      lockedBy: processingJobs.lockedBy,
    })
    .from(processingJobs)
    .where(
      and(
        eq(processingJobs.id, jobId),
        eq(processingJobs.ownerId, ownerId),
        inArray(processingJobs.type, [...agentJobTypes]),
      ),
    )
    .limit(1);
  if (!job) {
    throw new AppError("FORBIDDEN", "This agent job is unavailable.", {
      status: 403,
    });
  }
  return {
    ...job,
    status:
      job.status === "completed" && job.lockedBy ? "processing" : job.status,
    lockedBy: undefined,
  };
}
