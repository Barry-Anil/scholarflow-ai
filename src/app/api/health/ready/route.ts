import { timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDatabase } from "@/lib/db";
import { getConfigurationStatus, getOperationsEnv } from "@/lib/env/server";
import { logger } from "@/lib/logging/logger";
import {
  REQUEST_ID_HEADER,
  resolveRequestId,
} from "@/lib/observability/request-id";

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
  const configuration = getConfigurationStatus();
  if (!configuration.ready) {
    return NextResponse.json(
      { status: "not_ready", reason: "configuration_incomplete" },
      { status: 503, headers },
    );
  }
  try {
    await getDatabase().execute(sql`select 1 as ready`);
    return NextResponse.json(
      { status: "ready", database: "reachable" },
      { headers },
    );
  } catch (error) {
    logger.error("health.readiness_failed", {
      requestId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { status: "not_ready", reason: "database_unreachable" },
      { status: 503, headers },
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
