import { NextResponse } from "next/server";

import { getActivityHub } from "@/features/workspace/data";
import { getOptionalUser } from "@/lib/auth/session";
import { errorFingerprint, safeErrorMessage } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { requestLogContext } from "@/lib/observability/request-id";

export async function GET(request: Request) {
  const user = await getOptionalUser();
  if (!user) {
    return NextResponse.json(
      { message: "Sign in to continue." },
      { status: 401 },
    );
  }
  try {
    const runs = await getActivityHub();
    return NextResponse.json(
      { runs: runs.map(serializeRun) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logger.error("workspace.activity_poll_failed", {
      ...requestLogContext(request),
      userId: user.id,
      ...errorFingerprint(error),
    });
    return NextResponse.json(
      { message: safeErrorMessage(error) },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function serializeRun(run: Awaited<ReturnType<typeof getActivityHub>>[number]) {
  return {
    ...run,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}
