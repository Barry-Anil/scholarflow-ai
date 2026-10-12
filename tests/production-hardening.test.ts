import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const nextConfig = readFileSync(resolve("next.config.ts"), "utf8");
const dockerfile = readFileSync(resolve("Dockerfile"), "utf8");
const ci = readFileSync(resolve(".github/workflows/ci.yml"), "utf8");

describe("production hardening", () => {
  it("uses standalone output and global browser security headers", () => {
    expect(nextConfig).toContain('output: "standalone"');
    expect(nextConfig).toContain("Content-Security-Policy");
    expect(nextConfig).toContain("X-Content-Type-Options");
    expect(nextConfig).toContain("Strict-Transport-Security");
  });

  it("runs the container as a non-root user with a liveness check", () => {
    expect(dockerfile).toContain("USER nextjs");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("/api/health/live");
  });

  it("runs all deterministic quality gates before building the container", () => {
    for (const command of [
      "npm run format:check",
      "npm run typecheck",
      "npm run lint",
      "npm test",
      "npm run build",
    ]) {
      expect(ci).toContain(command);
    }
    expect(ci).toContain("needs: quality");
  });
});
