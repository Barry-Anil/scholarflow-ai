import { NextResponse } from "next/server";
import { z } from "zod";

import { getAssignmentMonitor } from "@/features/monitoring/data";
import { getOptionalUser } from "@/lib/auth/session";
import { AppError, errorFingerprint, safeErrorMessage } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { requestLogContext } from "@/lib/observability/request-id";

const assignmentIdSchema = z.uuid();
const noStore = { "Cache-Control": "no-store" };

// Read-only: status is derived from persisted records and never mutated here.
export async function GET(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> },
) {
  const user = await getOptionalUser();
  if (!user) {
    return NextResponse.json(
      { message: "Sign in to continue." },
      { status: 401, headers: noStore },
    );
  }
  const { assignmentId } = await context.params;
  const parsed = assignmentIdSchema.safeParse(assignmentId);
  if (!parsed.success) {
    return NextResponse.json(
      { message: "The assignment is invalid." },
      { status: 400, headers: noStore },
    );
  }
  try {
    const snapshot = await getAssignmentMonitor(parsed.data, user.id);
    return NextResponse.json(snapshot, { headers: noStore });
  } catch (error) {
    logger.error("monitor.snapshot_failed", {
      ...requestLogContext(request),
      userId: user.id,
      assignmentId: parsed.data,
      ...errorFingerprint(error),
    });
    return NextResponse.json(
      { message: safeErrorMessage(error) },
      {
        status: error instanceof AppError ? error.status : 503,
        headers: noStore,
      },
    );
  }
}
