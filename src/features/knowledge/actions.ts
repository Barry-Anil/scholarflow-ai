"use server";

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth/session";
import { requireCourseAccess } from "@/lib/auth/course-access";
import { getDatabase } from "@/lib/db";
import { documents, processingJobs } from "@/lib/db/schema";
import { getServerEnv } from "@/lib/env/server";
import { AppError, errorFingerprint, safeErrorMessage } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { enforceUserRateLimit } from "@/lib/security/rate-limit";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  DOCUMENT_JOB_TYPE,
  EMBEDDING_JOB_TYPE,
  MAX_DOCUMENT_BYTES,
  acceptedDocumentTypes,
  resolveAcceptedDocumentMime,
} from "./constants";
import { processDocumentJob } from "./processor";
import { processEmbeddingBackfillJob } from "./embeddings";

const idSchema = z.uuid();

export type KnowledgeActionState = {
  status: "idle" | "error" | "success";
  message?: string;
};

export async function backfillEmbeddingsAction(
  courseId: string,
  _state: KnowledgeActionState,
): Promise<KnowledgeActionState> {
  void _state;
  const user = await requireUser();
  if (!idSchema.safeParse(courseId).success) {
    return { status: "error", message: "This course is not valid." };
  }
  try {
    await enforceUserRateLimit(user.id, "knowledge.embed");
    await requireCourseAccess(courseId, user.id, "edit");
    const db = getDatabase();
    let [job] = await db
      .select({ id: processingJobs.id })
      .from(processingJobs)
      .where(
        and(
          eq(processingJobs.courseId, courseId),
          eq(processingJobs.type, EMBEDDING_JOB_TYPE),
          inArray(processingJobs.status, ["queued", "processing", "failed"]),
        ),
      )
      .orderBy(desc(processingJobs.createdAt))
      .limit(1);
    if (!job) {
      [job] = await db
        .insert(processingJobs)
        .values({
          ownerId: user.id,
          courseId,
          type: EMBEDDING_JOB_TYPE,
          status: "queued",
          payload: {},
          maxAttempts: 5,
        })
        .returning({ id: processingJobs.id });
    }
    if (!job)
      throw new AppError(
        "UNEXPECTED_ERROR",
        "The embedding job could not be created.",
      );
    const result = await processEmbeddingBackfillJob(job.id, user.id);
    revalidatePath(`/dashboard/courses/${courseId}/knowledge`);
    if (result.status === "skipped") {
      return {
        status: "success",
        message: "Embedding generation is already running.",
      };
    }
    return {
      status: "success",
      message:
        result.remaining > 0
          ? `Embedded ${result.processed} chunks; ${result.remaining} remain. Continue to process the next batch.`
          : result.processed
            ? `Embedded the final ${result.processed} chunks.`
            : "All searchable chunks already have embeddings.",
    };
  } catch (error) {
    logger.error("knowledge.embedding_backfill_failed", {
      userId: user.id,
      courseId,
      ...errorFingerprint(error),
    });
    return { status: "error", message: safeErrorMessage(error) };
  }
}

function safeFilename(filename: string) {
  const normalized = filename
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-");
  return normalized.replace(/^-+|-+$/g, "").slice(0, 180) || "document";
}

export async function uploadDocumentAction(
  courseId: string,
  _state: KnowledgeActionState,
  formData: FormData,
): Promise<KnowledgeActionState> {
  const user = await requireUser();
  const parsedCourseId = idSchema.safeParse(courseId);
  const value = formData.get("document");
  if (!parsedCourseId.success || !(value instanceof File)) {
    return { status: "error", message: "Choose a valid document to upload." };
  }
  if (!value.size || value.size > MAX_DOCUMENT_BYTES) {
    return {
      status: "error",
      message: "Documents must be between 1 byte and 25 MB.",
    };
  }
  const mimeType = resolveAcceptedDocumentMime(value.name, value.type);
  if (!mimeType) {
    return {
      status: "error",
      message: `Supported formats: ${Object.values(acceptedDocumentTypes).join(", ")}.`,
    };
  }

  const documentId = randomUUID();
  const jobId = randomUUID();
  const storagePath = `${user.id}/${courseId}/${documentId}/${safeFilename(value.name)}`;
  const bytes = Buffer.from(await value.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const db = getDatabase();
  const { SUPABASE_STORAGE_BUCKET } = getServerEnv();
  const storage = getSupabaseAdminClient().storage.from(
    SUPABASE_STORAGE_BUCKET,
  );

  try {
    await enforceUserRateLimit(user.id, "knowledge.upload");
    await requireCourseAccess(courseId, user.id, "edit");
    const [duplicate] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(eq(documents.courseId, courseId), eq(documents.sha256, sha256)),
      )
      .limit(1);
    if (duplicate) {
      return {
        status: "error",
        message: "You have already uploaded this exact document.",
      };
    }

    const { error: uploadError } = await storage.upload(storagePath, bytes, {
      contentType: mimeType,
      upsert: false,
    });
    if (uploadError) {
      throw new AppError(
        "UNEXPECTED_ERROR",
        "The document could not be stored.",
        { cause: uploadError },
      );
    }

    try {
      await db.transaction(async (tx) => {
        await tx.insert(documents).values({
          id: documentId,
          ownerId: user.id,
          courseId,
          originalFilename: value.name.slice(0, 500),
          mimeType,
          sizeBytes: value.size,
          storagePath,
          sha256,
          status: "queued",
        });
        await tx.insert(processingJobs).values({
          id: jobId,
          ownerId: user.id,
          courseId,
          documentId,
          type: DOCUMENT_JOB_TYPE,
          status: "queued",
          payload: { storagePath, mimeType },
        });
      });
    } catch (error) {
      await storage.remove([storagePath]);
      throw error;
    }

    const result = await processDocumentJob(jobId, user.id);
    revalidatePath(`/dashboard/courses/${courseId}/knowledge`);
    if (result.status === "failed") {
      return {
        status: "success",
        message: "Uploaded, but text extraction failed. You can retry below.",
      };
    }
    return {
      status: "success",
      message:
        result.status === "completed"
          ? `Document indexed into ${result.chunkCount} searchable chunk${result.chunkCount === 1 ? "" : "s"}.`
          : "Document processing is already in progress.",
    };
  } catch (error) {
    logger.error("knowledge.document_upload_failed", {
      userId: user.id,
      ...errorFingerprint(error),
    });
    return { status: "error", message: safeErrorMessage(error) };
  }
}

export async function retryDocumentAction(
  courseId: string,
  jobId: string,
): Promise<void> {
  const user = await requireUser();
  const parsed = z
    .object({ courseId: idSchema, jobId: idSchema })
    .safeParse({ courseId, jobId });
  if (!parsed.success) return;

  try {
    await enforceUserRateLimit(user.id, "knowledge.retry");
    await requireCourseAccess(courseId, user.id, "edit");
    await processDocumentJob(jobId, user.id);
  } catch (error) {
    logger.error("knowledge.document_retry_failed", {
      userId: user.id,
      ...errorFingerprint(error),
    });
  }
  revalidatePath(`/dashboard/courses/${courseId}/knowledge`);
}
