import "server-only";

import { z } from "zod";

import {
  createOllamaRequestHeaders,
  type OllamaAccessCredentials,
} from "./ollama-access";
import {
  logOllamaCompleted,
  ollamaFetchError,
  ollamaHttpError,
  ollamaInvalidResponse,
  ollamaModelUnavailable,
  type OllamaRequestContext,
} from "./ollama-errors";

const tagsResponseSchema = z.object({
  models: z.array(z.object({ name: z.string().min(1) })),
});

export async function checkOllamaHealth(
  baseUrl: string,
  timeoutMs: number,
  model: string,
  accessCredentials?: OllamaAccessCredentials,
) {
  const tags = await fetchOllamaTags(
    baseUrl,
    timeoutMs,
    model,
    accessCredentials,
  );
  if (!tags.models.includes(model)) {
    throw ollamaModelUnavailable(tags.context);
  }
  logOllamaCompleted(tags.context, tags.httpStatus);
  return {
    status: "ready" as const,
    model,
    latencyMs: Math.round(performance.now() - tags.context.startedAt),
  };
}

/**
 * Lists installed model names with one tags request. Reaching the server does
 * not prove generation works; callers must report that separately.
 */
export async function listOllamaModels(
  baseUrl: string,
  timeoutMs: number,
  accessCredentials?: OllamaAccessCredentials,
) {
  const tags = await fetchOllamaTags(
    baseUrl,
    timeoutMs,
    "tags",
    accessCredentials,
  );
  logOllamaCompleted(tags.context, tags.httpStatus);
  return {
    models: tags.models,
    latencyMs: Math.round(performance.now() - tags.context.startedAt),
  };
}

/** Ollama resolves an untagged model name to its ":latest" tag. */
export function isOllamaModelInstalled(installed: string[], model: string) {
  return installed.some(
    (candidate) =>
      candidate === model ||
      (!model.includes(":") && candidate === `${model}:latest`),
  );
}

async function fetchOllamaTags(
  baseUrl: string,
  timeoutMs: number,
  model: string,
  accessCredentials?: OllamaAccessCredentials,
) {
  const url = new URL(baseUrl);
  const healthTimeoutMs = Math.min(timeoutMs, 15_000);
  const startedAt = performance.now();
  const context: OllamaRequestContext = {
    operation: "health",
    hostname: url.hostname,
    model,
    timeoutMs: healthTimeoutMs,
    startedAt,
  };
  let response: Response;
  try {
    response = await fetch(new URL("/api/tags", url), {
      headers: createOllamaRequestHeaders(accessCredentials),
      cache: "no-store",
      signal: AbortSignal.timeout(healthTimeoutMs),
    });
  } catch (error) {
    throw ollamaFetchError(error, context);
  }
  if (!response.ok) throw ollamaHttpError(response, context);

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch (error) {
    throw ollamaInvalidResponse(
      context,
      "invalid_json",
      error,
      response.status,
    );
  }
  const payload = tagsResponseSchema.safeParse(responseBody);
  if (!payload.success) {
    throw ollamaInvalidResponse(
      context,
      "invalid_payload",
      undefined,
      response.status,
    );
  }
  return {
    models: payload.data.models.map((candidate) => candidate.name),
    context,
    httpStatus: response.status,
  };
}
