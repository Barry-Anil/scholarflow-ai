import { NextResponse } from "next/server";
import { z } from "zod";

import {
  eventQuerySchema,
  getAssignmentEvents,
} from "@/features/monitoring/data";
import { getOptionalUser } from "@/lib/auth/session";
import { AppError, errorFingerprint, safeErrorMessage } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { requestLogContext } from "@/lib/observability/request-id";

const assignmentIdSchema = z.uuid();
const noStore = { "Cache-Control": "no-store" };

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
  const id = assignmentIdSchema.safeParse(assignmentId);
  const searchParams = new URL(request.url).searchParams;
  const query = eventQuerySchema.safeParse({
    cursor: searchParams.get("cursor") ?? undefined,
    agent: searchParams.get("agent") ?? undefined,
    severity: searchParams.get("severity") ?? undefined,
    sinceHours: searchParams.get("sinceHours") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });
  if (!id.success || !query.success) {
    return NextResponse.json(
      { message: "The event filter is invalid." },
      { status: 400, headers: noStore },
    );
  }
  try {
    const page = await getAssignmentEvents(id.data, user.id, query.data);
    return NextResponse.json(page, { headers: noStore });
  } catch (error) {
    logger.error("monitor.events_failed", {
      ...requestLogContext(request),
      userId: user.id,
      assignmentId: id.data,
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
