import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { chunkExtractedPages } from "@/features/knowledge/chunking";
import { generateEmbeddings } from "@/features/knowledge/embeddings";
import { getDatabase } from "@/lib/db";
import {
  studyChunks,
  studyDocuments,
  processingJobs,
  studySections,
  studySessions,
} from "@/lib/db/schema";
import { AppError, errorFingerprint, safeErrorMessage } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  STUDY_DOCUMENT_JOB_TYPE,
  STUDY_MIME_TYPES,
  STUDY_STORAGE_BUCKET,
  type StudyMimeType,
} from "./constants";
import { extractStudyDocument } from "./extract";
import { detectStudySections } from "./sections";

type ProcessStudyDocumentInput = {
  sessionId: string;
  documentId: string;
  ownerId: string;
  title: string;
  mimeType: StudyMimeType;
  bytes: ArrayBuffer;
};

const studyJobPayloadSchema = z.object({
  sessionId: z.uuid(),
  documentId: z.uuid(),
  storagePath: z.string().min(1),
  mimeType: z.enum(STUDY_MIME_TYPES),
  title: z.string().min(1).max(240),
});

export async function processClaimedStudyDocumentJob(
  jobId: string,
  workerId: string,
  options: { leaseMs: number; heartbeatMs: number; exhausted: boolean },
) {
  const db = getDatabase();
  const [job] = await db
    .select({
      id: processingJobs.id,
      ownerId: processingJobs.ownerId,
      payload: processingJobs.payload,
      attempts: processingJobs.attempts,
      maxAttempts: processingJobs.maxAttempts,
      lockedBy: processingJobs.lockedBy,
    })
    .from(processingJobs)
    .where(
      and(
        eq(processingJobs.id, jobId),
        eq(processingJobs.type, STUDY_DOCUMENT_JOB_TYPE),
      ),
    )
    .limit(1);
  const payload = studyJobPayloadSchema.safeParse(job?.payload);
  if (!job || job.lockedBy !== workerId || !payload.success) {
    throw new AppError(
      "FORBIDDEN",
      "The worker cannot process this study job.",
      {
        status: 403,
      },
    );
  }
  if (options.exhausted) {
    const message =
      "Document processing stopped repeatedly and reached its retry limit.";
    await db.transaction(async (tx) => {
      await tx
        .update(processingJobs)
        .set({
          status: "failed",
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          lastErrorCode: "WORKER_LEASE_EXHAUSTED",
          lastError: message,
        })
        .where(eq(processingJobs.id, job.id));
      await tx
        .update(studyDocuments)
        .set({ status: "failed", errorMessage: message })
        .where(eq(studyDocuments.id, payload.data.documentId));
      await tx
        .update(studySessions)
        .set({ status: "failed", lastActivityAt: new Date() })
        .where(eq(studySessions.id, payload.data.sessionId));
    });
    return { status: "failed" as const };
  }

  const leaseTimer = setInterval(() => {
    void db
      .update(processingJobs)
      .set({ leaseExpiresAt: new Date(Date.now() + options.leaseMs) })
      .where(
        and(
          eq(processingJobs.id, job.id),
          eq(processingJobs.lockedBy, workerId),
          eq(processingJobs.status, "processing"),
        ),
      )
      .catch((error) =>
        logger.warn("study.worker_lease_renewal_failed", {
          jobId: job.id,
          ...errorFingerprint(error),
        }),
      );
  }, options.heartbeatMs);
  leaseTimer.unref();

  try {
    const { data, error } = await getSupabaseAdminClient()
      .storage.from(STUDY_STORAGE_BUCKET)
      .download(payload.data.storagePath);
    if (error || !data) {
      throw new AppError(
        "UNEXPECTED_ERROR",
        "The uploaded notes could not be downloaded for processing.",
        { cause: error },
      );
    }
    const result = await processStudyDocument({
      sessionId: payload.data.sessionId,
      documentId: payload.data.documentId,
      ownerId: job.ownerId,
      title: payload.data.title,
      mimeType: payload.data.mimeType,
      bytes: await data.arrayBuffer(),
    });
    await db
      .update(processingJobs)
      .set({
        status: "completed",
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        lastError: null,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(processingJobs.id, job.id),
          eq(processingJobs.lockedBy, workerId),
        ),
      );
    return { status: "completed" as const, ...result };
  } catch (error) {
    const retryable =
      job.attempts < job.maxAttempts &&
      !(error instanceof AppError && error.code === "INVALID_INPUT");
    const message = safeErrorMessage(error);
    await db.transaction(async (tx) => {
      await tx
        .update(processingJobs)
        .set({
          status: retryable ? "queued" : "failed",
          availableAt: retryable
            ? new Date(Date.now() + Math.min(60_000, 2 ** job.attempts * 2_000))
            : new Date(),
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          lastErrorCode:
            error instanceof AppError ? error.code : "UNEXPECTED_ERROR",
          lastError: message,
        })
        .where(eq(processingJobs.id, job.id));
      if (retryable) {
        await tx
          .update(studyDocuments)
          .set({ status: "queued", errorMessage: null })
          .where(eq(studyDocuments.id, payload.data.documentId));
        await tx
          .update(studySessions)
          .set({ status: "processing", lastActivityAt: new Date() })
          .where(eq(studySessions.id, payload.data.sessionId));
      }
    });
    return { status: retryable ? ("queued" as const) : ("failed" as const) };
  } finally {
    clearInterval(leaseTimer);
  }
}

export async function processStudyDocument(input: ProcessStudyDocumentInput) {
  const db = getDatabase();
  await db
    .update(studyDocuments)
    .set({ status: "processing", errorMessage: null })
    .where(
      and(
        eq(studyDocuments.id, input.documentId),
        eq(studyDocuments.ownerId, input.ownerId),
      ),
    );
  try {
    const extracted = await extractStudyDocument(input.bytes, input.mimeType);
    if (!extracted.text.trim()) throw new Error("No readable text was found.");
    const sections = detectStudySections(extracted.pages, input.title);
    if (!sections.length)
      throw new Error("No usable study sections were found.");

    const persisted = sections.map((section) => ({
      ...section,
      id: randomUUID(),
    }));
    let nextChunkIndex = 0;
    const chunks = persisted.flatMap((section) =>
      chunkExtractedPages([
        { pageNumber: section.pageStart ?? undefined, text: section.content },
      ]).map((chunk) => ({
        ...chunk,
        chunkIndex: nextChunkIndex++,
        id: randomUUID(),
        sectionId: section.id,
      })),
    );
    const completedAt = new Date();
    await db.transaction(async (tx) => {
      await tx
        .delete(studyChunks)
        .where(eq(studyChunks.documentId, input.documentId));
      await tx
        .delete(studySections)
        .where(eq(studySections.documentId, input.documentId));
      await tx.insert(studySections).values(
        persisted.map((section) => ({
          id: section.id,
          sessionId: input.sessionId,
          documentId: input.documentId,
          ownerId: input.ownerId,
          position: section.position,
          title: section.title,
          content: section.content,
          pageStart: section.pageStart,
          pageEnd: section.pageEnd,
          metadata: {},
        })),
      );
      for (let start = 0; start < chunks.length; start += 250) {
        await tx.insert(studyChunks).values(
          chunks.slice(start, start + 250).map((chunk) => ({
            id: chunk.id,
            sessionId: input.sessionId,
            documentId: input.documentId,
            sectionId: chunk.sectionId,
            ownerId: input.ownerId,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            tokenCount: chunk.tokenCount,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
            metadata: {},
          })),
        );
      }
      await tx
        .update(studyDocuments)
        .set({
          status: "ready",
          extractedText: extracted.text,
          extractionMetadata: {
            ...extracted.metadata,
            sectionCount: persisted.length,
            chunkCount: chunks.length,
            retrievalMode: "keyword",
          },
          processedAt: completedAt,
        })
        .where(eq(studyDocuments.id, input.documentId));
      await tx
        .update(studySessions)
        .set({
          status: "ready",
          currentSectionId: persisted[0]?.id ?? null,
          lastActivityAt: completedAt,
        })
        .where(eq(studySessions.id, input.sessionId));
    });

    let embedded = 0;
    try {
      for (let start = 0; start < chunks.length; start += 32) {
        const batch = chunks.slice(start, start + 32);
        const result = await generateEmbeddings(
          batch.map((chunk) => chunk.content),
        );
        await db.transaction(async (tx) => {
          for (const [index, chunk] of batch.entries()) {
            await tx
              .update(studyChunks)
              .set({
                embedding: result.embeddings[index],
                embeddingModel: result.model,
                embeddedAt: new Date(),
              })
              .where(eq(studyChunks.id, chunk.id));
          }
        });
        embedded += batch.length;
      }
      await db
        .update(studyDocuments)
        .set({
          extractionMetadata: {
            ...extracted.metadata,
            sectionCount: persisted.length,
            chunkCount: chunks.length,
            retrievalMode: "hybrid",
            embeddedChunkCount: embedded,
          },
        })
        .where(eq(studyDocuments.id, input.documentId));
    } catch (error) {
      logger.warn("study.document_embedding_deferred", {
        userId: input.ownerId,
        sessionId: input.sessionId,
        ...errorFingerprint(error),
      });
    }
    return {
      sectionCount: persisted.length,
      chunkCount: chunks.length,
      embedded,
    };
  } catch (error) {
    const message =
      error instanceof Error && error.message === "No readable text was found."
        ? error.message
        : error instanceof Error &&
            error.message === "No usable study sections were found."
          ? error.message
          : undefined;
    await db.transaction(async (tx) => {
      await tx
        .update(studyDocuments)
        .set({
          status: "failed",
          errorMessage: message ?? "Text extraction failed.",
        })
        .where(eq(studyDocuments.id, input.documentId));
      await tx
        .update(studySessions)
        .set({ status: "failed", lastActivityAt: new Date() })
        .where(eq(studySessions.id, input.sessionId));
    });
    throw error;
  }
}
