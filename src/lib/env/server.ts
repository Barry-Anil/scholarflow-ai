import "server-only";

import { z } from "zod";

import { publicEnvSchema } from "@/lib/env";

const databaseEnvSchema = z.object({ DATABASE_URL: z.string().min(1) });

const supabaseAdminEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

const serverEnvSchema = publicEnvSchema.extend({
  DATABASE_URL: databaseEnvSchema.shape.DATABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_STORAGE_BUCKET: z.string().default("course-materials"),
});

const operationsEnvSchema = z.object({
  JOB_WORKER_SECRET: z.string().min(32),
});

const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const ttsEnvSchema = z.object({
  INWORLD_API_KEY: optionalSecret,
  INWORLD_TTS_MODEL: z
    .enum(["inworld-tts-2", "inworld-tts-2-flash"])
    .default("inworld-tts-2"),
  INWORLD_TTS_VOICE_ID: z.string().min(1).default("Ashley"),
  INWORLD_TTS_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(60_000)
    .default(30_000),
});

const cloudflareAccessEnvSchema = z
  .object({
    CF_ACCESS_CLIENT_ID: optionalSecret,
    CF_ACCESS_CLIENT_SECRET: optionalSecret,
  })
  .superRefine((value, context) => {
    if (
      Boolean(value.CF_ACCESS_CLIENT_ID) ===
      Boolean(value.CF_ACCESS_CLIENT_SECRET)
    )
      return;
    context.addIssue({
      code: "custom",
      message:
        "CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET must be configured together.",
      path: [
        value.CF_ACCESS_CLIENT_ID
          ? "CF_ACCESS_CLIENT_SECRET"
          : "CF_ACCESS_CLIENT_ID",
      ],
    });
  });

const aiEnvSchema = z
  .object({
    AI_PROVIDER: z.literal("ollama").default("ollama"),
    OLLAMA_MODEL: z.string().min(1).optional(),
    AI_MODEL_WRITER: z.string().min(1).optional(),
    AI_MODEL_RESEARCHER: z.string().min(1).optional(),
    AI_MODEL_REVIEWER: z.string().min(1).optional(),
    AI_EMBEDDING_PROVIDER: z.literal("ollama").default("ollama"),
    AI_EMBEDDING_MODEL: z.string().min(1).default("nomic-embed-text"),
    AI_EMBEDDING_DIMENSIONS: z.coerce.number().int().min(1).default(768),
    OLLAMA_URL: z.url().optional(),
    OLLAMA_BASE_URL: z.url().optional(),
    CROSSREF_CONTACT_EMAIL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.email().optional(),
    ),
    AI_REQUEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(5_000)
      .max(900_000)
      .default(120_000),
    AI_NUM_CTX: z.coerce.number().int().min(2_048).max(131_072).optional(),
    AI_NUM_PREDICT: z.coerce.number().int().min(128).max(32_768).optional(),
    AI_TOP_P: z.coerce.number().min(0).max(1).optional(),
    AI_SEED: z.coerce.number().int().optional(),
    DAILY_AI_REQUEST_LIMIT: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000)
      .default(100),
    MAX_AGENT_ITERATIONS: z.coerce.number().int().min(1).max(20).default(5),
  })
  .transform((value) => {
    const model = value.OLLAMA_MODEL ?? "qwen3:8b";
    return {
      ...value,
      AI_MODEL_WRITER: value.AI_MODEL_WRITER ?? model,
      AI_MODEL_RESEARCHER: value.AI_MODEL_RESEARCHER ?? model,
      AI_MODEL_REVIEWER: value.AI_MODEL_REVIEWER ?? model,
      OLLAMA_BASE_URL:
        value.OLLAMA_URL ?? value.OLLAMA_BASE_URL ?? "http://localhost:11434",
    };
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

export function getDatabaseEnv() {
  return databaseEnvSchema.parse({ DATABASE_URL: process.env.DATABASE_URL });
}

export function getSupabaseAdminEnv() {
  return supabaseAdminEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
}

export function getAiEnv(): AiEnv {
  getOllamaAccessCredentials();
  return aiEnvSchema.parse({
    AI_PROVIDER: process.env.AI_PROVIDER,
    OLLAMA_MODEL: process.env.OLLAMA_MODEL,
    AI_MODEL_WRITER: process.env.AI_MODEL_WRITER,
    AI_MODEL_RESEARCHER: process.env.AI_MODEL_RESEARCHER,
    AI_MODEL_REVIEWER: process.env.AI_MODEL_REVIEWER,
    AI_EMBEDDING_PROVIDER: process.env.AI_EMBEDDING_PROVIDER,
    AI_EMBEDDING_MODEL: process.env.AI_EMBEDDING_MODEL,
    AI_EMBEDDING_DIMENSIONS: process.env.AI_EMBEDDING_DIMENSIONS,
    OLLAMA_URL: process.env.OLLAMA_URL,
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
    CROSSREF_CONTACT_EMAIL: process.env.CROSSREF_CONTACT_EMAIL,
    AI_REQUEST_TIMEOUT_MS: process.env.AI_REQUEST_TIMEOUT_MS,
    AI_NUM_CTX: process.env.AI_NUM_CTX,
    AI_NUM_PREDICT: process.env.AI_NUM_PREDICT,
    AI_TOP_P: process.env.AI_TOP_P,
    AI_SEED: process.env.AI_SEED,
    DAILY_AI_REQUEST_LIMIT: process.env.DAILY_AI_REQUEST_LIMIT,
    MAX_AGENT_ITERATIONS: process.env.MAX_AGENT_ITERATIONS,
  });
}

export function getOllamaGenerationOptions() {
  const env = getAiEnv();
  return {
    numCtx: env.AI_NUM_CTX,
    numPredict: env.AI_NUM_PREDICT,
    topP: env.AI_TOP_P,
    seed: env.AI_SEED,
  };
}

export function getOllamaAccessCredentials() {
  const value = cloudflareAccessEnvSchema.parse({
    CF_ACCESS_CLIENT_ID: process.env.CF_ACCESS_CLIENT_ID,
    CF_ACCESS_CLIENT_SECRET: process.env.CF_ACCESS_CLIENT_SECRET,
  });
  if (!value.CF_ACCESS_CLIENT_ID || !value.CF_ACCESS_CLIENT_SECRET)
    return undefined;
  return {
    clientId: value.CF_ACCESS_CLIENT_ID,
    clientSecret: value.CF_ACCESS_CLIENT_SECRET,
  };
}

export function getOperationsEnv() {
  return operationsEnvSchema.safeParse({
    JOB_WORKER_SECRET: process.env.JOB_WORKER_SECRET,
  });
}

export function getTtsEnv() {
  return ttsEnvSchema.parse({
    INWORLD_API_KEY: process.env.INWORLD_API_KEY,
    INWORLD_TTS_MODEL: process.env.INWORLD_TTS_MODEL,
    INWORLD_TTS_VOICE_ID: process.env.INWORLD_TTS_VOICE_ID,
    INWORLD_TTS_TIMEOUT_MS: process.env.INWORLD_TTS_TIMEOUT_MS,
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
