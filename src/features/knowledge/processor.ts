import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";

import { getDatabase } from "@/lib/db";
import { requireCourseAccess } from "@/lib/auth/course-access";
import { documentChunks, documents, processingJobs } from "@/lib/db/schema";
import { getServerEnv } from "@/lib/env/server";
import { AppError, errorFingerprint, safeErrorMessage } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { chunkExtractedPages } from "./chunking";
import {
  DOCUMENT_JOB_TYPE,
  EMBEDDING_JOB_TYPE,
  isAcceptedDocumentMime,
} from "./constants";
import { processEmbeddingBackfillJob } from "./embeddings";
import { extractDocumentText } from "./extract";

export type ProcessDocumentResult =
  | { status: "completed"; chunkCount: number }
  | { status: "failed"; message: string }
  | { status: "skipped" };

export async function processDocumentJob(
  jobId: string,
  ownerId: string,
): Promise<ProcessDocumentResult> {
  const db = getDatabase();
  const [job] = await db
    .select({
      id: processingJobs.id,
      documentId: processingJobs.documentId,
      storagePath: documents.storagePath,
      mimeType: documents.mimeType,
      courseId: documents.courseId,
      assignmentId: documents.assignmentId,
      attempts: processingJobs.attempts,
      maxAttempts: processingJobs.maxAttempts,
    })
    .from(processingJobs)
    .innerJoin(documents, eq(documents.id, processingJobs.documentId))
    .where(
      and(
        eq(processingJobs.id, jobId),
        eq(processingJobs.type, DOCUMENT_JOB_TYPE),
      ),
    )
    .limit(1);

  if (!job?.documentId) {
    throw new AppError("FORBIDDEN", "The processing job was not found.", {
      status: 404,
    });
  }
  await requireCourseAccess(job.courseId, ownerId, "edit");
  const documentId = job.documentId;
  if (job.attempts >= job.maxAttempts) {
    throw new AppError(
      "INVALID_INPUT",
      "This document has reached its processing retry limit.",
      { status: 409 },
    );
  }

  const [claimed] = await db
    .update(processingJobs)
    .set({
      status: "processing",
      lockedAt: new Date(),
      lockedBy: `web:${process.pid}`,
      attempts: sql`${processingJobs.attempts} + 1`,
      lastError: null,
    })
    .where(
      and(
        eq(processingJobs.id, job.id),
        inArray(processingJobs.status, ["queued", "failed"]),
      ),
    )
    .returning({ id: processingJobs.id });

  if (!claimed) return { status: "skipped" };

  await db
    .update(documents)
    .set({ status: "processing", errorMessage: null })
    .where(eq(documents.id, documentId));

  try {
    if (!isAcceptedDocumentMime(job.mimeType)) {
      throw new AppError("INVALID_INPUT", "This file type is not supported.");
    }

    const { SUPABASE_STORAGE_BUCKET } = getServerEnv();
    const storage = getSupabaseAdminClient().storage.from(
      SUPABASE_STORAGE_BUCKET,
    );
    const { data, error } = await storage.download(job.storagePath);
    if (error || !data) {
      throw new AppError(
        "UNEXPECTED_ERROR",
        "The uploaded file could not be downloaded for processing.",
        { cause: error },
      );
    }

    const extracted = await extractDocumentText(
      await data.arrayBuffer(),
      job.mimeType,
    );
    if (!extracted.text) {
      throw new AppError(
        "INVALID_INPUT",
        "No readable text was found in this document.",
      );
    }
    const chunks = chunkExtractedPages(extracted.pages);
    if (!chunks.length) {
      throw new AppError(
        "INVALID_INPUT",
        "The document did not contain enough readable text to index.",
      );
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(documentChunks)
        .where(eq(documentChunks.documentId, documentId));

      for (let index = 0; index < chunks.length; index += 250) {
        await tx.insert(documentChunks).values(
          chunks.slice(index, index + 250).map((chunk) => ({
            documentId,
            ownerId,
            courseId: job.courseId,
            assignmentId: job.assignmentId,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            tokenCount: chunk.tokenCount,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
            metadata: {},
          })),
        );
      }

      const completedAt = new Date();
      await tx
        .update(documents)
        .set({
          status: "ready",
          extractedText: extracted.text,
          extractionMetadata: {
            ...extracted.metadata,
            chunkCount: chunks.length,
          },
          errorMessage: null,
          processedAt: completedAt,
        })
        .where(eq(documents.id, documentId));
      await tx
        .update(processingJobs)
        .set({
          status: "completed",
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          completedAt,
        })
        .where(eq(processingJobs.id, job.id));
    });

    try {
      const [existingEmbeddingJob] = await db
        .select({ id: processingJobs.id })
        .from(processingJobs)
        .where(
          and(
            eq(processingJobs.courseId, job.courseId),
            eq(processingJobs.type, EMBEDDING_JOB_TYPE),
            inArray(processingJobs.status, ["queued", "processing", "failed"]),
          ),
        )
        .limit(1);
      const embeddingJobId = existingEmbeddingJob?.id ?? randomUUID();
      if (!existingEmbeddingJob) {
        await db.insert(processingJobs).values({
          id: embeddingJobId,
          ownerId,
          courseId: job.courseId,
          type: EMBEDDING_JOB_TYPE,
          status: "queued",
          payload: {},
          maxAttempts: 5,
        });
      }
      await processEmbeddingBackfillJob(embeddingJobId, ownerId);
    } catch (embeddingError) {
      logger.warn("knowledge.document_embedding_deferred", {
        userId: ownerId,
        jobId: job.id,
        ...errorFingerprint(embeddingError),
      });
    }

    logger.info("knowledge.document_processed", {
      userId: ownerId,
      jobId: job.id,
      chunkCount: chunks.length,
    });
    return { status: "completed", chunkCount: chunks.length };
  } catch (error) {
    const message = safeErrorMessage(error);
    await db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({ status: "failed", errorMessage: message })
        .where(eq(documents.id, documentId));
      await tx
        .update(processingJobs)
        .set({
          status: "failed",
          lockedAt: null,
          lockedBy: null,
          lastError: message,
        })
        .where(eq(processingJobs.id, job.id));
    });
    logger.error("knowledge.document_processing_failed", {
      userId: ownerId,
      jobId: job.id,
      ...errorFingerprint(error),
    });
    return { status: "failed", message };
  }
}
