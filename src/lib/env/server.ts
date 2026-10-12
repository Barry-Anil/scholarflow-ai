import "server-only";

import { z } from "zod";

import { publicEnvSchema } from "@/lib/env";

const serverEnvSchema = publicEnvSchema.extend({
  DATABASE_URL: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_STORAGE_BUCKET: z.string().default("course-materials"),
});

const operationsEnvSchema = z.object({
  JOB_WORKER_SECRET: z.string().min(32),
});

const aiEnvSchema = z.object({
  AI_PROVIDER: z.literal("ollama").default("ollama"),
  AI_MODEL_WRITER: z.string().min(1).default("qwen3:8b"),
  AI_MODEL_RESEARCHER: z.string().min(1).default("qwen3:8b"),
  AI_MODEL_REVIEWER: z.string().min(1).default("qwen3:8b"),
  AI_EMBEDDING_PROVIDER: z.literal("ollama").default("ollama"),
  AI_EMBEDDING_MODEL: z.string().min(1).default("nomic-embed-text"),
  AI_EMBEDDING_DIMENSIONS: z.coerce.number().int().min(1).default(768),
  OLLAMA_BASE_URL: z.url().default("http://localhost:11434"),
  CROSSREF_CONTACT_EMAIL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.email().optional(),
  ),
  AI_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(180_000)
    .default(90_000),
  DAILY_AI_REQUEST_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000)
    .default(100),
  MAX_AGENT_ITERATIONS: z.coerce.number().int().min(1).max(20).default(5),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type AiEnv = z.infer<typeof aiEnvSchema>;

function values() {
  return {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET,
  };
}

export function getServerEnv(): ServerEnv {
  return serverEnvSchema.parse(values());
}

export function getAiEnv(): AiEnv {
  return aiEnvSchema.parse({
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_MODEL_WRITER: process.env.AI_MODEL_WRITER,
    AI_MODEL_RESEARCHER: process.env.AI_MODEL_RESEARCHER,
    AI_MODEL_REVIEWER: process.env.AI_MODEL_REVIEWER,
    AI_EMBEDDING_PROVIDER: process.env.AI_EMBEDDING_PROVIDER,
    AI_EMBEDDING_MODEL: process.env.AI_EMBEDDING_MODEL,
    AI_EMBEDDING_DIMENSIONS: process.env.AI_EMBEDDING_DIMENSIONS,
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
    CROSSREF_CONTACT_EMAIL: process.env.CROSSREF_CONTACT_EMAIL,
    AI_REQUEST_TIMEOUT_MS: process.env.AI_REQUEST_TIMEOUT_MS,
    DAILY_AI_REQUEST_LIMIT: process.env.DAILY_AI_REQUEST_LIMIT,
    MAX_AGENT_ITERATIONS: process.env.MAX_AGENT_ITERATIONS,
  });
}

export function getOperationsEnv() {
  return operationsEnvSchema.safeParse({
    JOB_WORKER_SECRET: process.env.JOB_WORKER_SECRET,
  });
}

export function getConfigurationStatus() {
  const currentValues = values();
  const parsedPublic = publicEnvSchema.safeParse(currentValues);
  const publicConfigured =
    parsedPublic.success &&
    Boolean(
      parsedPublic.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      parsedPublic.data.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  const serverResult = serverEnvSchema.safeParse(currentValues);
  const missing = serverResult.success
    ? []
    : [
        ...new Set(
          serverResult.error.issues.map((issue) => String(issue.path[0])),
        ),
      ]
        .filter(
          (name) =>
            name !== "NEXT_PUBLIC_APP_URL" &&
            name !== "SUPABASE_STORAGE_BUCKET",
        )
        .sort();
  if (!publicConfigured) missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

  return {
    publicConfigured,
    serverConfigured: serverResult.success,
    ready: publicConfigured && serverResult.success,
    missing: [...new Set(missing)].sort(),
  };
}
