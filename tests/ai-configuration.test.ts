import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAiEnv, getOllamaAccessCredentials } from "@/lib/env/server";

const keys = [
  "OLLAMA_URL",
  "OLLAMA_BASE_URL",
  "OLLAMA_MODEL",
  "AI_MODEL_WRITER",
  "AI_MODEL_RESEARCHER",
  "AI_MODEL_REVIEWER",
  "AI_REQUEST_TIMEOUT_MS",
  "CF_ACCESS_CLIENT_ID",
  "CF_ACCESS_CLIENT_SECRET",
] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of keys) delete process.env[key];
});

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Ollama configuration", () => {
  it("maps the shared URL and model while preserving role-specific overrides", () => {
    process.env.OLLAMA_URL = "https://ollama.example.com";
    process.env.OLLAMA_BASE_URL = "http://legacy.example.com:11434";
    process.env.OLLAMA_MODEL = "shared-model";
    process.env.AI_MODEL_REVIEWER = "review-model";

    expect(getAiEnv()).toMatchObject({
      OLLAMA_BASE_URL: "https://ollama.example.com",
      AI_MODEL_WRITER: "shared-model",
      AI_MODEL_RESEARCHER: "shared-model",
      AI_MODEL_REVIEWER: "review-model",
    });
  });

  it("retains the legacy local defaults", () => {
    expect(getAiEnv()).toMatchObject({
      OLLAMA_BASE_URL: "http://localhost:11434",
      AI_MODEL_WRITER: "qwen3:8b",
      AI_MODEL_RESEARCHER: "qwen3:8b",
      AI_MODEL_REVIEWER: "qwen3:8b",
      AI_REQUEST_TIMEOUT_MS: 120_000,
    });
  });

  it("requires both Cloudflare Access service-token values", () => {
    process.env.CF_ACCESS_CLIENT_ID = "client-id";
    expect(() => getAiEnv()).toThrow(/must be configured together/);
  });

  it("returns paired Cloudflare Access credentials for server-side requests", () => {
    process.env.CF_ACCESS_CLIENT_ID = "client-id";
    process.env.CF_ACCESS_CLIENT_SECRET = "client-secret";
    expect(getOllamaAccessCredentials()).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
    });
  });
});
