import "server-only";

import { and, desc, eq, inArray, like, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  agentJobTypes,
  getAgentWorkerConfig,
} from "@/features/agents/agent-job-queue";
import {
  DRAFT_JOB_TYPE,
  RESEARCH_JOB_TYPE,
  REVIEW_JOB_TYPE,
} from "@/features/agents/contracts";
import {
  isOllamaModelInstalled,
  listOllamaModels,
} from "@/lib/ai/ollama-health";
import {
  hasCoursePermission,
  requireAssignmentAccess,
} from "@/lib/auth/course-access";
import { getDatabase } from "@/lib/db";
import {
  agentRunEvents,
  agentRuns,
  agentWorkerHeartbeats,
  assignmentQuestions,
  documentChunks,
  processingJobs,
  usageRecords,
} from "@/lib/db/schema";
import { getAiEnv, getOllamaAccessCredentials } from "@/lib/env/server";
import { errorFingerprint } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import {
  deriveWorkerState,
  eventSeverity,
  knownNonInfoStages,
  monitorAgentOrder,
  openModelRequestFor,
  sanitizeEventMetadata,
  stagesForSeverity,
  type EventSeverity,
  type JobKind,
  type MonitorAgentKey,
  type MonitorEvent,
  type MonitorJob,
  type MonitorRun,
  type MonitorSnapshot,
} from "./status-model";

const RUN_EVENT_LIMIT = 30;
const OLLAMA_PROBE_TIMEOUT_MS = 5_000;

const monitorEnvSchema = z.object({
  healthTtlMs: z.coerce.number().int().min(5_000).default(30_000),
  modelGraceMs: z.coerce.number().int().min(0).default(30_000),
  workerStaleMs: z.coerce.number().int().min(10_000).optional(),
});

export function getMonitorConfig() {
  const worker = getAgentWorkerConfig();
  const parsed = monitorEnvSchema.parse({
    healthTtlMs: process.env.AGENT_MONITOR_HEALTH_TTL_MS,
    modelGraceMs: process.env.AGENT_MONITOR_MODEL_GRACE_MS,
    workerStaleMs: process.env.AGENT_MONITOR_WORKER_STALE_MS,
  });
  return {
    ...parsed,
    // Three missed heartbeats before the worker is reported as stale.
    workerStaleMs: parsed.workerStaleMs ?? worker.heartbeatMs * 3,
    leaseMs: worker.leaseMs,
    heartbeatMs: worker.heartbeatMs,
  };
}

type OllamaStatus = MonitorSnapshot["ollama"];

// Process-local cache so polling browsers share one tags probe per TTL.
let ollamaCache: { checkedAt: number; value: OllamaStatus } | null = null;
let ollamaProbe: Promise<OllamaStatus> | null = null;
let ollamaLastSuccessAt: string | null = null;

async function getOllamaStatus(
  models: MonitorSnapshot["config"]["models"],
  ttlMs: number,
): Promise<OllamaStatus> {
  if (ollamaCache && Date.now() - ollamaCache.checkedAt < ttlMs) {
    return ollamaCache.value;
  }
  ollamaProbe ??= probeOllama(models).finally(() => {
    ollamaProbe = null;
  });
  return ollamaProbe;
}

async function probeOllama(
  models: MonitorSnapshot["config"]["models"],
): Promise<OllamaStatus> {
  const env = getAiEnv();
  const roles = Object.entries(models) as Array<
    [OllamaStatus["models"][number]["role"], string]
  >;
  const checkedAt = new Date().toISOString();
  let value: OllamaStatus;
  try {
    const result = await listOllamaModels(
      env.OLLAMA_BASE_URL,
      Math.min(env.AI_REQUEST_TIMEOUT_MS, OLLAMA_PROBE_TIMEOUT_MS),
      getOllamaAccessCredentials(),
    );
    ollamaLastSuccessAt = checkedAt;
    value = {
      state: "reachable",
      checkedAt,
      lastSuccessAt: checkedAt,
      latencyMs: result.latencyMs,
      errorCode: null,
      models: roles.map(([role, name]) => ({
        role,
        name,
        installed: isOllamaModelInstalled(result.models, name),
      })),
    };
  } catch (error) {
    value = {
      state: "unreachable",
      checkedAt,
      lastSuccessAt: ollamaLastSuccessAt,
      latencyMs: null,
      errorCode: errorFingerprint(error).errorCode ?? "AI_UNAVAILABLE",
      models: roles.map(([role, name]) => ({ role, name, installed: null })),
    };
  }
  ollamaCache = { checkedAt: Date.parse(checkedAt), value };
  return value;
}

function iso(value: Date | null) {
  return value ? value.toISOString() : null;
}

function jobKind(type: string): JobKind {
  if (type === RESEARCH_JOB_TYPE) return "research";
  if (type === DRAFT_JOB_TYPE) return "draft";
  if (type === REVIEW_JOB_TYPE) return "review";
  return "revision";
}

function toMonitorEvent(
  row: {
    id: string;
    runId: string;
    eventType: string;
    message: string;
    metadata: Record<string, unknown>;
    createdAt: Date;
  },
  agent: MonitorAgentKey | "system",
): MonitorEvent {
  return {
    id: row.id,
    runId: row.runId,
    agent,
    eventType: row.eventType,
    message: row.message,
    severity: eventSeverity(row.eventType),
    createdAt: row.createdAt.toISOString(),
    metadata: sanitizeEventMetadata(row.metadata),
  };
}

export async function getAssignmentMonitor(
  assignmentId: string,
  userId: string,
): Promise<MonitorSnapshot> {
  const access = await requireAssignmentAccess(assignmentId, userId, "read");
  const db = getDatabase();
  const env = getAiEnv();
  const config = getMonitorConfig();
  const models = {
    writer: env.AI_MODEL_WRITER,
    researcher: env.AI_MODEL_RESEARCHER,
    reviewer: env.AI_MODEL_REVIEWER,
    embedding: env.AI_EMBEDDING_MODEL,
  };

  const [
    recentRuns,
    questions,
    heartbeat,
    queueRow,
    lastSuccess,
    lastFailure,
    chunks,
    ollama,
  ] = await Promise.all([
    db
      .select()
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.assignmentId, assignmentId),
          inArray(agentRuns.agent, monitorAgentOrder),
        ),
      )
      .orderBy(desc(agentRuns.createdAt))
      .limit(30),
    db
      .select({
        id: assignmentQuestions.id,
        position: assignmentQuestions.position,
      })
      .from(assignmentQuestions)
      .where(eq(assignmentQuestions.assignmentId, assignmentId)),
    db
      .select()
      .from(agentWorkerHeartbeats)
      .orderBy(desc(agentWorkerHeartbeats.lastHeartbeatAt))
      .limit(1)
      .then((rows) => rows[0] ?? null)
      // Before the heartbeat migration is applied the worker reads as unknown
      // rather than failing the whole snapshot.
      .catch((error: unknown) => {
        logger.warn("monitor.worker_heartbeat_unavailable", {
          ...errorFingerprint(error),
        });
        return null;
      }),
    db
      .select({
        queued:
          sql<number>`count(*) filter (where ${processingJobs.status} = 'queued')`.mapWith(
            Number,
          ),
        retrying:
          sql<number>`count(*) filter (where ${processingJobs.status} = 'queued' and ${processingJobs.attempts} > 0)`.mapWith(
            Number,
          ),
        running:
          sql<number>`count(*) filter (where ${processingJobs.status} = 'processing' or (${processingJobs.status} = 'completed' and ${processingJobs.lockedBy} is not null))`.mapWith(
            Number,
          ),
        completed:
          sql<number>`count(*) filter (where ${processingJobs.status} = 'completed' and ${processingJobs.lockedBy} is null)`.mapWith(
            Number,
          ),
        failed:
          sql<number>`count(*) filter (where ${processingJobs.status} = 'failed')`.mapWith(
            Number,
          ),
        cancelled:
          sql<number>`count(*) filter (where ${processingJobs.status} = 'cancelled')`.mapWith(
            Number,
          ),
        oldestQueuedAt: sql<
          string | null
        >`min(${processingJobs.createdAt}) filter (where ${processingJobs.status} = 'queued')`,
      })
      .from(processingJobs)
      .where(
        and(
          eq(processingJobs.assignmentId, assignmentId),
          inArray(processingJobs.type, [...agentJobTypes]),
        ),
      )
      .then((rows) => rows[0]),
    db
      .select({
        createdAt: usageRecords.createdAt,
        agent: usageRecords.agent,
        model: usageRecords.model,
        latencyMs: usageRecords.latencyMs,
      })
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.assignmentId, assignmentId),
          eq(usageRecords.status, "completed"),
        ),
      )
      .orderBy(desc(usageRecords.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        createdAt: agentRunEvents.createdAt,
        message: agentRunEvents.message,
        metadata: agentRunEvents.metadata,
      })
      .from(agentRunEvents)
      .where(
        and(
          eq(agentRunEvents.assignmentId, assignmentId),
          like(agentRunEvents.eventType, "%.model_request_failed"),
        ),
      )
      .orderBy(desc(agentRunEvents.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        embedded: sql<number>`count(${documentChunks.embedding})`.mapWith(
          Number,
        ),
      })
      .from(documentChunks)
      .where(eq(documentChunks.courseId, access.courseId))
      .then((rows) => rows[0]),
    getOllamaStatus(models, config.healthTtlMs),
  ]);

  const latestRuns = monitorAgentOrder.flatMap((agent) => {
    const run = recentRuns.find((candidate) => candidate.agent === agent);
    return run ? [run] : [];
  });
  const runIds = latestRuns.map((run) => run.id);
  const questionNumbers = new Map(
    questions.map((question) => [question.id, question.position + 1]),
  );

  const [jobs, eventsByRun, aheadOfAssignment] = await Promise.all([
    runIds.length
      ? db
          .select()
          .from(processingJobs)
          .where(
            and(
              eq(processingJobs.assignmentId, assignmentId),
              inArray(processingJobs.type, [...agentJobTypes]),
              inArray(sql<string>`${processingJobs.payload}->>'runId'`, runIds),
            ),
          )
          .orderBy(processingJobs.createdAt)
      : Promise.resolve([]),
    Promise.all(
      latestRuns.map((run) =>
        db
          .select()
          .from(agentRunEvents)
          .where(eq(agentRunEvents.runId, run.id))
          .orderBy(desc(agentRunEvents.createdAt), desc(agentRunEvents.id))
          .limit(RUN_EVENT_LIMIT)
          .then((rows) =>
            rows.map((row) =>
              toMonitorEvent(row, run.agent as MonitorAgentKey),
            ),
          ),
      ),
    ),
    queueRow?.oldestQueuedAt
      ? db
          .select({ total: sql<number>`count(*)`.mapWith(Number) })
          .from(processingJobs)
          .where(
            and(
              inArray(processingJobs.type, [...agentJobTypes]),
              eq(processingJobs.status, "queued"),
              sql`${processingJobs.availableAt} <= now()`,
              sql`${processingJobs.createdAt} < ${queueRow.oldestQueuedAt}`,
              sql`${processingJobs.assignmentId} is distinct from ${assignmentId}`,
            ),
          )
          .then((rows) => rows[0]?.total ?? 0)
      : Promise.resolve(0),
  ]);

  const runs: MonitorRun[] = latestRuns.map((run, index) => ({
    id: run.id,
    agent: run.agent as MonitorAgentKey,
    status: run.status,
    workflowState: run.workflowState,
    provider: run.provider,
    model: run.model,
    createdAt: run.createdAt.toISOString(),
    startedAt: iso(run.startedAt),
    completedAt: iso(run.completedAt),
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    retryable:
      (run.status === "failed" || run.status === "cancelled") &&
      recentRuns[0]?.id === run.id,
    jobs: jobs
      .filter((job) => job.payload.runId === run.id)
      .map((job): MonitorJob => {
        const questionId =
          typeof job.payload.questionId === "string"
            ? job.payload.questionId
            : null;
        return {
          id: job.id,
          kind: jobKind(job.type),
          questionId,
          questionNumber: questionId
            ? (questionNumbers.get(questionId) ?? null)
            : null,
          status: job.status,
          finalizing: job.status === "completed" && job.lockedBy !== null,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          availableAt: job.availableAt.toISOString(),
          lockedAt: iso(job.lockedAt),
          leaseExpiresAt: iso(job.leaseExpiresAt),
          completedAt: iso(job.completedAt),
          lastErrorCode: job.lastErrorCode,
          lastError: job.lastError,
        };
      }),
    events: eventsByRun[index] ?? [],
  }));

  const inFlight = runs
    .flatMap((run) =>
      run.jobs
        .filter((job) => job.status === "processing")
        .map((job) => ({
          startedAt: openModelRequestFor(run.events, job.id),
          model: run.model,
        })),
    )
    .find((item) => item.startedAt !== null);

  const failureModel = lastFailure?.metadata.model;
  const failureCode = lastFailure?.metadata.errorCode;

  return {
    generatedAt: new Date().toISOString(),
    assignmentId,
    canEdit: hasCoursePermission(access.role, "edit"),
    config: {
      models,
      requestTimeoutMs: env.AI_REQUEST_TIMEOUT_MS,
      modelGraceMs: config.modelGraceMs,
      workerStaleMs: config.workerStaleMs,
      leaseMs: config.leaseMs,
      heartbeatMs: config.heartbeatMs,
    },
    ollama,
    generation: {
      lastSuccess: lastSuccess
        ? {
            at: lastSuccess.createdAt.toISOString(),
            agent: lastSuccess.agent,
            model: lastSuccess.model,
            latencyMs: lastSuccess.latencyMs,
          }
        : null,
      lastFailure: lastFailure
        ? {
            at: lastFailure.createdAt.toISOString(),
            errorCode:
              typeof failureCode === "string"
                ? failureCode
                : "UNEXPECTED_ERROR",
            message: lastFailure.message,
            model: typeof failureModel === "string" ? failureModel : null,
          }
        : null,
      inFlight: inFlight?.startedAt
        ? { startedAt: inFlight.startedAt, model: inFlight.model }
        : null,
    },
    embeddings: {
      modelInstalled:
        ollama.models.find((model) => model.role === "embedding")?.installed ??
        null,
      chunkCount: chunks?.total ?? 0,
      embeddedChunkCount: chunks?.embedded ?? 0,
    },
    worker: {
      state: deriveWorkerState(
        {
          lastHeartbeatAt: iso(heartbeat?.lastHeartbeatAt ?? null),
          stoppedAt: iso(heartbeat?.stoppedAt ?? null),
        },
        Date.now(),
        config.workerStaleMs,
      ),
      startedAt: iso(heartbeat?.startedAt ?? null),
      lastHeartbeatAt: iso(heartbeat?.lastHeartbeatAt ?? null),
      stoppedAt: iso(heartbeat?.stoppedAt ?? null),
      busy: Boolean(heartbeat?.currentJobId),
    },
    queue: {
      queued: queueRow?.queued ?? 0,
      running: queueRow?.running ?? 0,
      retrying: queueRow?.retrying ?? 0,
      completed: queueRow?.completed ?? 0,
      failed: queueRow?.failed ?? 0,
      cancelled: queueRow?.cancelled ?? 0,
      aheadOfAssignment,
    },
    runs,
  };
}

export const eventQuerySchema = z.object({
  cursor: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T[^|]+\|[0-9a-f-]{36}$/i)
    .optional(),
  agent: z.enum(["researcher", "student", "reviewer"]).optional(),
  severity: z.enum(["info", "success", "warning", "failure"]).optional(),
  sinceHours: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

export type EventQuery = z.infer<typeof eventQuerySchema>;

export async function getAssignmentEvents(
  assignmentId: string,
  userId: string,
  query: EventQuery,
) {
  await requireAssignmentAccess(assignmentId, userId, "read");
  const filters = [eq(agentRunEvents.assignmentId, assignmentId)];
  if (query.agent) filters.push(eq(agentRuns.agent, query.agent));
  if (query.sinceHours) {
    filters.push(
      sql`${agentRunEvents.createdAt} >= now() - make_interval(hours => ${query.sinceHours})`,
    );
  }
  if (query.severity) filters.push(severityFilter(query.severity));
  if (query.cursor) {
    const [createdAt, id] = query.cursor.split("|") as [string, string];
    const cursorDate = new Date(createdAt);
    filters.push(
      or(
        lt(agentRunEvents.createdAt, cursorDate),
        and(
          eq(agentRunEvents.createdAt, cursorDate),
          lt(agentRunEvents.id, id),
        ),
      )!,
    );
  }
  const rows = await getDatabase()
    .select({
      id: agentRunEvents.id,
      runId: agentRunEvents.runId,
      eventType: agentRunEvents.eventType,
      message: agentRunEvents.message,
      metadata: agentRunEvents.metadata,
      createdAt: agentRunEvents.createdAt,
      agent: agentRuns.agent,
    })
    .from(agentRunEvents)
    .innerJoin(agentRuns, eq(agentRuns.id, agentRunEvents.runId))
    .where(and(...filters))
    .orderBy(desc(agentRunEvents.createdAt), desc(agentRunEvents.id))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    events: page.map((row) =>
      toMonitorEvent(
        row,
        row.agent === "system" ? "system" : (row.agent as MonitorAgentKey),
      ),
    ),
    nextCursor:
      rows.length > query.limit && last
        ? `${last.createdAt.toISOString()}|${last.id}`
        : null,
  };
}

function severityFilter(severity: EventSeverity) {
  const stageMatches = (stages: string[]) =>
    or(...stages.map((stage) => like(agentRunEvents.eventType, `%.${stage}`)))!;
  if (severity !== "info") return stageMatches(stagesForSeverity(severity));
  return sql`not (${stageMatches(knownNonInfoStages())})`;
}
