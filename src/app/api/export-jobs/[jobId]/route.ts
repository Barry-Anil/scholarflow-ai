import { NextResponse } from "next/server";
import { z } from "zod";

import { processExportJob } from "@/features/exports/workflow";
import { getOptionalUser } from "@/lib/auth/session";
import { AppError, errorFingerprint, safeErrorMessage } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { requestLogContext } from "@/lib/observability/request-id";
import { enforceUserRateLimit } from "@/lib/security/rate-limit";

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const user = await getOptionalUser();
  if (!user)
    return NextResponse.json(
      { message: "Sign in to continue." },
      { status: 401 },
    );
  const parsed = z.uuid().safeParse((await context.params).jobId);
  if (!parsed.success)
    return NextResponse.json(
      { message: "The export task is invalid." },
      { status: 400 },
    );
  try {
    await enforceUserRateLimit(user.id, "worker.export");
    const result = await processExportJob(parsed.data, user.id);
    return NextResponse.json(result, {
      status: result.status === "processing" ? 202 : 200,
    });
  } catch (error) {
    logger.error("export.job_request_failed", {
      ...requestLogContext(request),
      userId: user.id,
      jobId: parsed.data,
      ...errorFingerprint(error),
    });
    return NextResponse.json(
      { message: safeErrorMessage(error) },
      { status: error instanceof AppError ? error.status : 500 },
    );
  }
}
