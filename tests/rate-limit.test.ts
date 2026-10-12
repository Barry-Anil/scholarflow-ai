import { describe, expect, it } from "vitest";

import {
  RATE_LIMIT_POLICIES,
  rateLimitActor,
  rateLimitWindow,
} from "@/lib/security/rate-limit";

describe("rate limiting", () => {
  it("normalizes and hashes actor identifiers without retaining the input", () => {
    const first = rateLimitActor("auth", " Student@Example.com ");
    const second = rateLimitActor("auth", "student@example.com");

    expect(first).toBe(second);
    expect(first).toMatch(/^auth:[a-f0-9]{64}$/);
    expect(first).not.toContain("student");
    expect(rateLimitActor("user", "student@example.com")).not.toBe(first);
  });

  it("uses deterministic fixed windows and a positive retry interval", () => {
    const window = rateLimitWindow(125_500, 60_000);

    expect(window.start.toISOString()).toBe("1970-01-01T00:02:00.000Z");
    expect(window.expiresAt.toISOString()).toBe("1970-01-01T00:03:00.000Z");
    expect(window.retryAfterSeconds).toBe(55);
  });

  it("keeps worker polling limits above interactive mutation limits", () => {
    expect(RATE_LIMIT_POLICIES["worker.agent"].limit).toBeGreaterThan(
      RATE_LIMIT_POLICIES["agent.enqueue"].limit,
    );
    expect(RATE_LIMIT_POLICIES["knowledge.upload"].windowMs).toBe(3_600_000);
  });
});
