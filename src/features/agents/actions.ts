"use server";

import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUser } from "@/lib/auth/session";
import { requireAssignmentAccess } from "@/lib/auth/course-access";
import { getDatabase } from "@/lib/db";
import {
  agentRuns,
  assignmentDrafts,
  assignments,
  reviewFindings,
  reviewReports,
} from "@/lib/db/schema";
import { AppError, safeErrorMessage } from "@/lib/errors";
import { enforceUserRateLimit } from "@/lib/security/rate-limit";
import {
  enqueueReviewAgent,
  enqueueRevisionAgent,
  enqueueResearchAgent,
  enqueueStudentAgent,
} from "./persistent-workflow";

const idsSchema = z.object({ courseId: z.uuid(), assignmentId: z.uuid() });
const findingDecisionSchema = z.object({
  courseId: z.uuid(),
  assignmentId: z.uuid(),
  findingId: z.uuid(),
  decision: z.enum(["accepted", "rejected"]),
  note: z.string().trim().max(1_000),
});

export async function startResearchAgentAction(
  courseId: string,
  assignmentId: string,
) {
  const user = await requireUser();
  const parsed = idsSchema.safeParse({ courseId, assignmentId });
  if (!parsed.success) redirect("/dashboard");
  const workspacePath = `/dashboard/courses/${courseId}/assignments/${assignmentId}`;
  let status = "success";
  let message: string;
  try {
    await enforceUserRateLimit(user.id, "agent.enqueue");
    await requireAssignmentAccess(assignmentId, user.id, "edit");
    const result = await enqueueResearchAgent(assignmentId, user.id);
    message = `Agent C queued ${result.jobCount} research task${result.jobCount === 1 ? "" : "s"}. You may leave this page while the worker completes them.`;
  } catch (error) {
    status = "error";
    message = safeErrorMessage(error);
  }
  revalidatePath(workspacePath);
  redirect(
    `${workspacePath}?agent=research&status=${status}&message=${encodeURIComponent(message)}`,
  );
}

export async function startReviewAgentAction(
  courseId: string,
  assignmentId: string,
) {
  const user = await requireUser();
  const parsed = idsSchema.safeParse({ courseId, assignmentId });
  if (!parsed.success) redirect("/dashboard");
  const workspacePath = `/dashboard/courses/${courseId}/assignments/${assignmentId}`;
  let status = "success";
  let message: string;
  try {
    await enforceUserRateLimit(user.id, "agent.enqueue");
    await requireAssignmentAccess(assignmentId, user.id, "edit");
    const result = await enqueueReviewAgent(assignmentId, user.id);
    message = `Agent A queued ${result.jobCount} independent review task${result.jobCount === 1 ? "" : "s"}. You may leave this page while the worker completes them.`;
  } catch (error) {
    status = "error";
    message = safeErrorMessage(error);
  }
  revalidatePath(workspacePath);
  redirect(
    `${workspacePath}?agent=review&status=${status}&message=${encodeURIComponent(message)}`,
  );
}

export async function decideReviewFindingAction(
  courseId: string,
  assignmentId: string,
  findingId: string,
  formData: FormData,
) {
  const user = await requireUser();
  const parsed = findingDecisionSchema.safeParse({
    courseId,
    assignmentId,
    findingId,
    decision: formData.get("decision"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) redirect("/dashboard");
  const workspacePath = `/dashboard/courses/${courseId}/assignments/${assignmentId}`;
  let status = "success";
  let message = `Finding ${parsed.data.decision}.`;
  try {
    await enforceUserRateLimit(user.id, "review.decision");
    await requireAssignmentAccess(assignmentId, user.id, "edit");
    const db = getDatabase();
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${assignmentId}))`,
      );
      const [finding, latestDraft, active] = await Promise.all([
        tx
          .select({
            id: reviewFindings.id,
            resolution: reviewFindings.resolution,
            draftId: reviewReports.draftId,
          })
          .from(reviewFindings)
          .innerJoin(
            reviewReports,
            eq(reviewReports.id, reviewFindings.reportId),
          )
          .innerJoin(
            assignments,
            eq(assignments.id, reviewReports.assignmentId),
          )
          .where(
            and(
              eq(reviewFindings.id, findingId),
              eq(reviewReports.assignmentId, assignmentId),
              eq(assignments.courseId, courseId),
            ),
          )
          .limit(1)
          .then((rows) => rows[0]),
        tx
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
          .limit(1)
          .then((rows) => rows[0]),
        tx
          .select({ id: agentRuns.id })
          .from(agentRuns)
          .where(
            and(
              eq(agentRuns.assignmentId, assignmentId),
              inArray(agentRuns.status, ["queued", "running"]),
            ),
          )
          .limit(1)
          .then((rows) => rows[0]),
      ]);
      if (!finding || !latestDraft || finding.draftId !== latestDraft.id)
        throw new AppError(
          "FORBIDDEN",
          "Only findings for the latest draft can be changed.",
          { status: 403 },
        );
      if (finding.resolution === "resolved")
        throw new AppError(
          "INVALID_INPUT",
          "A verified resolved finding cannot be changed.",
        );
      if (active)
        throw new AppError(
          "INVALID_INPUT",
          "Wait for the active agent operation to finish.",
          { status: 409 },
        );
      await tx
        .update(reviewFindings)
        .set({
          resolution: parsed.data.decision,
          decisionNote: parsed.data.note || null,
          decidedBy: user.id,
          decidedAt: new Date(),
          resolvedAt: null,
        })
        .where(eq(reviewFindings.id, finding.id));
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

export async function startRevisionAgentAction(
  courseId: string,
  assignmentId: string,
) {
  const user = await requireUser();
  const parsed = idsSchema.safeParse({ courseId, assignmentId });
  if (!parsed.success) redirect("/dashboard");
  const workspacePath = `/dashboard/courses/${courseId}/assignments/${assignmentId}`;
  let status = "success";
  let message: string;
  try {
    await enforceUserRateLimit(user.id, "agent.enqueue");
    await requireAssignmentAccess(assignmentId, user.id, "edit");
    const result = await enqueueRevisionAgent(assignmentId, user.id);
    message = `Agent B queued revision cycle ${result.iteration} with ${result.jobCount} bounded task${result.jobCount === 1 ? "" : "s"}.`;
  } catch (error) {
    status = "error";
    message = safeErrorMessage(error);
  }
  revalidatePath(workspacePath);
  redirect(
    `${workspacePath}?agent=revision&status=${status}&message=${encodeURIComponent(message)}`,
  );
}

export async function startStudentAgentAction(
  courseId: string,
  assignmentId: string,
) {
  const user = await requireUser();
  const parsed = idsSchema.safeParse({ courseId, assignmentId });
  if (!parsed.success) redirect("/dashboard");
  const workspacePath = `/dashboard/courses/${courseId}/assignments/${assignmentId}`;
  let status = "success";
  let message: string;
  try {
    await enforceUserRateLimit(user.id, "agent.enqueue");
    await requireAssignmentAccess(assignmentId, user.id, "edit");
    const result = await enqueueStudentAgent(assignmentId, user.id);
    message = `Agent B queued ${result.jobCount} drafting task${result.jobCount === 1 ? "" : "s"}. You may leave this page while the worker completes them.`;
  } catch (error) {
    status = "error";
    message = safeErrorMessage(error);
  }
  revalidatePath(workspacePath);
  redirect(
    `${workspacePath}?agent=draft&status=${status}&message=${encodeURIComponent(message)}`,
  );
}
