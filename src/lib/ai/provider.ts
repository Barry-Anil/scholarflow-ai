import "server-only";

import {
  getAiEnv,
  getAiFallbackEnv,
  getOllamaAccessCredentials,
  getOllamaGenerationOptions,
} from "@/lib/env/server";
import { AppError, errorFingerprint } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { OllamaProvider } from "./ollama";
import { OpenAiCompatibleProvider } from "./openai-compatible";
import type { StructuredAiProvider } from "./types";

/** Ollama did not answer: the only failures that justify another provider. */
const FALLBACK_CODES = new Set(["AI_UNAVAILABLE", "AI_TIMEOUT"]);

/**
 * Tries the primary provider and, only when it is unreachable or times out,
 * repeats the request against the fallback with the fallback's own model.
 * Invalid output and authorization errors are surfaced, not masked.
 */
export function withFallback(
  primary: StructuredAiProvider,
  fallback: StructuredAiProvider,
  fallbackModel: string,
): StructuredAiProvider {
  return {
    async generateObject(request) {
      try {
        return await primary.generateObject(request);
      } catch (error) {
        if (
          request.signal?.aborted ||
          !(error instanceof AppError) ||
          !FALLBACK_CODES.has(error.code)
        ) {
          throw error;
        }
        logger.warn("ai.fallback_used", {
          primaryModel: request.model,
          fallbackModel,
          ...errorFingerprint(error),
        });
        return fallback.generateObject({ ...request, model: fallbackModel });
      }
    },
  };
}

/** The structured-generation provider for every agent and Study Tutor call. */
export function createGenerationProvider(): StructuredAiProvider {
  const env = getAiEnv();
  const ollama = new OllamaProvider(
    env.OLLAMA_BASE_URL,
    env.AI_REQUEST_TIMEOUT_MS,
    getOllamaAccessCredentials(),
    getOllamaGenerationOptions(),
  );
  const fallback = getAiFallbackEnv();
  if (!fallback) return ollama;
  return withFallback(
    ollama,
    new OpenAiCompatibleProvider({
      baseUrl: fallback.baseUrl,
      apiKey: fallback.apiKey,
      timeoutMs: fallback.timeoutMs,
    }),
    fallback.model,
  );
}
