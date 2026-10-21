import { afterEach, describe, expect, it } from "vitest";

import { getAgentWorkerConfig } from "@/features/agents/agent-job-queue";
import {
  agentDiagnostic,
  agentPublicError,
  agentRetryDelayMs,
  isRetryableAgentError,
} from "@/features/agents/job-policy";
import { AppError } from "@/lib/errors";

const workerKeys = [
  "AGENT_JOB_LEASE_MS",
  "AGENT_WORKER_HEARTBEAT_MS",
  "AGENT_WORKER_POLL_MS",
] as const;

afterEach(() => {
  for (const key of workerKeys) delete process.env[key];
});

describe("agent job failure policy", () => {
  it("retries transient AI and infrastructure failures", () => {
    for (const code of [
      "AI_TIMEOUT",
      "AI_UNAVAILABLE",
      "AI_RESPONSE_INVALID",
      "DATABASE_UNAVAILABLE",
    ] as const) {
      expect(isRetryableAgentError(new AppError(code, "safe"))).toBe(true);
    }
    expect(isRetryableAgentError(new Error("socket reset"))).toBe(true);
  });

  it("does not retry invalid, unauthorized, or misconfigured work", () => {
    for (const code of [
      "FORBIDDEN",
      "INVALID_INPUT",
      "AI_AUTHORIZATION_FAILED",
      "CONFIGURATION_MISSING",
    ] as const) {
      expect(isRetryableAgentError(new AppError(code, "safe"))).toBe(false);
    }
  });

  it("uses the agreed retry backoff", () => {
    expect(agentRetryDelayMs(1)).toBe(15_000);
    expect(agentRetryDelayMs(2)).toBe(60_000);
    expect(agentRetryDelayMs(3)).toBe(60_000);
  });

  it("separates safe status from content-free diagnostics", () => {
    const error = new Error("private assignment text and secret token");
    expect(agentPublicError(error)).not.toContain("private assignment");
    expect(agentDiagnostic(error)).not.toContain("private assignment");
    expect(agentDiagnostic(error)).not.toContain("secret token");
  });
});

describe("agent worker configuration", () => {
  it("defaults to a two-minute lease and thirty-second heartbeat", () => {
    expect(getAgentWorkerConfig()).toEqual({
      leaseMs: 120_000,
      heartbeatMs: 30_000,
      pollMs: 2_000,
    });
  });

  it("rejects a heartbeat that cannot safely renew the lease", () => {
    process.env.AGENT_JOB_LEASE_MS = "120000";
    process.env.AGENT_WORKER_HEARTBEAT_MS = "60000";
    expect(() => getAgentWorkerConfig()).toThrow(/less than half/);
  });
});
