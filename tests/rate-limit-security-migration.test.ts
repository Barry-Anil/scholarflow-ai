import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("drizzle/0004_dashing_baron_strucker.sql"),
  "utf8",
);

describe("rate-limit security migration", () => {
  it("creates an indexed atomic-counter table", () => {
    expect(migration).toContain('CREATE TABLE "rate_limit_counters"');
    expect(migration).toContain("rate_limit_counters_pk");
    expect(migration).toContain("rate_limit_counters_expiry_idx");
  });

  it("denies direct client access", () => {
    expect(migration).toContain(
      "ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY",
    );
    expect(migration).toContain(
      "REVOKE ALL ON TABLE public.rate_limit_counters FROM anon, authenticated",
    );
  });
});
