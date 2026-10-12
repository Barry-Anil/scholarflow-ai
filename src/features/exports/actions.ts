"use server";

import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  DRAFT_JOB_TYPE,
  RESEARCH_JOB_TYPE,
  REVIEW_JOB_TYPE,
  REVISION_JOB_TYPE,
} from "@/features/agents/contracts";
import { requireUser } from "@/lib/auth/session";
import { requireAssignmentAccess } from "@/lib/auth/course-access";
import { getDatabase } from "@/lib/db";
import {
  agentRuns,
  answerCitations,
  assignmentDrafts,
  assignments,
  draftAnswers,
  draftApprovals,
  processingJobs,
  reviewReports,
} from "@/lib/db/schema";
import { AppError, safeErrorMessage } from "@/lib/errors";
import { enforceUserRateLimit } from "@/lib/security/rate-limit";
import {
  APPROVAL_ATTESTATION,
  APPROVAL_ATTESTATION_VERSION,
  evaluateApprovalReadiness,
} from "./approval";
import { EXPORT_FORMATS } from "./contracts";
import { enqueueAssignmentExport } from "./workflow";

const idsSchema = z.object({ courseId: z.uuid(), assignmentId: z.uuid() });
const exportSchema = idsSchema.extend({ format: z.enum(EXPORT_FORMATS) });
const agentJobTypes = [
  RESEARCH_JOB_TYPE,
  DRAFT_JOB_TYPE,
  REVIEW_JOB_TYPE,
  REVISION_JOB_TYPE,
];

export async function approveDraftAction(
  courseId: string,
  assignmentId: string,
  formData: FormData,
) {
  const user = await requireUser();
  const parsed = idsSchema.safeParse({ courseId, assignmentId });
  if (!parsed.success) redirect("/dashboard");
  const workspacePath = `/dashboard/courses/${courseId}/assignments/${assignmentId}`;
  let status = "success";
  let message = "Draft approved. Secure exports are now available.";
  try {
    await enforceUserRateLimit(user.id, "approval.create");
    await requireAssignmentAccess(assignmentId, user.id, "edit");
    if (formData.get("attestation") !== "on")
      throw new AppError(
        "INVALID_INPUT",
        "Confirm the student attestation before approval.",
      );
    const db = getDatabase();
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${assignmentId}))`,
      );
      const [assignment] = await tx
        .select({ id: assignments.id })
        .from(assignments)
        .where(
          and(
            eq(assignments.id, assignmentId),
            eq(assignments.courseId, courseId),
          ),
        )
        .limit(1);
      if (!assignment)
        throw new AppError("FORBIDDEN", "You cannot approve this assignment.", {
          status: 403,
        });
      const [draft] = await tx
        .select({ id: assignmentDrafts.id })
        .from(assignmentDrafts)
        .leftJoin(agentRuns, eq(agentRuns.id, assignmentDrafts.sourceRunId))
        .where(
          and(
            eq(assignmentDrafts.assignmentId, assignmentId),
            or(
              isNull(assignmentDrafts.sourceRunId),
              eq(agentRuns.status, "completed"),
            ),
          ),
        )
        .orderBy(desc(assignmentDrafts.version))
        .limit(1);
      const [activeJob] = await tx
        .select({ id: processingJobs.id })
        .from(processingJobs)
        .where(
          and(
            eq(processingJobs.assignmentId, assignmentId),
            inArray(processingJobs.type, agentJobTypes),
            inArray(processingJobs.status, ["queued", "processing"]),
          ),
        )
        .limit(1);
      const [activeRun] = await tx
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.assignmentId, assignmentId),
            inArray(agentRuns.status, ["queued", "running"]),
          ),
        )
        .limit(1);
      const [report] = draft
        ? await tx
            .select({
              id: reviewReports.id,
              status: reviewReports.overallStatus,
              gates: reviewReports.qualityGateResults,
            })
            .from(reviewReports)
            .where(
              and(
                eq(reviewReports.assignmentId, assignmentId),
                eq(reviewReports.draftId, draft.id),
              ),
            )
            .orderBy(desc(reviewReports.createdAt))
            .limit(1)
        : [];
      const answerIds = draft
        ? await tx
            .select({ id: draftAnswers.id })
            .from(draftAnswers)
            .where(eq(draftAnswers.draftId, draft.id))
        : [];
      const citations = answerIds.length
        ? await tx
            .select({ verified: answerCitations.verified })
            .from(answerCitations)
            .where(
              inArray(
                answerCitations.answerId,
                answerIds.map((answer) => answer.id),
              ),
            )
        : [];
      const readiness = evaluateApprovalReadiness({
        latestDraftExists: Boolean(draft),
        latestReviewStatus: report?.status ?? null,
        reviewPassed: report?.gates.passed === true,
        citationCount: citations.length,
        verifiedCitationCount: citations.filter((item) => item.verified).length,
        activeAgentOperations: activeJob || activeRun ? 1 : 0,
      });
      if (!readiness.ready)
        throw new AppError(
          "INVALID_INPUT",
          `Approval is blocked: ${readiness.checks
            .filter((check) => !check.passed)
            .map((check) => check.label.toLowerCase())
            .join("; ")}.`,
          { status: 409 },
        );
      if (!draft || !report)
        throw new AppError("INVALID_INPUT", "Approval evidence is incomplete.");

      await tx
        .insert(draftApprovals)
        .values({
          assignmentId,
          draftId: draft.id,
          reviewReportId: report.id,
          ownerId: user.id,
          attestation: APPROVAL_ATTESTATION,
          attestationVersion: APPROVAL_ATTESTATION_VERSION,
        })
        .onConflictDoNothing({ target: draftApprovals.draftId });
      await tx
        .update(assignmentDrafts)
        .set({ isApproved: true })
        .where(eq(assignmentDrafts.id, draft.id));
      await tx
        .update(assignments)
        .set({ status: "APPROVED", approvedAt: new Date() })
        .where(eq(assignments.id, assignmentId));
    });
  } catch (error) {
    status = "error";
    message = safeErrorMessage(error);
  }
  revalidatePath(workspacePath);
  redirect(
    `${workspacePath}?status=${status}&message=${encodeURIComponent(message)}`,
  );
}

export async function startExportAction(
  courseId: string,
  assignmentId: string,
  format: string,
) {
  const user = await requireUser();
  const parsed = exportSchema.safeParse({ courseId, assignmentId, format });
  if (!parsed.success) redirect("/dashboard");
  const workspacePath = `/dashboard/courses/${courseId}/assignments/${assignmentId}`;
  let status = "success";
  let message = `${parsed.data.format.toUpperCase()} export queued.`;
  try {
    await enforceUserRateLimit(user.id, "export.enqueue");
    await requireAssignmentAccess(assignmentId, user.id, "edit");
    const db = getDatabase();
    const [owned] = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(
        and(
          eq(assignments.id, assignmentId),
          eq(assignments.courseId, courseId),
        ),
      )
      .limit(1);
    if (!owned)
      throw new AppError("FORBIDDEN", "You cannot export this assignment.", {
        status: 403,
      });
    await enqueueAssignmentExport(assignmentId, user.id, parsed.data.format);
  } catch (error) {
    status = "error";
    message = safeErrorMessage(error);
  }
  revalidatePath(workspacePath);
  redirect(
    `${workspacePath}?status=${status}&message=${encodeURIComponent(message)}`,
  );
}
