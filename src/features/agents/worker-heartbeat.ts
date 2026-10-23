import "server-only";

import { eq, sql } from "drizzle-orm";

import { getDatabase } from "@/lib/db";
import { agentWorkerHeartbeats } from "@/lib/db/schema";
import { errorFingerprint } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";

/**
 * Persists worker liveness for the monitoring drawer. Failures are logged and
 * swallowed: a missed heartbeat must never stop the worker from processing.
 */
export async function recordWorkerHeartbeat(
  workerId: string,
  currentJobId: string | null,
) {
  try {
    await getDatabase()
      .insert(agentWorkerHeartbeats)
      .values({ workerId, currentJobId })
      .onConflictDoUpdate({
        target: agentWorkerHeartbeats.workerId,
        set: {
          lastHeartbeatAt: sql`now()`,
          currentJobId,
          stoppedAt: null,
        },
      });
  } catch (error) {
    logger.warn("agent.worker_heartbeat_write_failed", {
      workerId,
      ...errorFingerprint(error),
    });
  }
}

export async function markWorkerStopped(workerId: string) {
  try {
    await getDatabase()
      .update(agentWorkerHeartbeats)
      .set({ stoppedAt: sql`now()`, currentJobId: null })
      .where(eq(agentWorkerHeartbeats.workerId, workerId));
  } catch (error) {
    logger.warn("agent.worker_heartbeat_write_failed", {
      workerId,
      ...errorFingerprint(error),
    });
  }
}
