import "server-only";

import { and, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDatabase } from "@/lib/db";
import { requireAssignmentAccess } from "@/lib/auth/course-access";
import {
  agentRuns,
  answerCitations,
  assignmentDrafts,
  assignmentQuestions,
  assignments,
  courses,
  draftAnswers,
  draftApprovals,
  exportRecords,
  processingJobs,
  reviewReports,
} from "@/lib/db/schema";
import { AppError, errorFingerprint, safeErrorMessage } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildMarkdownExport, type AssignmentExportModel } from "./content";
import {
  EXPORT_BUCKET,
  EXPORT_FORMATS,
  EXPORT_JOB_TYPE,
  type ExportFormat,
  type ExportJobPayload,
} from "./contracts";
import { createDocxExport } from "./docx";
import { createPdfExport } from "./pdf";

const exportPayloadSchema = z.object({
  exportRecordId: z.uuid(),
  draftId: z.uuid(),
  approvalId: z.uuid(),
  format: z.enum(EXPORT_FORMATS),
});

export async function enqueueAssignmentExport(
  assignmentId: string,
  ownerId: string,
  format: ExportFormat,
) {
  await requireAssignmentAccess(assignmentId, ownerId, "edit");
  const db = getDatabase();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${assignmentId}))`,
    );
    const [assignment] = await tx
      .select({
        id: assignments.id,
        courseId: assignments.courseId,
        title: assignments.title,
      })
      .from(assignments)
      .where(eq(assignments.id, assignmentId))
      .limit(1);
    if (!assignment)
      throw new AppError("FORBIDDEN", "You cannot export this assignment.", {
        status: 403,
      });

    const [draft] = await tx
      .select({ id: assignmentDrafts.id, version: assignmentDrafts.version })
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
    if (!draft)
      throw new AppError("INVALID_INPUT", "No completed draft is available.");

    const [approval] = await tx
      .select({ id: draftApprovals.id })
      .from(draftApprovals)
      .where(
        and(
          eq(draftApprovals.assignmentId, assignmentId),
          eq(draftApprovals.draftId, draft.id),
        ),
      )
      .limit(1);
    if (!approval)
      throw new AppError(
        "INVALID_INPUT",
        "Approve the latest draft before exporting it.",
        { status: 409 },
      );

    const filename = exportFilename(assignment.title, draft.version, format);
    const [record] = await tx
      .insert(exportRecords)
      .values({
        assignmentId,
        draftId: draft.id,
        approvalId: approval.id,
        ownerId,
        format,
        filename,
        mimeType: exportMimeType(format),
      })
      .returning({ id: exportRecords.id });
    if (!record)
      throw new AppError("UNEXPECTED_ERROR", "The export could not be queued.");

    const payload: ExportJobPayload = {
      exportRecordId: record.id,
      draftId: draft.id,
      approvalId: approval.id,
      format,
    };
    const [job] = await tx
      .insert(processingJobs)
      .values({
        ownerId,
        courseId: assignment.courseId,
        assignmentId,
        type: EXPORT_JOB_TYPE,
        payload,
        maxAttempts: 3,
      })
      .returning({ id: processingJobs.id });
    if (!job)
      throw new AppError("UNEXPECTED_ERROR", "The export job was not saved.");
    return { jobId: job.id, exportRecordId: record.id };
  });
}

export async function processExportJob(jobId: string, ownerId: string) {
  const db = getDatabase();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 5 * 60 * 1000);
  const [job] = await db
    .update(processingJobs)
    .set({
      status: "processing",
      attempts: sql`${processingJobs.attempts} + 1`,
      lockedAt: now,
      lockedBy: `export:${ownerId}`,
      lastError: null,
    })
    .where(
      and(
        eq(processingJobs.id, jobId),
        eq(processingJobs.ownerId, ownerId),
        eq(processingJobs.type, EXPORT_JOB_TYPE),
        lte(processingJobs.availableAt, now),
        or(
          eq(processingJobs.status, "queued"),
          and(
            eq(processingJobs.status, "processing"),
            lt(processingJobs.lockedAt, staleBefore),
          ),
        ),
      ),
    )
    .returning();
  if (!job) {
    const [existing] = await db
      .select({
        status: processingJobs.status,
        lastError: processingJobs.lastError,
      })
      .from(processingJobs)
      .where(
        and(
          eq(processingJobs.id, jobId),
          eq(processingJobs.ownerId, ownerId),
          eq(processingJobs.type, EXPORT_JOB_TYPE),
        ),
      )
      .limit(1);
    if (!existing)
      throw new AppError("INVALID_INPUT", "The export job was not found.", {
        status: 404,
      });
    return {
      status:
        existing.status === "queued" || existing.status === "processing"
          ? "processing"
          : existing.status,
      message: existing.lastError ?? undefined,
    };
  }

  const parsed = exportPayloadSchema.safeParse(job.payload);
  if (!parsed.success)
    return failExportJob(job, null, "Invalid export payload.");
  const payload = parsed.data;
  try {
    await db
      .update(exportRecords)
      .set({ status: "processing", errorMessage: null })
      .where(
        and(
          eq(exportRecords.id, payload.exportRecordId),
          eq(exportRecords.ownerId, ownerId),
        ),
      );
    const model = await loadExportModel(job.assignmentId, ownerId, payload);
    const artifact = await generateArtifact(model, payload.format);
    const storagePath = `${ownerId}/${job.assignmentId}/${payload.draftId}/${payload.exportRecordId}.${extensionFor(payload.format)}`;
    const supabase = getSupabaseAdminClient();
    const { error: uploadError } = await supabase.storage
      .from(EXPORT_BUCKET)
      .upload(storagePath, artifact.buffer, {
        contentType: artifact.mimeType,
        upsert: true,
      });
    if (uploadError) throw uploadError;

    await db.transaction(async (tx) => {
      await tx
        .update(exportRecords)
        .set({
          status: "completed",
          storagePath,
          filename: artifact.filename,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.buffer.byteLength,
          completedAt: new Date(),
          errorMessage: null,
        })
        .where(
          and(
            eq(exportRecords.id, payload.exportRecordId),
            eq(exportRecords.ownerId, ownerId),
          ),
        );
      await tx
        .update(processingJobs)
        .set({
          status: "completed",
          completedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
        })
        .where(
          and(
            eq(processingJobs.id, job.id),
            eq(processingJobs.ownerId, ownerId),
          ),
        );
    });
    logger.info("assignment.export_completed", {
      userId: ownerId,
      assignmentId: job.assignmentId,
      exportRecordId: payload.exportRecordId,
      format: payload.format,
    });
    return { status: "completed" };
  } catch (error) {
    logger.error("assignment.export_failed", {
      userId: ownerId,
      assignmentId: job.assignmentId,
      exportRecordId: payload.exportRecordId,
      ...errorFingerprint(error),
    });
    return failExportJob(job, payload.exportRecordId, safeErrorMessage(error));
  }
}

async function loadExportModel(
  assignmentId: string | null,
  ownerId: string,
  payload: ExportJobPayload,
): Promise<AssignmentExportModel> {
  if (!assignmentId)
    throw new AppError("INVALID_INPUT", "The export has no assignment.");
  const db = getDatabase();
  const [context] = await db
    .select({
      assignmentTitle: assignments.title,
      courseCode: courses.code,
      courseTitle: courses.title,
      draftVersion: assignmentDrafts.version,
      approvedAt: draftApprovals.approvedAt,
      reviewStatus: reviewReports.overallStatus,
    })
    .from(exportRecords)
    .innerJoin(assignments, eq(assignments.id, exportRecords.assignmentId))
    .innerJoin(courses, eq(courses.id, assignments.courseId))
    .innerJoin(assignmentDrafts, eq(assignmentDrafts.id, exportRecords.draftId))
    .innerJoin(draftApprovals, eq(draftApprovals.id, exportRecords.approvalId))
    .innerJoin(
      reviewReports,
      eq(reviewReports.id, draftApprovals.reviewReportId),
    )
    .where(
      and(
        eq(exportRecords.id, payload.exportRecordId),
        eq(exportRecords.assignmentId, assignmentId),
        eq(exportRecords.draftId, payload.draftId),
        eq(exportRecords.approvalId, payload.approvalId),
        eq(exportRecords.ownerId, ownerId),
        eq(exportRecords.format, payload.format),
      ),
    )
    .limit(1);
  if (!context)
    throw new AppError("FORBIDDEN", "The approved export is unavailable.", {
      status: 403,
    });

  const answers = await db
    .select({
      id: draftAnswers.id,
      position: assignmentQuestions.position,
      prompt: assignmentQuestions.prompt,
      markdown: draftAnswers.markdown,
    })
    .from(draftAnswers)
    .innerJoin(
      assignmentQuestions,
      eq(assignmentQuestions.id, draftAnswers.questionId),
    )
    .where(eq(draftAnswers.draftId, payload.draftId))
    .orderBy(assignmentQuestions.position);
  const citations = answers.length
    ? await db
        .select({
          id: answerCitations.id,
          answerId: answerCitations.answerId,
          sourceType: answerCitations.sourceType,
          sourceId: answerCitations.sourceId,
          claimText: answerCitations.claimText,
          locator: answerCitations.locator,
          metadata: answerCitations.metadata,
          verified: answerCitations.verified,
        })
        .from(answerCitations)
        .where(
          inArray(
            answerCitations.answerId,
            answers.map((answer) => answer.id),
          ),
        )
        .orderBy(answerCitations.createdAt)
    : [];
  if (!citations.length || citations.some((citation) => !citation.verified))
    throw new AppError(
      "INVALID_INPUT",
      "Every citation must remain verified before export.",
      { status: 409 },
    );

  return {
    assignmentTitle: context.assignmentTitle,
    courseLabel: context.courseCode || context.courseTitle,
    draftVersion: context.draftVersion,
    approvedAt: context.approvedAt,
    reviewStatus: context.reviewStatus,
    answers: answers.map((answer) => ({
      position: answer.position,
      prompt: answer.prompt,
      markdown: answer.markdown,
      citations: citations.filter(
        (citation) => citation.answerId === answer.id,
      ),
    })),
  };
}

async function generateArtifact(
  model: AssignmentExportModel,
  format: ExportFormat,
) {
  const filename = exportFilename(
    model.assignmentTitle,
    model.draftVersion,
    format,
  );
  const mimeType = exportMimeType(format);
  if (format === "markdown") {
    return {
      filename,
      mimeType,
      buffer: Buffer.from(buildMarkdownExport(model), "utf8"),
    };
  }
  if (format === "docx")
    return { filename, mimeType, buffer: await createDocxExport(model) };
  return { filename, mimeType, buffer: await createPdfExport(model) };
}

async function failExportJob(
  job: typeof processingJobs.$inferSelect,
  exportRecordId: string | null,
  message: string,
) {
  const db = getDatabase();
  const retry = job.attempts < job.maxAttempts;
  await db.transaction(async (tx) => {
    await tx
      .update(processingJobs)
      .set(
        retry
          ? {
              status: "queued",
              availableAt: new Date(Date.now() + 1_000),
              lockedAt: null,
              lockedBy: null,
              lastError: message,
            }
          : {
              status: "failed",
              completedAt: new Date(),
              lockedAt: null,
              lockedBy: null,
              lastError: message,
            },
      )
      .where(eq(processingJobs.id, job.id));
    if (exportRecordId) {
      await tx
        .update(exportRecords)
        .set({
          status: retry ? "queued" : "failed",
          errorMessage: message,
        })
        .where(
          and(
            eq(exportRecords.id, exportRecordId),
            eq(exportRecords.ownerId, job.ownerId),
          ),
        );
    }
  });
  return { status: retry ? "processing" : "failed", message };
}

function exportFilename(title: string, version: number, format: ExportFormat) {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "assignment";
  return `${slug}-v${version}.${extensionFor(format)}`;
}

function extensionFor(format: ExportFormat) {
  return format === "markdown" ? "md" : format;
}

function exportMimeType(format: ExportFormat) {
  if (format === "markdown") return "text/markdown";
  if (format === "docx")
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/pdf";
}
