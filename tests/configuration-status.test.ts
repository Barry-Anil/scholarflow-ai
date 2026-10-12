import { afterEach, describe, expect, it } from "vitest";

import { getConfigurationStatus } from "@/lib/env/server";

const keys = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "DATABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_STORAGE_BUCKET",
] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("configuration readiness", () => {
  it("accepts the current Supabase publishable key", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable";
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.DATABASE_URL = "postgresql://localhost/database";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";

    const status = getConfigurationStatus();
    expect(status.publicConfigured).toBe(true);
    expect(status.ready).toBe(true);
  });

  it("does not report ready when server-only persistence values are absent", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    delete process.env.DATABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const status = getConfigurationStatus();
    expect(status.publicConfigured).toBe(true);
    expect(status.ready).toBe(false);
    expect(status.missing).toEqual([
      "DATABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);
  });

  it("reports ready only when the complete foundation is valid", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.DATABASE_URL = "postgresql://localhost/database";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    expect(getConfigurationStatus().ready).toBe(true);
  });
});
