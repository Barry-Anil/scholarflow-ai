export type AppErrorCode =
  | "AI_AUTHORIZATION_FAILED"
  | "AI_RESPONSE_INVALID"
  | "AI_TIMEOUT"
  | "AI_UNAVAILABLE"
  | "AUTH_REQUIRED"
  | "CONFIGURATION_MISSING"
  | "DATABASE_UNAVAILABLE"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "RATE_LIMITED"
  | "UNEXPECTED_ERROR";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly userMessage: string;
  readonly status: number;

  constructor(
    code: AppErrorCode,
    userMessage: string,
    options?: { cause?: unknown; status?: number },
  ) {
    super(userMessage, { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.userMessage = userMessage;
    this.status = options?.status ?? 500;
  }
}

export function safeErrorMessage(error: unknown) {
  return error instanceof AppError
    ? error.userMessage
    : "Something went wrong. Please try again.";
}

export function errorFingerprint(error: unknown) {
  if (error instanceof AppError) {
    return { errorName: error.name, errorCode: error.code };
  }
  if (error instanceof Error) {
    const directCode =
      "code" in error && typeof error.code === "string"
        ? error.code
        : undefined;
    const cause = error.cause;
    const causeCode =
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      typeof cause.code === "string"
        ? cause.code
        : undefined;
    return { errorName: error.name, errorCode: directCode ?? causeCode };
  }
  return { errorName: "UnknownError" };
}
