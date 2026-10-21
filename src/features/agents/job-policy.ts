import { AppError, type AppErrorCode, errorFingerprint } from "@/lib/errors";

const retryableCodes = new Set<AppErrorCode>([
  "AI_RESPONSE_INVALID",
  "AI_TIMEOUT",
  "AI_UNAVAILABLE",
  "DATABASE_UNAVAILABLE",
  "UNEXPECTED_ERROR",
]);

export function isRetryableAgentError(error: unknown) {
  return !(error instanceof AppError) || retryableCodes.has(error.code);
}

export function agentRetryDelayMs(attempts: number) {
  return attempts <= 1 ? 15_000 : 60_000;
}

export function agentPublicError(error: unknown) {
  if (!(error instanceof AppError)) {
    return "The agent task failed unexpectedly. Retry the operation.";
  }
  if (error.code === "AI_TIMEOUT") {
    return "The AI service took too long to respond. The task will retry automatically when attempts remain.";
  }
  if (error.code === "AI_UNAVAILABLE") {
    return "The AI service is temporarily unavailable. The task will retry automatically when attempts remain.";
  }
  if (error.code === "AI_RESPONSE_INVALID") {
    return "The AI response did not pass the required validation checks.";
  }
  return error.userMessage;
}

export function agentDiagnostic(error: unknown) {
  return JSON.stringify({
    ...errorFingerprint(error),
    recordedAt: new Date().toISOString(),
  });
}
