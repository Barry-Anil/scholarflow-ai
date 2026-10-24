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
import { DEFAULT_AI_PROVIDER, type AiProviderChoice } from "./provider-choice";
import type { StructuredAiProvider } from "./types";

/** The provider did not answer: the only failures that justify another provider. */
const FALLBACK_CODES = new Set(["AI_UNAVAILABLE", "AI_TIMEOUT"]);

/**
 * Tries the primary provider and, only when it is unreachable or times out,
 * repeats the request against the fallback (with `fallbackModel` when given).
 * Invalid output and authorization errors are surfaced, not masked.
 */
export function withFallback(
  primary: StructuredAiProvider,
  fallback: StructuredAiProvider,
  fallbackModel?: string,
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
          fallbackModel: fallbackModel ?? request.model,
          ...errorFingerprint(error),
        });
        return fallback.generateObject({
          ...request,
          model: fallbackModel ?? request.model,
        });
      }
    },
  };
}

/** Pins every request to one model, e.g. the FreeLLM router model. */
export function withModel(
  provider: StructuredAiProvider,
  model: string,
): StructuredAiProvider {
  return {
    generateObject: (request) => provider.generateObject({ ...request, model }),
  };
}

/** FreeLLM is only selectable when its API is configured; otherwise Ollama. */
export function effectiveAiProvider(choice: AiProviderChoice) {
  return choice === "freellm" && !getAiFallbackEnv() ? "ollama" : choice;
}

export function isFreeLlmConfigured() {
  return getAiFallbackEnv() !== null;
}

/** The model a run will use first, recorded on the run for auditing. */
export function generationModelFor(
  choice: AiProviderChoice,
  roleModel: string,
) {
  const freellm = getAiFallbackEnv();
  return choice === "freellm" && freellm ? freellm.model : roleModel;
}

/**
 * The structured-generation provider for every agent and Study Tutor call.
 * The user's choice is tried first; the other provider, when configured,
 * takes over only if the first is unreachable or times out.
 */
export function createGenerationProvider(
  choice: AiProviderChoice = DEFAULT_AI_PROVIDER,
): StructuredAiProvider {
  const env = getAiEnv();
  const ollama = new OllamaProvider(
    env.OLLAMA_BASE_URL,
    env.AI_REQUEST_TIMEOUT_MS,
    getOllamaAccessCredentials(),
    getOllamaGenerationOptions(),
  );
  const freellm = getAiFallbackEnv();
  if (!freellm) {
    if (choice === "freellm") {
      logger.warn("ai.provider_unconfigured", { requested: choice });
    }
    return ollama;
  }
  const cloud = new OpenAiCompatibleProvider({
    baseUrl: freellm.baseUrl,
    apiKey: freellm.apiKey,
    timeoutMs: freellm.timeoutMs,
  });
  return choice === "freellm"
    ? withFallback(withModel(cloud, freellm.model), ollama)
    : withFallback(ollama, cloud, freellm.model);
}
