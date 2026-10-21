import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(
  resolve("src/app/api/agent-jobs/[jobId]/route.ts"),
  "utf8",
);
const worker = readFileSync(resolve("scripts/agent-worker.ts"), "utf8");
const migration = readFileSync(
  resolve("drizzle/0007_mysterious_stature.sql"),
  "utf8",
);
const workflow = readFileSync(
  resolve("src/features/agents/persistent-workflow.ts"),
  "utf8",
);

describe("durable agent worker architecture", () => {
  it("keeps the user-facing job endpoint read-only", () => {
    expect(route).toContain("export async function GET");
    expect(route).not.toContain("export async function POST");
    expect(route).not.toContain("processClaimedAgentJob");
  });

  it("serializes workers and processes lease-owned jobs", () => {
    expect(worker).toContain("pg_try_advisory_lock");
    expect(worker).toContain("claimNextAgentJob");
    expect(worker).toContain("processClaimedAgentJob");
    expect(workflow).toContain("renewAgentJobLease");
    expect(workflow).toContain("eq(processingJobs.lockedBy, workerId)");
  });

  it("migrates leases and protected diagnostics additively", () => {
    expect(migration).toContain('ADD COLUMN "lease_expires_at"');
    expect(migration).toContain('ADD COLUMN "last_error_code"');
    expect(migration).toContain('CREATE TABLE "processing_job_diagnostics"');
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain(
      "REVOKE ALL ON TABLE public.processing_job_diagnostics FROM anon, authenticated",
    );
    expect(migration).toContain(
      "DROP POLICY IF EXISTS processing_jobs_course_write",
    );
    expect(migration).not.toMatch(/drop table|drop column/i);
  });

  it("retains terminal review failure and sibling cancellation", () => {
    expect(workflow).toContain('status: "cancelled"');
    expect(workflow).toContain('overallStatus: "failed"');
    expect(workflow).toContain("requiresAnotherCycle: true");
  });
});
