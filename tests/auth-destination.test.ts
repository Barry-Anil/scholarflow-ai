import { afterEach, describe, expect, it } from "vitest";

import {
  getPostAuthDestination,
  normalizeInternalPath,
} from "@/lib/auth/destination";

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

function configurePublicSupabase() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable";
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

describe("post-auth destinations", () => {
  it("rejects external and protocol-relative redirect targets", () => {
    expect(normalizeInternalPath("https://malicious.example")).toBe(
      "/dashboard",
    );
    expect(normalizeInternalPath("//malicious.example")).toBe("/dashboard");
  });

  it("sends dashboard traffic to setup until persistence is configured", () => {
    configurePublicSupabase();
    delete process.env.DATABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    expect(getPostAuthDestination("/dashboard")).toBe("/setup");
  });

  it("preserves password recovery and ready dashboard destinations", () => {
    configurePublicSupabase();
    expect(getPostAuthDestination("/update-password")).toBe("/update-password");

    process.env.DATABASE_URL = "postgresql://localhost/database";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    expect(getPostAuthDestination("/dashboard")).toBe("/dashboard");
  });
});
