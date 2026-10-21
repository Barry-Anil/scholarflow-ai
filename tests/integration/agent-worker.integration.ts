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

let owner: User;
let outsider: User;
let courseId: string;
let assignmentId: string;
let questionId: string;
let runId: string;
let jobId: string;
let legacyCompletedJobId: string;

beforeAll(async () => {
  const ownerResult = await admin.auth.admin.createUser({
    email: `worker-owner-${randomUUID()}@example.test`,
    password: `Test-${randomUUID()}-Aa1!`,
    email_confirm: true,
  });
  const outsiderResult = await admin.auth.admin.createUser({
    email: `worker-outsider-${randomUUID()}@example.test`,
    password: `Test-${randomUUID()}-Aa1!`,
    email_confirm: true,
  });
  if (!ownerResult.data.user || !outsiderResult.data.user) {
    throw (
      ownerResult.error ??
      outsiderResult.error ??
      new Error("User setup failed")
    );
  }
  owner = ownerResult.data.user;
  outsider = outsiderResult.data.user;
  courseId = randomUUID();
  assignmentId = randomUUID();
  questionId = randomUUID();
  runId = randomUUID();
  jobId = randomUUID();
  legacyCompletedJobId = randomUUID();
  await sql.begin(async (tx) => {
    await tx`insert into public.courses (id, owner_id, title) values (${courseId}, ${owner.id}, 'Worker test')`;
    await tx`insert into public.assignments (id, course_id, owner_id, title, brief_markdown, external_research_allowed) values (${assignmentId}, ${courseId}, ${owner.id}, 'Worker assignment', 'Brief', false)`;
    await tx`insert into public.assignment_questions (id, assignment_id, position, prompt, requirements) values (${questionId}, ${assignmentId}, 0, 'Test question', '[]'::jsonb)`;
    await tx`insert into public.agent_runs (id, assignment_id, owner_id, agent, status, workflow_state, input_snapshot) values (${runId}, ${assignmentId}, ${owner.id}, 'researcher', 'queued', 'RESEARCHING', '{}'::jsonb)`;
    await tx`insert into public.processing_jobs (id, owner_id, course_id, assignment_id, type, status, payload) values (${jobId}, ${owner.id}, ${courseId}, ${assignmentId}, 'agent.research.question', 'queued', ${tx.json({ runId, questionId })})`;
    await tx`insert into public.processing_jobs (id, owner_id, course_id, assignment_id, type, status, payload, attempts, completed_at) values (${legacyCompletedJobId}, ${owner.id}, ${courseId}, ${assignmentId}, 'agent.research.question', 'completed', ${tx.json({ runId, questionId })}, 1, now())`;
  });
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  if (courseId) await sql`delete from public.courses where id = ${courseId}`;
  if (owner) await admin.auth.admin.deleteUser(owner.id);
  if (outsider) await admin.auth.admin.deleteUser(outsider.id);
  await sql.end();
});

describe("durable agent queue", () => {
  it("creates an owned job and hides it from another tenant", async () => {
    const { getOwnedAgentJobStatus } =
      await import("@/features/agents/agent-job-queue");
    await expect(
      getOwnedAgentJobStatus(jobId, owner.id),
    ).resolves.toMatchObject({
      id: jobId,
      status: "queued",
      attempts: 0,
    });
    await expect(
      getOwnedAgentJobStatus(jobId, outsider.id),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("deduplicates concurrent start requests for one assignment", async () => {
    const duplicateAssignmentId = randomUUID();
    const duplicateQuestionId = randomUUID();
    await sql.begin(async (tx) => {
      await tx`insert into public.assignments (id, course_id, owner_id, title, brief_markdown, external_research_allowed) values (${duplicateAssignmentId}, ${courseId}, ${owner.id}, 'Duplicate request assignment', 'Brief', false)`;
      await tx`insert into public.assignment_questions (id, assignment_id, position, prompt, requirements) values (${duplicateQuestionId}, ${duplicateAssignmentId}, 0, 'Test duplicate request', '[]'::jsonb)`;
    });
    const { enqueueResearchAgent } =
      await import("@/features/agents/persistent-workflow");
    const starts = await Promise.allSettled([
      enqueueResearchAgent(duplicateAssignmentId, owner.id),
      enqueueResearchAgent(duplicateAssignmentId, owner.id),
    ]);
    expect(
      starts.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      starts.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const counts = await sql<{ runs: number; jobs: number }[]>`
      select
        (select count(*)::int from public.agent_runs where assignment_id = ${duplicateAssignmentId}) as runs,
        (select count(*)::int from public.processing_jobs where assignment_id = ${duplicateAssignmentId}) as jobs
    `;
    expect(counts[0]).toEqual({ runs: 1, jobs: 1 });
    await sql`delete from public.assignments where id = ${duplicateAssignmentId}`;
  });

  it("leases once, prevents duplicate processing, and reclaims an expired lease", async () => {
    const { claimNextAgentJob } =
      await import("@/features/agents/agent-job-queue");
    const claims = await Promise.all([
      claimNextAgentJob("integration-worker-a", 120_000),
      claimNextAgentJob("integration-worker-b", 120_000),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)).toMatchObject({ jobId, exhausted: false });
    const first = await sql<{ attempts: number }[]>`
      select attempts from public.processing_jobs where id = ${jobId}
    `;
    expect(first[0]?.attempts).toBe(1);
    const legacy = await sql<{ status: string; locked_by: string | null }[]>`
      select status, locked_by from public.processing_jobs where id = ${legacyCompletedJobId}
    `;
    expect(legacy[0]).toEqual({ status: "completed", locked_by: null });

    await sql`
      update public.processing_jobs
      set lease_expires_at = now() - interval '1 second'
      where id = ${jobId}
    `;
    const reclaimed = await claimNextAgentJob(
      "integration-worker-recovery",
      120_000,
    );
    expect(reclaimed).toMatchObject({ jobId, exhausted: false });
    const second = await sql<{ attempts: number }[]>`
      select attempts from public.processing_jobs where id = ${jobId}
    `;
    expect(second[0]?.attempts).toBe(2);
  });

  it("persists an idempotent research result and completes its run", async () => {
    const { processClaimedAgentJob } =
      await import("@/features/agents/persistent-workflow");
    await expect(
      processClaimedAgentJob(jobId, "integration-worker-recovery", {
        leaseMs: 120_000,
        heartbeatMs: 30_000,
      }),
    ).resolves.toMatchObject({ status: "completed", completed: true });

    const [job, run, events] = await Promise.all([
      sql<
        { status: string }[]
      >`select status from public.processing_jobs where id = ${jobId}`,
      sql<
        { status: string }[]
      >`select status from public.agent_runs where id = ${runId}`,
      sql<
        { count: number }[]
      >`select count(*)::int as count from public.agent_run_events where run_id = ${runId} and event_type in ('research.gap_found', 'research.question_completed')`,
    ]);
    expect(job[0]?.status).toBe("completed");
    expect(run[0]?.status).toBe("completed");
    expect(events[0]?.count).toBe(1);
  });

  it("recovers a crash after run finalization without failing or duplicating it", async () => {
    await sql`
      delete from public.agent_run_events
      where run_id = ${runId} and event_type = 'research.completed'
    `;
    await sql`
      update public.processing_jobs
      set locked_by = 'crashed-worker',
          locked_at = now() - interval '3 minutes',
          lease_expires_at = now() - interval '1 minute'
      where id = ${jobId} and status = 'completed'
    `;
    const { claimNextAgentJob } =
      await import("@/features/agents/agent-job-queue");
    const { processClaimedAgentJob } =
      await import("@/features/agents/persistent-workflow");
    const recovered = await claimNextAgentJob(
      "integration-worker-finalization",
      120_000,
    );
    expect(recovered).toMatchObject({ jobId, exhausted: false });
    await expect(
      processClaimedAgentJob(jobId, "integration-worker-finalization", {
        leaseMs: 120_000,
        heartbeatMs: 30_000,
      }),
    ).resolves.toMatchObject({ status: "completed", completed: true });

    const [jobs, runs, completionEvents] = await Promise.all([
      sql<{ status: string; attempts: number; locked_by: string | null }[]>`
        select status, attempts, locked_by from public.processing_jobs where id = ${jobId}
      `,
      sql<{ status: string }[]>`
        select status from public.agent_runs where id = ${runId}
      `,
      sql<{ count: number }[]>`
        select count(*)::int as count
        from public.agent_run_events
        where run_id = ${runId} and event_type = 'research.completed'
      `,
    ]);
    expect(jobs[0]).toEqual({
      status: "completed",
      attempts: 2,
      locked_by: null,
    });
    expect(runs[0]?.status).toBe("completed");
    expect(completionEvents[0]?.count).toBe(1);
  });

  it("persists an invalid job as failed without leaking its payload", async () => {
    const invalidJobId = randomUUID();
    await sql`
      insert into public.processing_jobs
        (id, owner_id, course_id, assignment_id, type, status, payload)
      values
        (${invalidJobId}, ${owner.id}, ${courseId}, ${assignmentId}, 'agent.research.question', 'queued', '{"runId":"private assignment content"}'::jsonb)
    `;
    const { claimNextAgentJob } =
      await import("@/features/agents/agent-job-queue");
    const { processClaimedAgentJob } =
      await import("@/features/agents/persistent-workflow");
    await claimNextAgentJob("integration-worker-invalid", 120_000);
    await expect(
      processClaimedAgentJob(invalidJobId, "integration-worker-invalid", {
        leaseMs: 120_000,
        heartbeatMs: 30_000,
      }),
    ).resolves.toMatchObject({ status: "failed" });
    const rows = await sql<{ status: string; detail: string }[]>`
      select pj.status, pjd.detail
      from public.processing_jobs pj
      join public.processing_job_diagnostics pjd on pjd.job_id = pj.id
      where pj.id = ${invalidJobId}
    `;
    expect(rows[0]?.status).toBe("failed");
    expect(rows[0]?.detail).not.toContain("private assignment content");
  });
});
