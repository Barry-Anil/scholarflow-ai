// Pure monitoring model shared by the status API and the drawer. Every state
// here is derived from persisted job, run, event, and heartbeat records; no
// value advances on a timer alone.

export type MonitorAgentKey = "researcher" | "student" | "reviewer";
export type JobKind = "research" | "draft" | "review" | "revision";
export type EventSeverity = "info" | "success" | "warning" | "failure";

export type MonitorJob = {
  id: string;
  kind: JobKind;
  questionId: string | null;
  questionNumber: number | null;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  /** Saved as completed while the worker still holds the lease to finalize. */
  finalizing: boolean;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  lockedAt: string | null;
  leaseExpiresAt: string | null;
  completedAt: string | null;
  lastErrorCode: string | null;
  lastError: string | null;
};

export type MonitorEvent = {
  id: string;
  runId: string;
  agent: MonitorAgentKey | "system";
  eventType: string;
  message: string;
  severity: EventSeverity;
  createdAt: string;
  metadata: Record<string, string | number | boolean | null>;
};

export type MonitorRun = {
  id: string;
  agent: MonitorAgentKey;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  workflowState: string;
  provider: string | null;
  model: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  /** Failed or stopped, and still the assignment's latest run. */
  retryable: boolean;
  jobs: MonitorJob[];
  /** Newest first. */
  events: MonitorEvent[];
};

export type WorkerState = "online" | "stale" | "stopped" | "unknown";

export type MonitorSnapshot = {
  generatedAt: string;
  assignmentId: string;
  canEdit: boolean;
  config: {
    models: {
      writer: string;
      researcher: string;
      reviewer: string;
      embedding: string;
    };
    requestTimeoutMs: number;
    modelGraceMs: number;
    workerStaleMs: number;
    leaseMs: number;
    heartbeatMs: number;
  };
  ollama: {
    state: "reachable" | "unreachable" | "unknown";
    checkedAt: string | null;
    lastSuccessAt: string | null;
    latencyMs: number | null;
    errorCode: string | null;
    models: Array<{
      role: "writer" | "researcher" | "reviewer" | "embedding";
      name: string;
      installed: boolean | null;
    }>;
  };
  generation: {
    lastSuccess: {
      at: string;
      agent: string;
      model: string;
      latencyMs: number | null;
    } | null;
    lastFailure: {
      at: string;
      errorCode: string;
      message: string;
      model: string | null;
    } | null;
    inFlight: { startedAt: string; model: string | null } | null;
  };
  embeddings: {
    modelInstalled: boolean | null;
    chunkCount: number;
    embeddedChunkCount: number;
  };
  worker: {
    state: WorkerState;
    startedAt: string | null;
    lastHeartbeatAt: string | null;
    stoppedAt: string | null;
    busy: boolean;
  };
  queue: {
    queued: number;
    running: number;
    retrying: number;
    completed: number;
    failed: number;
    cancelled: number;
    aheadOfAssignment: number;
  };
  runs: MonitorRun[];
};

export const agentProfiles: Record<
  MonitorAgentKey,
  { label: string; role: string; responsibility: string }
> = {
  researcher: {
    label: "Agent C",
    role: "Research",
    responsibility: "Retrieves traceable evidence from course materials.",
  },
  student: {
    label: "Agent B",
    role: "Drafting",
    responsibility: "Writes and revises evidence-backed draft versions.",
  },
  reviewer: {
    label: "Agent A",
    role: "Review",
    responsibility: "Independently reviews drafts against the rubric.",
  },
};

export const monitorAgentOrder: MonitorAgentKey[] = [
  "researcher",
  "student",
  "reviewer",
];

const severitySuffixes: Record<Exclude<EventSeverity, "info">, string[]> = {
  failure: ["failed", "model_request_failed"],
  warning: [
    "retry_scheduled",
    "gap_found",
    "external_unavailable",
    "cancelled",
  ],
  success: [
    "completed",
    "question_completed",
    "question_recovered",
    "question_copied",
    "model_response_received",
    "retrieval_completed",
    "external_completed",
  ],
};

export function eventStage(eventType: string) {
  const dot = eventType.indexOf(".");
  return dot === -1 ? eventType : eventType.slice(dot + 1);
}

export function eventSeverity(eventType: string): EventSeverity {
  const stage = eventStage(eventType);
  for (const severity of ["failure", "warning", "success"] as const) {
    if (severitySuffixes[severity].includes(stage)) return severity;
  }
  return "info";
}

/** Event stages per severity, for server-side filtering. */
export function stagesForSeverity(severity: Exclude<EventSeverity, "info">) {
  return severitySuffixes[severity];
}

export function knownNonInfoStages() {
  return Object.values(severitySuffixes).flat();
}

export function deriveWorkerState(
  worker: { lastHeartbeatAt: string | null; stoppedAt: string | null },
  now: number,
  staleMs: number,
): WorkerState {
  if (!worker.lastHeartbeatAt) return "unknown";
  if (worker.stoppedAt) return "stopped";
  return now - Date.parse(worker.lastHeartbeatAt) > staleMs
    ? "stale"
    : "online";
}

export type JobState =
  | "queued"
  | "waiting_worker"
  | "retry_scheduled"
  | "running"
  | "finalizing"
  | "potentially_stalled"
  | "completed"
  | "failed"
  | "cancelled";

export type JobStateContext = {
  now: number;
  workerState: WorkerState;
  modelTimeoutMs: number;
  modelGraceMs: number;
  /** Start of a model request for this job with no recorded outcome yet. */
  openModelRequestStartedAt: string | null;
};

export function deriveJobState(
  job: MonitorJob,
  context: JobStateContext,
): { state: JobState; reason: string } {
  if (job.status === "cancelled") {
    return {
      state: "cancelled",
      reason: job.lastError ?? "Cancelled before it ran.",
    };
  }
  if (job.status === "failed") {
    return {
      state: "failed",
      reason: job.lastError ?? "The task failed.",
    };
  }
  const leaseExpired =
    job.leaseExpiresAt !== null &&
    Date.parse(job.leaseExpiresAt) <= context.now;
  if (job.status === "completed") {
    if (!job.finalizing) return { state: "completed", reason: "Saved." };
    return leaseExpired
      ? {
          state: "potentially_stalled",
          reason:
            "The output was saved, but the worker lease expired before the run was finalized. Another worker pass will recover it.",
        }
      : { state: "finalizing", reason: "Finalizing the run." };
  }
  if (job.status === "processing") {
    if (leaseExpired) {
      return {
        state: "potentially_stalled",
        reason:
          "The worker lease expired without a renewal; the worker may have stopped. The task will be reclaimed.",
      };
    }
    if (
      context.openModelRequestStartedAt &&
      context.now - Date.parse(context.openModelRequestStartedAt) >
        context.modelTimeoutMs + context.modelGraceMs
    ) {
      return {
        state: "potentially_stalled",
        reason:
          "The model request has run longer than the configured timeout without a recorded outcome.",
      };
    }
    if (context.workerState === "stale" || context.workerState === "stopped") {
      return {
        state: "potentially_stalled",
        reason: "The worker heartbeat is stale while this task is running.",
      };
    }
    // Each attempt makes at most one bounded external request, so an attempt
    // held this long is stuck even when the worker records no stage events.
    if (
      !context.openModelRequestStartedAt &&
      job.lockedAt &&
      context.now - Date.parse(job.lockedAt) >
        context.modelTimeoutMs + context.modelGraceMs
    ) {
      return {
        state: "potentially_stalled",
        reason:
          "This attempt has run longer than one model request is allowed to take. You can stop the run and retry it.",
      };
    }
    return { state: "running", reason: "The worker is processing this task." };
  }
  if (Date.parse(job.availableAt) > context.now && job.attempts > 0) {
    return {
      state: "retry_scheduled",
      reason: `Attempt ${job.attempts} of ${job.maxAttempts} failed${job.lastErrorCode ? ` (${job.lastErrorCode})` : ""}; a retry is scheduled.`,
    };
  }
  if (context.workerState === "stale" || context.workerState === "stopped") {
    return {
      state: "waiting_worker",
      reason: "Waiting for the background worker, which is not reporting.",
    };
  }
  return { state: "queued", reason: "Waiting for the worker to claim it." };
}

/** Returns the start time of the job's latest model request without outcome. */
export function openModelRequestFor(
  events: MonitorEvent[],
  jobId: string,
): string | null {
  for (const event of events) {
    if (event.metadata.jobId !== jobId) continue;
    const stage = eventStage(event.eventType);
    if (stage === "model_request_started") return event.createdAt;
    if (
      stage === "model_response_received" ||
      stage === "model_request_failed" ||
      stage === "question_completed" ||
      stage === "retry_scheduled" ||
      stage === "question_started"
    ) {
      return null;
    }
  }
  return null;
}

export type RunProgress = {
  completedMilestones: number;
  totalMilestones: number;
  /** null when the run has no jobs to measure. */
  percent: number | null;
};

/**
 * Milestones are each per-question job plus the run's own finalization (the
 * persisted draft version, review report, or research summary). A run reaches
 * 100% only once that final output is persisted.
 */
export function runProgress(run: MonitorRun): RunProgress {
  const total = run.jobs.length;
  if (!total) {
    return {
      completedMilestones: run.status === "completed" ? 1 : 0,
      totalMilestones: 1,
      percent: run.status === "completed" ? 100 : null,
    };
  }
  const saved = run.jobs.filter((job) => job.status === "completed").length;
  const finalized = run.status === "completed" ? 1 : 0;
  const completedMilestones = saved + finalized;
  const totalMilestones = total + 1;
  return {
    completedMilestones,
    totalMilestones,
    percent: Math.floor((completedMilestones / totalMilestones) * 100),
  };
}

export type RunState =
  | "queued"
  | "waiting_worker"
  | "retry_scheduled"
  | "running"
  | "finalizing"
  | "potentially_stalled"
  | "completed"
  | "failed"
  | "cancelled";

export function deriveRunState(
  run: MonitorRun,
  jobStates: JobState[],
): RunState {
  if (run.status === "completed") return "completed";
  if (run.status === "failed") return "failed";
  if (run.status === "cancelled") return "cancelled";
  if (jobStates.includes("potentially_stalled")) return "potentially_stalled";
  if (jobStates.includes("running")) return "running";
  if (jobStates.includes("finalizing")) return "finalizing";
  if (jobStates.includes("retry_scheduled")) return "retry_scheduled";
  if (jobStates.includes("waiting_worker")) return "waiting_worker";
  if (
    jobStates.length > 0 &&
    jobStates.every((state) => state === "completed")
  ) {
    return "finalizing";
  }
  return "queued";
}

export function isActiveRun(run: Pick<MonitorRun, "status">) {
  return run.status === "queued" || run.status === "running";
}

const stageLabels: Record<JobKind, Record<string, string>> = {
  research: {
    question_started: "Searching indexed course materials",
    retrieval_completed: "Processing retrieved evidence",
    external_completed: "Saving evidence",
    question_completed: "Evidence saved",
    gap_found: "No traceable evidence found",
  },
  draft: {
    question_started: "Preparing evidence and prompt",
    model_request_started: "Waiting for the model to generate the answer",
    model_response_received: "Checking citations and saving the answer",
    model_request_failed: "Model request failed",
    question_completed: "Answer saved",
    question_recovered: "Saved answer recovered",
  },
  revision: {
    question_started: "Preparing accepted findings and evidence",
    model_request_started: "Waiting for the model to revise the answer",
    model_response_received: "Checking citations and saving the revision",
    model_request_failed: "Model request failed",
    question_completed: "Revision saved",
    question_copied: "Answer preserved (no accepted findings)",
  },
  review: {
    question_started: "Preparing brief, rubric, draft, and evidence",
    model_request_started: "Waiting for the model to evaluate the rubric",
    model_response_received: "Validating findings and saving the review",
    model_request_failed: "Model request failed",
    question_completed: "Review saved",
  },
};

const finalizationLabels: Record<MonitorAgentKey, string> = {
  researcher: "Finalizing the research run",
  student: "Persisting the immutable draft version",
  reviewer: "Persisting the review report",
};

export function finalizationLabel(agent: MonitorAgentKey) {
  return finalizationLabels[agent];
}

/** The stage of one job, from its newest recorded event. */
export function jobStageLabel(
  job: MonitorJob,
  state: JobState,
  events: MonitorEvent[],
) {
  if (state === "queued") return "Queued";
  if (state === "waiting_worker") return "Waiting for the worker";
  if (state === "retry_scheduled") return "Retry scheduled";
  if (state === "completed") return "Saved";
  if (state === "failed") return "Failed";
  if (state === "cancelled") return "Cancelled";
  if (state === "finalizing") return "Finalizing";
  const latest = events.find((event) => event.metadata.jobId === job.id);
  if (!latest) return "Claimed by the worker (no stage reported yet)";
  const stage = eventStage(latest.eventType);
  if (stage === "retry_scheduled") return "Retrying";
  return stageLabels[job.kind][stage] ?? "Processing";
}

export function questionTitle(job: Pick<MonitorJob, "questionNumber">) {
  return job.questionNumber ? `Question ${job.questionNumber}` : "Question";
}

export type RunStep = {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail: string[];
  durationMs?: number;
};

/** Steps for the loading component: one per question, then finalization. */
export function buildRunSteps(
  run: MonitorRun,
  jobStates: Map<string, JobState>,
): RunStep[] {
  const jobs = [...run.jobs].sort(
    (left, right) => (left.questionNumber ?? 0) - (right.questionNumber ?? 0),
  );
  const steps: RunStep[] = jobs.map((job) => {
    const state = jobStates.get(job.id) ?? "queued";
    const jobEvents = run.events
      .filter((event) => event.metadata.jobId === job.id)
      .reverse();
    const stage = jobStageLabel(job, state, run.events);
    return {
      id: job.id,
      label: `${questionTitle(job)} · ${stage}${state === "potentially_stalled" ? " (potentially stalled)" : ""}`,
      // Only a job with live evidence of work animates; a stalled one does not.
      status:
        state === "completed" || state === "finalizing"
          ? "done"
          : state === "failed" || state === "cancelled"
            ? "error"
            : state === "running"
              ? "running"
              : "pending",
      detail: jobEvents.map((event) => event.message),
      durationMs: measuredJobDuration(jobEvents),
    };
  });
  const allSaved =
    jobs.length > 0 && jobs.every((job) => job.status === "completed");
  steps.push({
    id: `${run.id}:finalize`,
    label: finalizationLabel(run.agent),
    status:
      run.status === "completed"
        ? "done"
        : run.status === "failed" || run.status === "cancelled"
          ? "error"
          : allSaved
            ? "running"
            : "pending",
    detail: [],
  });
  return steps;
}

/** Duration between the last recorded start and completion of a job. */
function measuredJobDuration(eventsOldestFirst: MonitorEvent[]) {
  let startedAt: number | null = null;
  let duration: number | undefined;
  for (const event of eventsOldestFirst) {
    const stage = eventStage(event.eventType);
    if (stage === "question_started") startedAt = Date.parse(event.createdAt);
    if (stage === "question_completed" && startedAt !== null) {
      duration = Date.parse(event.createdAt) - startedAt;
    }
  }
  return duration;
}

export type OverallState =
  | "Running"
  | "Waiting"
  | "Stalled"
  | "Failed"
  | "Completed"
  | "Offline"
  | "Idle"
  | "Unknown";

export function overallMonitorState(
  snapshot: MonitorSnapshot | null,
  runStates: Map<string, RunState>,
): { state: OverallState; activeAgents: number; activeJobs: number } {
  if (!snapshot) return { state: "Unknown", activeAgents: 0, activeJobs: 0 };
  const active = snapshot.runs.filter(isActiveRun);
  const activeJobs = active
    .flatMap((run) => run.jobs)
    .filter(
      (job) => job.status === "queued" || job.status === "processing",
    ).length;
  const states = active.map((run) => runStates.get(run.id));
  const workerDown =
    snapshot.worker.state === "stale" ||
    snapshot.worker.state === "stopped" ||
    snapshot.worker.state === "unknown";
  let state: OverallState;
  if (active.length) {
    if (states.includes("potentially_stalled")) state = "Stalled";
    else if (states.includes("running") || states.includes("finalizing"))
      state = "Running";
    else if (workerDown) state = "Offline";
    else state = "Waiting";
  } else {
    const latest = [...snapshot.runs].sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
    )[0];
    if (latest?.status === "failed") state = "Failed";
    else if (snapshot.ollama.state === "unreachable") state = "Offline";
    else if (latest?.status === "completed") state = "Completed";
    else state = "Idle";
  }
  return { state, activeAgents: active.length, activeJobs };
}

export type RunAnalysis = {
  run: MonitorRun;
  state: RunState;
  jobStates: Map<string, { state: JobState; reason: string }>;
  progress: RunProgress;
  steps: RunStep[];
  currentJob: MonitorJob | null;
  currentStage: string;
  currentReason: string | null;
  /** Start of the current job's latest attempt, from its recorded event. */
  currentJobStartedAt: string | null;
  lastActivityAt: string;
};

export function analyzeRun(
  run: MonitorRun,
  snapshot: Pick<MonitorSnapshot, "worker" | "config">,
  now: number,
): RunAnalysis {
  const jobStates = new Map(
    run.jobs.map((job) => [
      job.id,
      deriveJobState(job, {
        now,
        workerState: snapshot.worker.state,
        modelTimeoutMs: snapshot.config.requestTimeoutMs,
        modelGraceMs: snapshot.config.modelGraceMs,
        openModelRequestStartedAt:
          job.status === "processing"
            ? openModelRequestFor(run.events, job.id)
            : null,
      }),
    ]),
  );
  const states = [...jobStates.values()].map((item) => item.state);
  const state = deriveRunState(run, states);
  const currentJob = isActiveRun(run)
    ? (run.jobs.find((job) => job.status === "processing") ??
      run.jobs.find((job) => job.finalizing) ??
      run.jobs.find((job) => job.status === "queued") ??
      null)
    : null;
  const allSaved =
    run.jobs.length > 0 && run.jobs.every((job) => job.status === "completed");
  const currentJobState = currentJob ? jobStates.get(currentJob.id) : null;
  let currentStage: string;
  if (!isActiveRun(run)) {
    currentStage =
      run.status === "completed"
        ? "Completed"
        : run.status === "failed"
          ? "Failed"
          : "Cancelled";
  } else if (allSaved && !currentJob?.finalizing) {
    currentStage = finalizationLabel(run.agent);
  } else if (currentJob && currentJobState) {
    currentStage = `${questionTitle(currentJob)} · ${jobStageLabel(currentJob, currentJobState.state, run.events)}`;
  } else {
    currentStage = "Queued";
  }
  const startedEvent = currentJob
    ? run.events.find(
        (event) =>
          event.metadata.jobId === currentJob.id &&
          eventStage(event.eventType) === "question_started",
      )
    : null;
  return {
    run,
    state,
    jobStates,
    progress: runProgress(run),
    steps: buildRunSteps(
      run,
      new Map([...jobStates].map(([id, item]) => [id, item.state])),
    ),
    currentJob,
    currentStage,
    currentReason: currentJobState?.reason ?? null,
    currentJobStartedAt:
      currentJob?.status === "processing"
        ? (startedEvent?.createdAt ?? null)
        : null,
    lastActivityAt:
      run.events[0]?.createdAt ??
      run.completedAt ??
      run.startedAt ??
      run.createdAt,
  };
}

export function analyzeSnapshot(snapshot: MonitorSnapshot, now: number) {
  const runs = new Map<MonitorAgentKey, RunAnalysis>();
  for (const run of snapshot.runs) {
    runs.set(run.agent, analyzeRun(run, snapshot, now));
  }
  const runStates = new Map(
    [...runs.values()].map((analysis) => [analysis.run.id, analysis.state]),
  );
  return { runs, overall: overallMonitorState(snapshot, runStates) };
}

const runStateLabels: Record<RunState, string> = {
  queued: "Queued",
  waiting_worker: "Waiting for worker",
  retry_scheduled: "Retry scheduled",
  running: "Running",
  finalizing: "Finalizing",
  potentially_stalled: "Potentially stalled",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function runStateLabel(state: RunState) {
  return runStateLabels[state];
}

/** Newest failure time across the latest runs, for the unseen-failure dot. */
export function latestFailureAt(snapshot: MonitorSnapshot) {
  const times = snapshot.runs.flatMap((run) => [
    ...(run.status === "failed" && run.completedAt ? [run.completedAt] : []),
    ...run.events
      .filter((event) => event.severity === "failure")
      .map((event) => event.createdAt),
  ]);
  return times.sort().at(-1) ?? null;
}

/** Allows only scalar, non-sensitive metadata keys through to the browser. */
const metadataAllowList = new Set([
  "questionId",
  "jobId",
  "attempt",
  "maxAttempts",
  "model",
  "timeoutMs",
  "latencyMs",
  "inputTokens",
  "outputTokens",
  "sourceCount",
  "localCount",
  "externalCount",
  "confidenceScore",
  "version",
  "errorCode",
  "retryInMs",
  "recovered",
  "citationCount",
  "verifiedCitationCount",
  "draftId",
  "reportId",
  "requiredFindings",
  "passed",
  "retrieval",
  "questionsReviewed",
  "expectedQuestions",
]);

export function sanitizeEventMetadata(metadata: Record<string, unknown>) {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!metadataAllowList.has(key)) continue;
    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      (typeof value === "string" && value.length <= 200)
    ) {
      safe[key] = value;
    }
  }
  return safe;
}
