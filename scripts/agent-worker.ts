import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import postgres from "postgres";

import {
  claimNextAgentJob,
  getAgentWorkerConfig,
} from "@/features/agents/agent-job-queue";
import { processClaimedAgentJob } from "@/features/agents/persistent-workflow";
import { STUDY_DOCUMENT_JOB_TYPE } from "@/features/study-tutor/constants";
import { processClaimedStudyDocumentJob } from "@/features/study-tutor/processor";
import {
  markWorkerStopped,
  recordWorkerHeartbeat,
} from "@/features/agents/worker-heartbeat";
import { closeDatabase, getDatabase } from "@/lib/db";
import { processingJobs } from "@/lib/db/schema";
import { getDatabaseEnv, getSupabaseAdminEnv } from "@/lib/env/server";
import { errorFingerprint } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { eq } from "drizzle-orm";

const singletonLockName = "scholarflow-agent-worker-singleton";
const workerId = `${hostname()}:${process.pid}:${randomUUID()}`;
const config = getAgentWorkerConfig();
let stopping = false;

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

async function delay(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const { DATABASE_URL } = getDatabaseEnv();
  const lockClient = postgres(DATABASE_URL, {
    max: 1,
    prepare: false,
  });
  const lockConnection = await lockClient.reserve();
  const [lock] = await lockConnection.unsafe<{ acquired: boolean }[]>(
    `select pg_try_advisory_lock(hashtext('${singletonLockName}')) as acquired`,
  );
  if (!lock?.acquired) {
    logger.error("agent.worker_already_running", { workerId });
    await lockConnection.release();
    await lockClient.end({ timeout: 5 });
    process.exitCode = 2;
    return;
  }

  logger.info("agent.worker_started", {
    workerId,
    leaseMs: config.leaseMs,
    heartbeatMs: config.heartbeatMs,
    pollMs: config.pollMs,
  });
  // Study Tutor jobs download uploads from Supabase Storage; agent jobs do not.
  // Report a missing configuration once, by name only, instead of per job.
  try {
    getSupabaseAdminEnv();
  } catch {
    logger.error("study.worker_storage_unconfigured", {
      workerId,
      missing: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]
        .filter((name) => !process.env[name])
        .join(", "),
      impact: "Study Tutor uploads will fail until these are set.",
    });
  }

  let currentJobId: string | null = null;
  await recordWorkerHeartbeat(workerId, null);
  const lockHeartbeat = setInterval(() => {
    void recordWorkerHeartbeat(workerId, currentJobId);
    void lockConnection.unsafe("select 1").catch((error) => {
      stopping = true;
      logger.error("agent.worker_singleton_lock_lost", {
        workerId,
        ...errorFingerprint(error),
      });
    });
  }, config.heartbeatMs);

  try {
    while (!stopping) {
      const claimed = await claimNextAgentJob(workerId, config.leaseMs);
      if (!claimed) {
        await delay(config.pollMs);
        continue;
      }
      logger.info("agent.job_claimed", {
        workerId,
        jobId: claimed.jobId,
        exhaustedLease: claimed.exhausted,
      });
      const startedAt = performance.now();
      currentJobId = claimed.jobId;
      await recordWorkerHeartbeat(workerId, currentJobId);
      try {
        const [job] = await getDatabase()
          .select({ type: processingJobs.type })
          .from(processingJobs)
          .where(eq(processingJobs.id, claimed.jobId))
          .limit(1);
        const result =
          job?.type === STUDY_DOCUMENT_JOB_TYPE
            ? await processClaimedStudyDocumentJob(claimed.jobId, workerId, {
                leaseMs: config.leaseMs,
                heartbeatMs: config.heartbeatMs,
                exhausted: claimed.exhausted,
              })
            : await processClaimedAgentJob(claimed.jobId, workerId, {
                leaseMs: config.leaseMs,
                heartbeatMs: config.heartbeatMs,
              });
        logger.info("agent.job_worker_result", {
          workerId,
          jobId: claimed.jobId,
          status: result.status,
          durationMs: Math.round(performance.now() - startedAt),
        });
      } catch (error) {
        logger.error("agent.job_worker_unhandled", {
          workerId,
          jobId: claimed.jobId,
          durationMs: Math.round(performance.now() - startedAt),
          ...errorFingerprint(error),
        });
        await delay(config.pollMs);
      } finally {
        currentJobId = null;
        await recordWorkerHeartbeat(workerId, null);
      }
    }
  } finally {
    clearInterval(lockHeartbeat);
    await markWorkerStopped(workerId);
    try {
      await lockConnection.unsafe(
        `select pg_advisory_unlock(hashtext('${singletonLockName}'))`,
      );
    } finally {
      await lockConnection.release();
      await lockClient.end({ timeout: 5 });
      await closeDatabase();
    }
    logger.info("agent.worker_stopped", { workerId });
  }
}

main().catch((error) => {
  logger.error("agent.worker_fatal", {
    workerId,
    ...errorFingerprint(error),
  });
  process.exitCode = 1;
});
