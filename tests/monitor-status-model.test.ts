import { describe, expect, it } from "vitest";

import {
  analyzeRun,
  buildRunSteps,
  deriveJobState,
  deriveWorkerState,
  eventSeverity,
  openModelRequestFor,
  overallMonitorState,
  runProgress,
  sanitizeEventMetadata,
  type JobStateContext,
  type MonitorEvent,
  type MonitorJob,
  type MonitorRun,
  type MonitorSnapshot,
} from "@/features/monitoring/status-model";
import { nextPollDelay } from "@/features/monitoring/use-monitor-snapshot";

const NOW = Date.parse("2026-10-23T10:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const ahead = (ms: number) => new Date(NOW + ms).toISOString();

function job(overrides: Partial<MonitorJob> = {}): MonitorJob {
  return {
    id: "job-1",
    kind: "draft",
    questionId: "q-1",
    questionNumber: 1,
    status: "queued",
    finalizing: false,
    attempts: 0,
    maxAttempts: 3,
    availableAt: ago(1_000),
    lockedAt: null,
    leaseExpiresAt: null,
    completedAt: null,
    lastErrorCode: null,
    lastError: null,
    ...overrides,
  };
}

function event(
  eventType: string,
  createdAt: string,
  metadata: MonitorEvent["metadata"] = {},
): MonitorEvent {
  return {
    id: `${eventType}-${createdAt}`,
    runId: "run-1",
    agent: "student",
    eventType,
    message: eventType,
    severity: eventSeverity(eventType),
    createdAt,
    metadata,
  };
}

function run(overrides: Partial<MonitorRun> = {}): MonitorRun {
  return {
    id: "run-1",
    agent: "student",
    status: "running",
    workflowState: "DRAFTING",
    provider: "ollama",
    model: "qwen3:8b",
    createdAt: ago(60_000),
    startedAt: ago(50_000),
    completedAt: null,
    errorCode: null,
    errorMessage: null,
    retryable: false,
    jobs: [],
    events: [],
    ...overrides,
  };
}

const context: JobStateContext = {
  now: NOW,
  workerState: "online",
  modelTimeoutMs: 120_000,
  modelGraceMs: 30_000,
  openModelRequestStartedAt: null,
};

function snapshot(overrides: Partial<MonitorSnapshot> = {}): MonitorSnapshot {
  return {
    generatedAt: new Date(NOW).toISOString(),
    assignmentId: "a-1",
    canEdit: true,
    config: {
      models: {
        writer: "qwen3:8b",
        researcher: "qwen3:8b",
        reviewer: "qwen3:8b",
        embedding: "nomic-embed-text",
      },
      requestTimeoutMs: 120_000,
      modelGraceMs: 30_000,
      workerStaleMs: 90_000,
      leaseMs: 120_000,
      heartbeatMs: 30_000,
    },
    ollama: {
      state: "reachable",
      checkedAt: ago(1_000),
      lastSuccessAt: ago(1_000),
      latencyMs: 12,
      errorCode: null,
      models: [],
    },
    generation: { lastSuccess: null, lastFailure: null, inFlight: null },
    embeddings: { modelInstalled: true, chunkCount: 0, embeddedChunkCount: 0 },
    worker: {
      state: "online",
      startedAt: ago(600_000),
      lastHeartbeatAt: ago(5_000),
      stoppedAt: null,
      busy: true,
    },
    queue: {
      queued: 0,
      running: 0,
      retrying: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      aheadOfAssignment: 0,
    },
    runs: [],
    ...overrides,
  };
}

describe("job state derivation", () => {
  it("reports a processing job with a live lease as running", () => {
    expect(
      deriveJobState(
        job({ status: "processing", leaseExpiresAt: ahead(60_000) }),
        context,
      ).state,
    ).toBe("running");
  });

  it("flags an expired lease as potentially stalled, never failed", () => {
    const result = deriveJobState(
      job({ status: "processing", leaseExpiresAt: ago(1) }),
      context,
    );
    expect(result.state).toBe("potentially_stalled");
    expect(result.reason).toMatch(/lease expired/);
  });

  it("flags a model request past timeout plus grace as potentially stalled", () => {
    const processing = job({
      status: "processing",
      leaseExpiresAt: ahead(60_000),
    });
    expect(
      deriveJobState(processing, {
        ...context,
        openModelRequestStartedAt: ago(149_000),
      }).state,
    ).toBe("running");
    expect(
      deriveJobState(processing, {
        ...context,
        openModelRequestStartedAt: ago(151_000),
      }).state,
    ).toBe("potentially_stalled");
  });

  it("flags an attempt held past the model budget even without stage events", () => {
    const held = (ms: number) =>
      job({
        status: "processing",
        leaseExpiresAt: ahead(60_000),
        lockedAt: ago(ms),
      });
    expect(deriveJobState(held(60_000), context).state).toBe("running");
    const stuck = deriveJobState(held(151_000), context);
    expect(stuck.state).toBe("potentially_stalled");
    expect(stuck.reason).toMatch(/stop the run and retry/);
  });

  it("distinguishes a scheduled retry from waiting for the worker", () => {
    expect(
      deriveJobState(
        job({
          attempts: 1,
          availableAt: ahead(15_000),
          lastErrorCode: "AI_TIMEOUT",
        }),
        context,
      ),
    ).toMatchObject({ state: "retry_scheduled" });
    expect(
      deriveJobState(job(), { ...context, workerState: "stale" }).state,
    ).toBe("waiting_worker");
    expect(deriveJobState(job(), context).state).toBe("queued");
  });

  it("treats saved-but-locked jobs as finalizing", () => {
    expect(
      deriveJobState(
        job({
          status: "completed",
          finalizing: true,
          leaseExpiresAt: ahead(10_000),
        }),
        context,
      ).state,
    ).toBe("finalizing");
  });

  it("derives worker state from the persisted heartbeat", () => {
    expect(
      deriveWorkerState(
        { lastHeartbeatAt: null, stoppedAt: null },
        NOW,
        90_000,
      ),
    ).toBe("unknown");
    expect(
      deriveWorkerState(
        { lastHeartbeatAt: ago(10_000), stoppedAt: null },
        NOW,
        90_000,
      ),
    ).toBe("online");
    expect(
      deriveWorkerState(
        { lastHeartbeatAt: ago(91_000), stoppedAt: null },
        NOW,
        90_000,
      ),
    ).toBe("stale");
    expect(
      deriveWorkerState(
        { lastHeartbeatAt: ago(1_000), stoppedAt: ago(500) },
        NOW,
        90_000,
      ),
    ).toBe("stopped");
  });
});

describe("open model requests", () => {
  it("is open only until an outcome is recorded for the same job", () => {
    const started = event("draft.model_request_started", ago(20_000), {
      jobId: "job-1",
    });
    expect(openModelRequestFor([started], "job-1")).toBe(started.createdAt);
    const received = event("draft.model_response_received", ago(5_000), {
      jobId: "job-1",
    });
    expect(openModelRequestFor([received, started], "job-1")).toBeNull();
    expect(openModelRequestFor([started], "job-2")).toBeNull();
  });
});

describe("run progress", () => {
  it("counts only persisted milestones and reaches 100% after finalization", () => {
    const jobs = [
      job({ id: "a", status: "completed" }),
      job({ id: "b", status: "completed" }),
      job({ id: "c", status: "processing" }),
    ];
    expect(runProgress(run({ jobs }))).toEqual({
      completedMilestones: 2,
      totalMilestones: 4,
      percent: 50,
    });
    const allSaved = jobs.map((item) => ({
      ...item,
      status: "completed" as const,
    }));
    expect(runProgress(run({ jobs: allSaved })).percent).toBe(75);
    expect(
      runProgress(run({ jobs: allSaved, status: "completed" })).percent,
    ).toBe(100);
  });

  it("never reaches 100% for a failed run", () => {
    const jobs = [
      job({ id: "a", status: "completed" }),
      job({ id: "b", status: "failed" }),
    ];
    expect(runProgress(run({ jobs, status: "failed" })).percent).toBe(33);
  });

  it("does not move backwards when a job is retried", () => {
    const before = runProgress(
      run({
        jobs: [
          job({ id: "a", status: "completed" }),
          job({ id: "b", status: "processing", attempts: 1 }),
        ],
      }),
    );
    const afterRetry = runProgress(
      run({
        jobs: [
          job({ id: "a", status: "completed" }),
          job({
            id: "b",
            status: "queued",
            attempts: 1,
            availableAt: ahead(15_000),
          }),
        ],
      }),
    );
    expect(afterRetry.percent).toBe(before.percent);
  });

  it("reports no percentage when a run has no measurable tasks", () => {
    expect(runProgress(run()).percent).toBeNull();
  });
});

describe("steps for the loading component", () => {
  it("animates only jobs with live evidence of work", () => {
    const steps = buildRunSteps(
      run({
        jobs: [
          job({ id: "a", questionNumber: 1, status: "completed" }),
          job({ id: "b", questionNumber: 2, status: "processing" }),
          job({ id: "c", questionNumber: 3, status: "processing" }),
        ],
      }),
      new Map([
        ["a", "completed"],
        ["b", "running"],
        ["c", "potentially_stalled"],
      ]),
    );
    expect(steps.map((step) => step.status)).toEqual([
      "done",
      "running",
      "pending",
      "pending",
    ]);
    expect(steps[2]?.label).toContain("potentially stalled");
  });

  it("marks the final save as failed when the run failed", () => {
    const steps = buildRunSteps(
      run({ status: "failed", jobs: [job({ id: "a", status: "failed" })] }),
      new Map([["a", "failed"]]),
    );
    expect(steps.map((step) => step.status)).toEqual(["error", "error"]);
  });

  it("labels the current stage from the newest persisted event", () => {
    const analysis = analyzeRun(
      run({
        jobs: [
          job({
            id: "a",
            status: "processing",
            leaseExpiresAt: ahead(60_000),
          }),
        ],
        events: [
          event("draft.model_request_started", ago(3_000), { jobId: "a" }),
          event("draft.question_started", ago(4_000), { jobId: "a" }),
        ],
      }),
      snapshot(),
      NOW,
    );
    expect(analysis.state).toBe("running");
    expect(analysis.currentStage).toBe(
      "Question 1 · Waiting for the model to generate the answer",
    );
    expect(analysis.currentJobStartedAt).toBe(ago(4_000));
  });
});

describe("overall state", () => {
  it("prefers stalled over running and offline over waiting", () => {
    const active = run({ jobs: [job({ status: "queued" })] });
    expect(
      overallMonitorState(
        snapshot({ runs: [active] }),
        new Map([[active.id, "potentially_stalled"]]),
      ).state,
    ).toBe("Stalled");
    expect(
      overallMonitorState(
        snapshot({
          runs: [active],
          worker: { ...snapshot().worker, state: "stale" },
        }),
        new Map([[active.id, "waiting_worker"]]),
      ).state,
    ).toBe("Offline");
    expect(
      overallMonitorState(
        snapshot({ runs: [active] }),
        new Map([[active.id, "queued"]]),
      ),
    ).toMatchObject({ state: "Waiting", activeAgents: 1, activeJobs: 1 });
  });

  it("reports the latest settled run when nothing is active", () => {
    const failed = run({ status: "failed", createdAt: ago(1_000) });
    const completed = run({
      id: "run-0",
      status: "completed",
      createdAt: ago(9_000),
    });
    expect(
      overallMonitorState(snapshot({ runs: [completed, failed] }), new Map())
        .state,
    ).toBe("Failed");
    expect(overallMonitorState(snapshot(), new Map()).state).toBe("Idle");
    expect(overallMonitorState(null, new Map()).state).toBe("Unknown");
  });
});

describe("event presentation", () => {
  it("classifies event severity by stage", () => {
    expect(eventSeverity("review.failed")).toBe("failure");
    expect(eventSeverity("draft.model_request_failed")).toBe("failure");
    expect(eventSeverity("research.retry_scheduled")).toBe("warning");
    expect(eventSeverity("draft.question_completed")).toBe("success");
    expect(eventSeverity("draft.model_request_started")).toBe("info");
  });

  it("drops metadata keys and values that are not on the allow list", () => {
    expect(
      sanitizeEventMetadata({
        jobId: "job-1",
        latencyMs: 1200,
        errorName: "Error",
        prompt: "private prompt",
        qualityGates: { requirementCoverage: true },
        model: "x".repeat(500),
      }),
    ).toEqual({ jobId: "job-1", latencyMs: 1200 });
  });
});

describe("polling cadence", () => {
  it("polls faster while active and backs off after failures", () => {
    expect(
      nextPollDelay({
        active: true,
        drawerOpen: false,
        consecutiveFailures: 0,
      }),
    ).toBe(4_000);
    expect(
      nextPollDelay({
        active: false,
        drawerOpen: true,
        consecutiveFailures: 0,
      }),
    ).toBe(15_000);
    expect(
      nextPollDelay({
        active: false,
        drawerOpen: false,
        consecutiveFailures: 0,
      }),
    ).toBe(30_000);
    expect(
      nextPollDelay({ active: true, drawerOpen: true, consecutiveFailures: 2 }),
    ).toBe(16_000);
    expect(
      nextPollDelay({ active: true, drawerOpen: true, consecutiveFailures: 9 }),
    ).toBe(60_000);
  });
});
