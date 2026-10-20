import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { checkOllamaHealth } from "@/lib/ai/ollama-health";
import {
  getAiEnv,
  getOllamaAccessCredentials,
  getOperationsEnv,
} from "@/lib/env/server";
import { AppError, errorFingerprint, safeErrorMessage } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import {
  REQUEST_ID_HEADER,
  resolveRequestId,
} from "@/lib/observability/request-id";

export const maxDuration = 30;

export async function GET(request: Request) {
  const requestId = resolveRequestId(request.headers);
  const headers = {
    "Cache-Control": "no-store",
    [REQUEST_ID_HEADER]: requestId,
  };
  const operations = getOperationsEnv();
  if (!operations.success) {
    return NextResponse.json(
      { status: "not_ready", reason: "operations_not_configured" },
      { status: 503, headers },
    );
  }
  const supplied = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!supplied || !sameSecret(supplied, operations.data.JOB_WORKER_SECRET)) {
    return NextResponse.json(
      { status: "unauthorized" },
      { status: 401, headers },
    );
  }

  try {
    const env = getAiEnv();
    const result = await checkOllamaHealth(
      env.OLLAMA_BASE_URL,
      env.AI_REQUEST_TIMEOUT_MS,
      env.AI_MODEL_WRITER,
      getOllamaAccessCredentials(),
    );
    return NextResponse.json(result, { headers });
  } catch (error) {
    logger.error("health.ai_readiness_failed", {
      requestId,
      ...errorFingerprint(error),
    });
    return NextResponse.json(
      { status: "not_ready", message: safeErrorMessage(error) },
      { status: error instanceof AppError ? error.status : 503, headers },
    );
  }
}

function sameSecret(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}
