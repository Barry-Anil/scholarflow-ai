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
  if (!payload.data.models.some((candidate) => candidate.name === model)) {
    throw ollamaModelUnavailable(context);
  }
  logOllamaCompleted(context, response.status);
  return {
    status: "ready" as const,
    model,
    latencyMs: Math.round(performance.now() - startedAt),
  };
}
