import "server-only";

import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";

import { OllamaEmbeddingProvider } from "@/lib/ai/ollama-embeddings";
import { requireCourseAccess } from "@/lib/auth/course-access";
import { getDatabase } from "@/lib/db";
import { documentChunks, processingJobs } from "@/lib/db/schema";
import { getAiEnv } from "@/lib/env/server";
import { AppError, safeErrorMessage } from "@/lib/errors";
import { EMBEDDING_JOB_TYPE } from "./constants";

export const EMBEDDING_BATCH_SIZE = 32;

export async function generateEmbeddings(input: string[]) {
  const env = getAiEnv();
  if (env.AI_EMBEDDING_DIMENSIONS !== 768) {
    throw new AppError(
      "CONFIGURATION_MISSING",
      "AI_EMBEDDING_DIMENSIONS must be 768 for the current vector index.",
    );
  }
  const provider = new OllamaEmbeddingProvider(
    env.OLLAMA_BASE_URL,
    env.AI_REQUEST_TIMEOUT_MS,
    env.AI_EMBEDDING_DIMENSIONS,
  );
  return provider.embed(env.AI_EMBEDDING_MODEL, input);
}

export async function embedMissingCourseChunks(
  courseId: string,
  userId: string,
) {
  await requireCourseAccess(courseId, userId, "edit");
  const db = getDatabase();
  const chunks = await db
    .select({
      id: documentChunks.id,
      content: documentChunks.content,
    })
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.courseId, courseId),
        isNull(documentChunks.embedding),
      ),
    )
    .limit(EMBEDDING_BATCH_SIZE);

  if (!chunks.length) {
    return { processed: 0, remaining: 0, model: null };
  }

  const result = await generateEmbeddings(chunks.map((chunk) => chunk.content));
  await db.transaction(async (tx) => {
    for (const [index, chunk] of chunks.entries()) {
      await tx
        .update(documentChunks)
        .set({
          embedding: result.embeddings[index],
          embeddingModel: result.model,
          embeddedAt: new Date(),
        })
        .where(eq(documentChunks.id, chunk.id));
    }
  });

  const [coverage] = await db
    .select({ value: count() })
    .from(documentChunks)
    .where(
      and(
        eq(documentChunks.courseId, courseId),
        isNull(documentChunks.embedding),
      ),
    );
  return {
    processed: chunks.length,
    remaining: coverage?.value ?? 0,
    model: result.model,
  };
}

export async function processEmbeddingBackfillJob(
  jobId: string,
  userId: string,
) {
  const db = getDatabase();
  const [job] = await db
    .select({
      id: processingJobs.id,
      courseId: processingJobs.courseId,
      attempts: processingJobs.attempts,
      maxAttempts: processingJobs.maxAttempts,
    })
    .from(processingJobs)
    .where(
      and(
        eq(processingJobs.id, jobId),
        eq(processingJobs.type, EMBEDDING_JOB_TYPE),
      ),
    )
    .limit(1);
  if (!job?.courseId) {
    throw new AppError("FORBIDDEN", "The embedding job is unavailable.", {
      status: 404,
    });
  }
  await requireCourseAccess(job.courseId, userId, "edit");
  if (job.attempts >= job.maxAttempts) {
    throw new AppError(
      "INVALID_INPUT",
      "This embedding job reached its retry limit.",
      { status: 409 },
    );
  }

  const [claimed] = await db
    .update(processingJobs)
    .set({
      status: "processing",
      lockedAt: new Date(),
      lockedBy: `web:${process.pid}`,
      lastError: null,
    })
    .where(
      and(
        eq(processingJobs.id, job.id),
        inArray(processingJobs.status, ["queued", "failed"]),
      ),
    )
    .returning({ id: processingJobs.id });
  if (!claimed) {
    return { status: "skipped" as const, processed: 0, remaining: null };
  }

  try {
    const result = await embedMissingCourseChunks(job.courseId, userId);
    await db
      .update(processingJobs)
      .set({
        status: result.remaining > 0 ? "queued" : "completed",
        availableAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        completedAt: result.remaining > 0 ? null : new Date(),
        payload: {
          processed: result.processed,
          remaining: result.remaining,
          model: result.model,
        },
      })
      .where(eq(processingJobs.id, job.id));
    return { status: "completed" as const, ...result };
  } catch (error) {
    const message = safeErrorMessage(error);
    await db
      .update(processingJobs)
      .set({
        status: "failed",
        attempts: sql`${processingJobs.attempts} + 1`,
        lockedAt: null,
        lockedBy: null,
        lastError: message,
      })
      .where(eq(processingJobs.id, job.id));
    throw error;
  }
}
