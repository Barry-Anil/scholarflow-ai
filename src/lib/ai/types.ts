import type { z } from "zod";

export type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type StructuredGenerationRequest<T> = {
  model: string;
  messages: AiMessage[];
  schema: z.ZodType<T>;
  temperature?: number;
  /** Aborts the request early, e.g. when the client disconnects. */
  signal?: AbortSignal;
};

export type StructuredGenerationResult<T> = {
  value: T;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
};

export interface StructuredAiProvider {
  generateObject<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResult<T>>;
}
