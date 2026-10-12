import "server-only";

import { and, asc, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import { cache } from "react";

import { requireUser } from "@/lib/auth/session";
import { requireCourseAccess } from "@/lib/auth/course-access";
import { getDatabase } from "@/lib/db";
import {
  courses,
  documentChunks,
  documents,
  processingJobs,
} from "@/lib/db/schema";
import { errorFingerprint } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { DOCUMENT_JOB_TYPE } from "./constants";
import { generateEmbeddings } from "./embeddings";
import {
  fuseKnowledgeResults,
  type RetrievalCandidate,
} from "./hybrid-retrieval";

export const getKnowledgeBaseData = cache(async (courseId: string) => {
  const user = await requireUser();
  const access = await requireCourseAccess(courseId, user.id, "read").catch(
    () => null,
  );
  if (!access) return null;
  const db = getDatabase();
  const [course] = await db
    .select({ id: courses.id, code: courses.code, title: courses.title })
    .from(courses)
    .where(eq(courses.id, courseId))
    .limit(1);
  if (!course) return null;

  const materials = await db
    .select({
      id: documents.id,
      filename: documents.originalFilename,
      mimeType: documents.mimeType,
      sizeBytes: documents.sizeBytes,
      status: documents.status,
      errorMessage: documents.errorMessage,
      processedAt: documents.processedAt,
      createdAt: documents.createdAt,
      chunkCount: count(documentChunks.id),
      embeddedChunkCount: count(documentChunks.embedding),
      jobId: processingJobs.id,
      attempts: processingJobs.attempts,
      maxAttempts: processingJobs.maxAttempts,
    })
    .from(documents)
    .leftJoin(documentChunks, eq(documentChunks.documentId, documents.id))
    .leftJoin(
      processingJobs,
      and(
        eq(processingJobs.documentId, documents.id),
        eq(processingJobs.type, DOCUMENT_JOB_TYPE),
      ),
    )
    .where(eq(documents.courseId, courseId))
    .groupBy(documents.id, processingJobs.id)
    .orderBy(desc(documents.createdAt));

  return {
    course,
    materials,
    role: access.role,
    coverage: {
      total: materials.reduce((sum, item) => sum + item.chunkCount, 0),
      embedded: materials.reduce(
        (sum, item) => sum + item.embeddedChunkCount,
        0,
      ),
    },
  };
});

export async function retrieveCourseKnowledge(
  courseId: string,
  userId: string,
  rawQuery: string,
  limit = 12,
) {
  const query = rawQuery.trim().slice(0, 240);
  if (query.length < 2) {
    return { results: [], mode: "keyword" as const, model: null };
  }
  await requireCourseAccess(courseId, userId, "read");
  const db = getDatabase();
  const textVector = sql`to_tsvector('english', ${documentChunks.content})`;
  const searchQuery = sql`websearch_to_tsquery('english', ${query})`;
  const keywordRank = sql<number>`ts_rank(${textVector}, ${searchQuery})`;
  const keywordRows = await db
    .select({
      id: documentChunks.id,
      content: documentChunks.content,
      pageStart: documentChunks.pageStart,
      pageEnd: documentChunks.pageEnd,
      filename: documents.originalFilename,
      score: keywordRank,
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documents.id, documentChunks.documentId))
    .where(
      and(
        eq(documentChunks.courseId, courseId),
        sql`${textVector} @@ ${searchQuery}`,
      ),
    )
    .orderBy(desc(keywordRank))
    .limit(40);

  let semanticRows: (RetrievalCandidate & { score: number })[] = [];
  let model: string | null = null;
  try {
    const embedded = await generateEmbeddings([query]);
    model = embedded.model;
    const vectorLiteral = `[${embedded.embeddings[0].join(",")}]`;
    const distance = sql<number>`${documentChunks.embedding} <=> ${vectorLiteral}::vector`;
    semanticRows = await db
      .select({
        id: documentChunks.id,
        content: documentChunks.content,
        pageStart: documentChunks.pageStart,
        pageEnd: documentChunks.pageEnd,
        filename: documents.originalFilename,
        score: sql<number>`1 - (${distance})`,
      })
      .from(documentChunks)
      .innerJoin(documents, eq(documents.id, documentChunks.documentId))
      .where(
        and(
          eq(documentChunks.courseId, courseId),
          isNotNull(documentChunks.embedding),
        ),
      )
      .orderBy(asc(distance))
      .limit(40);
  } catch (error) {
    logger.warn("knowledge.semantic_fallback", {
      userId,
      courseId,
      ...errorFingerprint(error),
    });
  }

  return {
    results: fuseKnowledgeResults(keywordRows, semanticRows, limit),
    mode: model ? ("hybrid" as const) : ("keyword" as const),
    model,
  };
}

export const searchKnowledgeBase = cache(
  async (courseId: string, rawQuery: string) => {
    const user = await requireUser();
    return retrieveCourseKnowledge(courseId, user.id, rawQuery);
  },
);
