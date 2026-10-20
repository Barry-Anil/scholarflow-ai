import "server-only";

import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";

export type OllamaOperation = "chat" | "embed" | "health";

export type OllamaRequestContext = {
  operation: OllamaOperation;
  hostname: string;
  model: string;
  timeoutMs: number;
  startedAt: number;
};

type ErrorDetails = {
  errorName: string;
  errorMessage?: string;
  errorCode?: string;
  causeName?: string;
  causeMessage?: string;
  causeCode?: string;
};

function valueFrom(error: unknown, key: "code" | "message" | "name") {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function errorDetails(error: unknown): ErrorDetails {
  const cause =
    error && typeof error === "object" && "cause" in error
      ? error.cause
      : undefined;
  return {
    errorName: valueFrom(error, "name") ?? "UnknownError",
    errorMessage: valueFrom(error, "message"),
    errorCode: valueFrom(error, "code"),
    causeName: valueFrom(cause, "name"),
    causeMessage: valueFrom(cause, "message"),
    causeCode: valueFrom(cause, "code"),
  };
}

function durationMs(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

function isTimeout(details: ErrorDetails) {
  const values = [
    details.errorName,
    details.errorCode,
    details.causeName,
    details.causeCode,
  ];
  return values.some(
    (value) =>
      value === "TimeoutError" ||
      value === "AbortError" ||
      value === "ABORT_ERR" ||
      value === "UND_ERR_HEADERS_TIMEOUT" ||
      value === "UND_ERR_BODY_TIMEOUT" ||
      value === "ETIMEDOUT",
  );
}

export function ollamaFetchError(
  error: unknown,
  context: OllamaRequestContext,
) {
  const details = errorDetails(error);
  const timedOut = isTimeout(details);
  logger.error("ai.ollama.request_failed", {
    operation: context.operation,
    hostname: context.hostname,
    model: context.model,
    timeoutMs: context.timeoutMs,
    durationMs: durationMs(context.startedAt),
    failureType: timedOut ? "timeout" : "network",
    ...details,
  });
  return new AppError(
    timedOut ? "AI_TIMEOUT" : "AI_UNAVAILABLE",
    timedOut
      ? `Ollama did not respond within ${Math.ceil(context.timeoutMs / 1_000)} seconds. Retry after the model has loaded or increase AI_REQUEST_TIMEOUT_MS.`
      : "The application server could not connect to Ollama through Cloudflare. Retry shortly or check the tunnel and origin service.",
    { cause: error, status: timedOut ? 504 : 503 },
  );
}

export function ollamaHttpError(
  response: Response,
  context: OllamaRequestContext,
) {
  const status = response.status;
  const failureType =
    status === 401 || status === 403
      ? "authorization"
      : status === 502 || status === 503 || status === 504
        ? "origin"
        : status === 404
          ? "model_or_endpoint"
          : "http";
  logger.error("ai.ollama.request_failed", {
    operation: context.operation,
    hostname: context.hostname,
    model: context.model,
    timeoutMs: context.timeoutMs,
    durationMs: durationMs(context.startedAt),
    failureType,
    httpStatus: status,
    cloudflareRay: response.headers.get("cf-ray"),
  });

  if (status === 401 || status === 403) {
    return new AppError(
      "AI_AUTHORIZATION_FAILED",
      "Cloudflare Access rejected the Ollama service credentials. Verify the Vercel service-token variables and Access policy.",
      { status },
    );
  }
  if (status === 404) {
    return new AppError(
      "AI_UNAVAILABLE",
      `The configured Ollama model (${context.model}) or API endpoint is unavailable.`,
      { status },
    );
  }
  if (status === 502 || status === 503 || status === 504) {
    return new AppError(
      "AI_UNAVAILABLE",
      "Cloudflare reached the Ollama route, but the tunnel or origin service was unavailable.",
      { status },
    );
  }
  return new AppError(
    "AI_UNAVAILABLE",
    `Ollama rejected the ${context.operation} request (HTTP ${status}).`,
    { status },
  );
}

export function logOllamaCompleted(
  context: OllamaRequestContext,
  status: number,
) {
  logger.info("ai.ollama.request_completed", {
    operation: context.operation,
    hostname: context.hostname,
    model: context.model,
    timeoutMs: context.timeoutMs,
    durationMs: durationMs(context.startedAt),
    httpStatus: status,
  });
}

export function ollamaInvalidResponse(
  context: OllamaRequestContext,
  reason: "invalid_json" | "invalid_payload" | "invalid_structured_output",
  cause?: unknown,
  httpStatus?: number,
) {
  logger.error("ai.ollama.response_invalid", {
    operation: context.operation,
    hostname: context.hostname,
    model: context.model,
    timeoutMs: context.timeoutMs,
    durationMs: durationMs(context.startedAt),
    failureType: reason,
    httpStatus,
    ...(cause ? errorDetails(cause) : {}),
  });
  return new AppError(
    "AI_RESPONSE_INVALID",
    reason === "invalid_structured_output"
      ? "Ollama returned structured output that did not match the required format. Retry the request."
      : "Ollama returned an invalid API response.",
    { cause },
  );
}

export function ollamaModelUnavailable(context: OllamaRequestContext) {
  logger.error("ai.ollama.model_unavailable", {
    operation: context.operation,
    hostname: context.hostname,
    model: context.model,
    timeoutMs: context.timeoutMs,
    durationMs: durationMs(context.startedAt),
    failureType: "model_unavailable",
    httpStatus: 200,
  });
  return new AppError(
    "AI_UNAVAILABLE",
    `The configured Ollama model (${context.model}) is not installed.`,
    { status: 503 },
  );
}
