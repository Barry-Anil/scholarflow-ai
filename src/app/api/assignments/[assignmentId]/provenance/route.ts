import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getDraftProvenance,
  getProvenanceIndex,
  getRubricTrace,
} from "@/features/monitoring/provenance";
import { getOptionalUser } from "@/lib/auth/session";
import { AppError, errorFingerprint, safeErrorMessage } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { requestLogContext } from "@/lib/observability/request-id";

const querySchema = z.object({
  assignmentId: z.uuid(),
  draftId: z.uuid().optional(),
  reportId: z.uuid().optional(),
});
const noStore = { "Cache-Control": "no-store" };

// ?draftId= returns one version with its parent for diffing; ?reportId=
// returns the rubric trace; neither returns the version and report index.
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
  const searchParams = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    assignmentId,
    draftId: searchParams.get("draftId") ?? undefined,
    reportId: searchParams.get("reportId") ?? undefined,
  });
  if (!parsed.success || (parsed.data.draftId && parsed.data.reportId)) {
    return NextResponse.json(
      { message: "The provenance request is invalid." },
      { status: 400, headers: noStore },
    );
  }
  const query = parsed.data;
  try {
    const body = query.draftId
      ? await getDraftProvenance(query.assignmentId, user.id, query.draftId)
      : query.reportId
        ? await getRubricTrace(query.assignmentId, user.id, query.reportId)
        : await getProvenanceIndex(query.assignmentId, user.id);
    return NextResponse.json(body, { headers: noStore });
  } catch (error) {
    logger.error("monitor.provenance_failed", {
      ...requestLogContext(request),
      userId: user.id,
      assignmentId: query.assignmentId,
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
