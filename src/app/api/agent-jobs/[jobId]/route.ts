import { NextResponse } from "next/server";
import { z } from "zod";

import { getOwnedAgentJobStatus } from "@/features/agents/agent-job-queue";
import { getOptionalUser } from "@/lib/auth/session";
import { AppError, errorFingerprint, safeErrorMessage } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { requestLogContext } from "@/lib/observability/request-id";

const jobIdSchema = z.uuid();

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const user = await getOptionalUser();
  if (!user) {
    return NextResponse.json(
      { message: "Sign in to continue." },
      { status: 401 },
    );
  }

  const { jobId } = await context.params;
  const parsed = jobIdSchema.safeParse(jobId);
  if (!parsed.success) {
    return NextResponse.json(
      { message: "The agent task is invalid." },
      { status: 400 },
    );
  }

  try {
    const result = await getOwnedAgentJobStatus(parsed.data, user.id);
    return NextResponse.json(result);
  } catch (error) {
    logger.error("agent.job_request_failed", {
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
