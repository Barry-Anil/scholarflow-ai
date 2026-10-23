import { randomUUID } from "node:crypto";
import { createClient, type User } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const supabaseUrl = process.env.TEST_SUPABASE_URL;
const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

if (!databaseUrl || !supabaseUrl || !serviceRoleKey) {
  throw new Error("Local Supabase integration environment is required.");
}

process.env.DATABASE_URL = databaseUrl;
process.env.OLLAMA_URL = "http://127.0.0.1:11434";

const sql = postgres(databaseUrl, { max: 2, prepare: false });
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const workerId = `monitor-integration-${randomUUID()}`;
let owner: User;
let outsider: User;
let courseId: string;
let assignmentId: string;
let questionId: string;
let researchRunId: string;
let researchJobId: string;
let generatedDraftId: string;
let manualDraftId: string;
let reportId: string;
let criterionId: string;

async function createUser(prefix: string) {
  const result = await admin.auth.admin.createUser({
    email: `${prefix}-${randomUUID()}@example.test`,
    password: `Test-${randomUUID()}-Aa1!`,
    email_confirm: true,
  });
  if (!result.data.user) throw result.error ?? new Error("User setup failed");
  return result.data.user;
}

async function tableCounts() {
  const [row] = await sql<
    { jobs: number; runs: number; events: number; drafts: number }[]
  >`
    select
      (select count(*)::int from public.processing_jobs where assignment_id = ${assignmentId}) as jobs,
      (select count(*)::int from public.agent_runs where assignment_id = ${assignmentId}) as runs,
      (select count(*)::int from public.agent_run_events where assignment_id = ${assignmentId}) as events,
      (select count(*)::int from public.assignment_drafts where assignment_id = ${assignmentId}) as drafts
  `;
  return row;
}

beforeAll(async () => {
  owner = await createUser("monitor-owner");
  outsider = await createUser("monitor-outsider");
  courseId = randomUUID();
  assignmentId = randomUUID();
  questionId = randomUUID();
  researchRunId = randomUUID();
  researchJobId = randomUUID();
  generatedDraftId = randomUUID();
  manualDraftId = randomUUID();
  reportId = randomUUID();
  criterionId = randomUUID();
  const draftRunId = randomUUID();
  const reviewRunId = randomUUID();
  await sql.begin(async (tx) => {
    await tx`insert into public.courses (id, owner_id, title) values (${courseId}, ${owner.id}, 'Monitor test')`;
    await tx`insert into public.assignments (id, course_id, owner_id, title, brief_markdown, external_research_allowed) values (${assignmentId}, ${courseId}, ${owner.id}, 'Monitor assignment', 'Brief', false)`;
    await tx`insert into public.assignment_questions (id, assignment_id, position, prompt, requirements) values (${questionId}, ${assignmentId}, 0, 'Explain tokenisation', '[]'::jsonb)`;
    await tx`insert into public.rubric_criteria (id, assignment_id, position, title, description, weight) values (${criterionId}, ${assignmentId}, 0, 'Accuracy', 'Correct claims', 50)`;
    // A real Agent C research job, claimed as the worker would claim it.
    await tx`insert into public.agent_runs (id, assignment_id, owner_id, agent, status, workflow_state, input_snapshot) values (${researchRunId}, ${assignmentId}, ${owner.id}, 'researcher', 'queued', 'RESEARCHING', '{}'::jsonb)`;
    await tx`insert into public.processing_jobs (id, owner_id, course_id, assignment_id, type, status, payload, attempts, locked_by, locked_at, lease_expires_at) values (${researchJobId}, ${owner.id}, ${courseId}, ${assignmentId}, 'agent.research.question', 'processing', ${tx.json({ runId: researchRunId, questionId })}, 1, ${workerId}, now(), now() + interval '2 minutes')`;
    // Provenance fixtures: one agent-generated version, then a manual save.
    await tx`insert into public.agent_runs (id, assignment_id, owner_id, agent, status, workflow_state, model, input_snapshot, completed_at, created_at) values (${draftRunId}, ${assignmentId}, ${owner.id}, 'student', 'completed', 'DRAFTING', 'qwen3:8b', '{}'::jsonb, now(), now() - interval '1 hour')`;
    await tx`insert into public.assignment_drafts (id, assignment_id, owner_id, version, markdown, word_count, created_by_agent, source_run_id) values (${generatedDraftId}, ${assignmentId}, ${owner.id}, 1, ${"# Draft\nAlpha\nBeta"}, 2, 'student', ${draftRunId})`;
    await tx`insert into public.assignment_drafts (id, assignment_id, owner_id, version, markdown, word_count) values (${manualDraftId}, ${assignmentId}, ${owner.id}, 2, ${"# Draft\nAlpha\nGamma"}, 2)`;
    // A review whose model output failed validation.
    await tx`insert into public.agent_runs (id, assignment_id, owner_id, agent, status, workflow_state, model, input_snapshot, error_code, error_message, completed_at, created_at) values (${reviewRunId}, ${assignmentId}, ${owner.id}, 'reviewer', 'failed', 'REVIEWING', 'qwen3:8b', '{}'::jsonb, 'AI_RESPONSE_INVALID', 'The AI response did not pass the required validation checks.', now(), now() - interval '30 minutes')`;
    await tx`insert into public.review_reports (id, assignment_id, draft_id, run_id, owner_id, overall_status, requires_another_cycle) values (${reportId}, ${assignmentId}, ${manualDraftId}, ${reviewRunId}, ${owner.id}, 'failed', true)`;
  });
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  await sql`delete from public.agent_worker_heartbeats where worker_id = ${workerId}`;
  if (courseId) await sql`delete from public.courses where id = ${courseId}`;
  if (owner) await admin.auth.admin.deleteUser(owner.id);
  if (outsider) await admin.auth.admin.deleteUser(outsider.id);
  await sql.end();
});

describe("agent monitoring", () => {
  it("persists stage events linked to the job while the worker processes it", async () => {
    const { processClaimedAgentJob } =
      await import("@/features/agents/persistent-workflow");
    await expect(
      processClaimedAgentJob(researchJobId, workerId, {
        leaseMs: 120_000,
        heartbeatMs: 30_000,
      }),
    ).resolves.toMatchObject({ status: "completed", completed: true });

    const events = await sql<
      { event_type: string; metadata: Record<string, unknown> }[]
    >`
      select event_type, metadata from public.agent_run_events
      where run_id = ${researchRunId}
      order by created_at, id
    `;
    expect(events.map((event) => event.event_type)).toEqual(
      expect.arrayContaining([
        "research.question_started",
        "research.retrieval_completed",
        "research.gap_found",
        "research.completed",
      ]),
    );
    const started = events.find(
      (event) => event.event_type === "research.question_started",
    );
    expect(started?.metadata).toMatchObject({
      jobId: researchJobId,
      questionId,
      attempt: 1,
      maxAttempts: 3,
    });
  });

  it("builds the monitor snapshot from persisted records without mutating them", async () => {
    const { getAssignmentMonitor } = await import("@/features/monitoring/data");
    const { analyzeSnapshot } =
      await import("@/features/monitoring/status-model");
    const before = await tableCounts();
    const snapshot = await getAssignmentMonitor(assignmentId, owner.id);
    await getAssignmentMonitor(assignmentId, owner.id);
    expect(await tableCounts()).toEqual(before);

    const research = snapshot.runs.find((run) => run.agent === "researcher");
    expect(research).toMatchObject({ id: researchRunId, status: "completed" });
    expect(research?.jobs).toHaveLength(1);
    expect(research?.events.map((event) => event.eventType)).toContain(
      "research.question_started",
    );
    expect(snapshot.runs.find((run) => run.agent === "reviewer")).toMatchObject(
      { status: "failed", errorCode: "AI_RESPONSE_INVALID" },
    );
    expect(snapshot.queue).toMatchObject({
      queued: 0,
      running: 0,
      completed: 1,
    });
    expect(["reachable", "unreachable"]).toContain(snapshot.ollama.state);
    expect(JSON.stringify(snapshot)).not.toContain(workerId);

    const analysis = analyzeSnapshot(snapshot, Date.now());
    expect(analysis.runs.get("researcher")?.progress.percent).toBe(100);
    expect(analysis.runs.get("reviewer")?.state).toBe("failed");
    expect(analysis.runs.get("reviewer")?.progress.percent).not.toBe(100);
  });

  it("denies monitoring and provenance to users without course access", async () => {
    const { getAssignmentMonitor, getAssignmentEvents } =
      await import("@/features/monitoring/data");
    const { getProvenanceIndex, getRubricTrace } =
      await import("@/features/monitoring/provenance");
    await expect(
      getAssignmentMonitor(assignmentId, outsider.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      getAssignmentEvents(assignmentId, outsider.id, { limit: 10 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      getProvenanceIndex(assignmentId, outsider.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      getRubricTrace(assignmentId, outsider.id, reportId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("filters and paginates the persisted event history", async () => {
    const { getAssignmentEvents } = await import("@/features/monitoring/data");
    const warnings = await getAssignmentEvents(assignmentId, owner.id, {
      severity: "warning",
      agent: "researcher",
      limit: 10,
    });
    expect(warnings.events.map((event) => event.eventType)).toEqual([
      "research.gap_found",
    ]);
    const firstPage = await getAssignmentEvents(assignmentId, owner.id, {
      limit: 1,
    });
    expect(firstPage.events).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = await getAssignmentEvents(assignmentId, owner.id, {
      limit: 1,
      cursor: firstPage.nextCursor!,
    });
    expect(secondPage.events[0]?.id).not.toBe(firstPage.events[0]?.id);
  });

  it("reports worker liveness from the persisted heartbeat", async () => {
    const { recordWorkerHeartbeat, markWorkerStopped } =
      await import("@/features/agents/worker-heartbeat");
    const { getAssignmentMonitor } = await import("@/features/monitoring/data");
    await recordWorkerHeartbeat(workerId, null);
    expect(
      (await getAssignmentMonitor(assignmentId, owner.id)).worker.state,
    ).toBe("online");
    await markWorkerStopped(workerId);
    expect(
      (await getAssignmentMonitor(assignmentId, owner.id)).worker.state,
    ).toBe("stopped");
  });

  it("attributes drafts only to linked runs and diffs against the parent version", async () => {
    const { getProvenanceIndex, getDraftProvenance } =
      await import("@/features/monitoring/provenance");
    const index = await getProvenanceIndex(assignmentId, owner.id);
    expect(index.drafts.map((draft) => [draft.version, draft.origin])).toEqual([
      [2, "student_edited"],
      [1, "ai_generated"],
    ]);
    const detail = await getDraftProvenance(
      assignmentId,
      owner.id,
      manualDraftId,
    );
    expect(detail.parent?.id).toBe(generatedDraftId);
    expect(detail.validation.failedModelRequests).toBeNull();
  });

  it("shows a review whose output failed validation as not evaluated successfully", async () => {
    const { getRubricTrace } = await import("@/features/monitoring/provenance");
    const trace = await getRubricTrace(assignmentId, owner.id, reportId);
    expect(trace.criteria).toEqual([
      expect.objectContaining({ id: criterionId, status: "validation_failed" }),
    ]);
    expect(trace.deterministicChecks).toBeNull();
    expect(trace.report.runErrorCode).toBe("AI_RESPONSE_INVALID");
  });
});

describe("stopping and retrying a run", () => {
  const runId = randomUUID();
  const savedJobId = randomUUID();
  const stuckJobId = randomUUID();
  const stopAssignmentId = randomUUID();
  const savedQuestionId = randomUUID();
  const stuckQuestionId = randomUUID();

  beforeAll(async () => {
    await sql.begin(async (tx) => {
      await tx`insert into public.assignments (id, course_id, owner_id, title, brief_markdown, external_research_allowed) values (${stopAssignmentId}, ${courseId}, ${owner.id}, 'Stop assignment', 'Brief', false)`;
      await tx`insert into public.assignment_questions (id, assignment_id, position, prompt, requirements) values (${savedQuestionId}, ${stopAssignmentId}, 0, 'Saved question', '[]'::jsonb), (${stuckQuestionId}, ${stopAssignmentId}, 1, 'Stuck question', '[]'::jsonb)`;
      await tx`insert into public.agent_runs (id, assignment_id, owner_id, agent, status, workflow_state, input_snapshot, started_at) values (${runId}, ${stopAssignmentId}, ${owner.id}, 'researcher', 'running', 'RESEARCHING', '{}'::jsonb, now())`;
      await tx`insert into public.processing_jobs (id, owner_id, course_id, assignment_id, type, status, payload, attempts, completed_at) values (${savedJobId}, ${owner.id}, ${courseId}, ${stopAssignmentId}, 'agent.research.question', 'completed', ${tx.json({ runId, questionId: savedQuestionId })}, 1, now())`;
      await tx`insert into public.agent_run_events (run_id, assignment_id, owner_id, event_type, message, metadata) values (${runId}, ${stopAssignmentId}, ${owner.id}, 'research.gap_found', 'Saved earlier.', ${tx.json({ questionId: savedQuestionId })})`;
      await tx`insert into public.processing_jobs (id, owner_id, course_id, assignment_id, type, status, payload, attempts, max_attempts, locked_by, locked_at, lease_expires_at) values (${stuckJobId}, ${owner.id}, ${courseId}, ${stopAssignmentId}, 'agent.research.question', 'processing', ${tx.json({ runId, questionId: stuckQuestionId })}, 3, 3, ${workerId}, now() - interval '2 hours', now() + interval '2 minutes')`;
    });
  });

  it("stops the run, keeps saved work, and locks out the stale worker", async () => {
    const { stopAgentRun } = await import("@/features/agents/run-control");
    const { processClaimedAgentJob } =
      await import("@/features/agents/persistent-workflow");
    await expect(
      stopAgentRun(stopAssignmentId, outsider.id, runId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      stopAgentRun(stopAssignmentId, owner.id, runId),
    ).resolves.toEqual({ cancelledTasks: 1 });
    await expect(
      stopAgentRun(stopAssignmentId, owner.id, runId),
    ).rejects.toMatchObject({ status: 409 });

    const jobs = await sql<
      { id: string; status: string; locked_by: string | null }[]
    >`
      select id, status, locked_by from public.processing_jobs where payload->>'runId' = ${runId}
    `;
    expect(jobs.find((job) => job.id === savedJobId)?.status).toBe("completed");
    expect(jobs.find((job) => job.id === stuckJobId)).toMatchObject({
      status: "cancelled",
      locked_by: null,
    });
    const [run] = await sql<
      { status: string }[]
    >`select status from public.agent_runs where id = ${runId}`;
    expect(run?.status).toBe("cancelled");
    await expect(
      processClaimedAgentJob(stuckJobId, workerId, {
        leaseMs: 120_000,
        heartbeatMs: 30_000,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("retries only the unfinished task and completes without duplicating saved work", async () => {
    const { retryAgentRun } = await import("@/features/agents/run-control");
    const { processClaimedAgentJob } =
      await import("@/features/agents/persistent-workflow");
    await expect(
      retryAgentRun(stopAssignmentId, owner.id, runId),
    ).resolves.toEqual({ requeuedTasks: 1 });
    const [requeued] = await sql<{ status: string; attempts: number }[]>`
      select status, attempts from public.processing_jobs where id = ${stuckJobId}
    `;
    expect(requeued).toEqual({ status: "queued", attempts: 0 });

    await sql`update public.processing_jobs set status = 'processing', attempts = 1, locked_by = ${workerId}, locked_at = now(), lease_expires_at = now() + interval '2 minutes' where id = ${stuckJobId}`;
    await expect(
      processClaimedAgentJob(stuckJobId, workerId, {
        leaseMs: 120_000,
        heartbeatMs: 30_000,
      }),
    ).resolves.toMatchObject({ status: "completed", completed: true });

    const [run] = await sql<
      { status: string }[]
    >`select status from public.agent_runs where id = ${runId}`;
    expect(run?.status).toBe("completed");
    const perQuestion = await sql<{ question_id: string; count: number }[]>`
      select metadata->>'questionId' as question_id, count(*)::int as count
      from public.agent_run_events
      where run_id = ${runId} and event_type in ('research.gap_found', 'research.question_completed')
      group by 1
    `;
    expect(perQuestion.map((row) => row.count)).toEqual([1, 1]);
    await expect(
      retryAgentRun(stopAssignmentId, owner.id, runId),
    ).rejects.toMatchObject({ status: 409 });
  });
});
