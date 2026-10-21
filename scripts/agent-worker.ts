import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import postgres from "postgres";

import {
  claimNextAgentJob,
  getAgentWorkerConfig,
} from "@/features/agents/agent-job-queue";
import { processClaimedAgentJob } from "@/features/agents/persistent-workflow";
import { closeDatabase } from "@/lib/db";
import { getDatabaseEnv } from "@/lib/env/server";
import { errorFingerprint } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";

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

  const lockHeartbeat = setInterval(() => {
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
      try {
        const result = await processClaimedAgentJob(claimed.jobId, workerId, {
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
      }
    }
  } finally {
    clearInterval(lockHeartbeat);
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
