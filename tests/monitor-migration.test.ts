import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("drizzle/0008_agent_worker_heartbeats.sql"),
  "utf8",
);
const worker = readFileSync(resolve("scripts/agent-worker.ts"), "utf8");

describe("agent monitoring migration", () => {
  it("adds the heartbeat table additively and keeps it server-only", () => {
    expect(migration).toContain('CREATE TABLE "agent_worker_heartbeats"');
    expect(migration).toContain(
      "ALTER TABLE public.agent_worker_heartbeats ENABLE ROW LEVEL SECURITY",
    );
    expect(migration).toContain(
      "REVOKE ALL ON TABLE public.agent_worker_heartbeats FROM anon, authenticated",
    );
    expect(migration).not.toMatch(/drop table|drop column|alter column/i);
  });

  it("records worker liveness on start, per heartbeat, and on stop", () => {
    expect(worker).toContain("recordWorkerHeartbeat(workerId, null)");
    expect(worker).toContain("recordWorkerHeartbeat(workerId, currentJobId)");
    expect(worker).toContain("markWorkerStopped(workerId)");
  });
});
