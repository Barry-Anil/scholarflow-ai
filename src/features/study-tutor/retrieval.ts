import "server-only";

import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";

import { generateEmbeddings } from "@/features/knowledge/embeddings";
import { getDatabase } from "@/lib/db";
import { studyChunks, studyDocuments, studySections } from "@/lib/db/schema";
import { errorFingerprint } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";

type Candidate = {
  id: string;
  sectionId: string;
  sectionTitle: string;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
  filename: string;
};

function fuse(
  keyword: (Candidate & { score: number })[],
  semantic: (Candidate & { score: number })[],
) {
  const rows = new Map<string, Candidate & { rank: number }>();
  keyword.forEach((row, index) =>
    rows.set(row.id, { ...row, rank: 1 / (60 + index + 1) }),
  );
  semantic.forEach((row, index) => {
    const existing = rows.get(row.id);
    rows.set(row.id, {
      ...row,
      rank: (existing?.rank ?? 0) + 1 / (60 + index + 1),
    });
  });
  return [...rows.values()].sort((a, b) => b.rank - a.rank).slice(0, 10);
}

export async function retrieveStudyContext(
  sessionId: string,
  ownerId: string,
  rawQuery: string,
  sectionId?: string,
) {
  const query = rawQuery.trim().slice(0, 300);
  const db = getDatabase();
  const vector = sql`to_tsvector('english', ${studyChunks.content})`;
  const search = sql`websearch_to_tsquery('english', ${query})`;
  const keywordRank = sql<number>`ts_rank(${vector}, ${search})`;
  const baseWhere = and(
    eq(studyChunks.sessionId, sessionId),
    eq(studyChunks.ownerId, ownerId),
    sectionId ? eq(studyChunks.sectionId, sectionId) : undefined,
  );
  let keyword =
    query.length >= 2
      ? await db
          .select({
            id: studyChunks.id,
            sectionId: studyChunks.sectionId,
            sectionTitle: studySections.title,
            content: studyChunks.content,
            pageStart: studyChunks.pageStart,
            pageEnd: studyChunks.pageEnd,
            filename: studyDocuments.originalFilename,
            score: keywordRank,
          })
          .from(studyChunks)
          .innerJoin(studySections, eq(studySections.id, studyChunks.sectionId))
          .innerJoin(
            studyDocuments,
            eq(studyDocuments.id, studyChunks.documentId),
          )
          .where(and(baseWhere, sql`${vector} @@ ${search}`))
          .orderBy(desc(keywordRank))
          .limit(30)
      : [];
  if (!keyword.length && sectionId) {
    keyword = await db
      .select({
        id: studyChunks.id,
        sectionId: studyChunks.sectionId,
        sectionTitle: studySections.title,
        content: studyChunks.content,
        pageStart: studyChunks.pageStart,
        pageEnd: studyChunks.pageEnd,
        filename: studyDocuments.originalFilename,
        score: sql<number>`0`,
      })
      .from(studyChunks)
      .innerJoin(studySections, eq(studySections.id, studyChunks.sectionId))
      .innerJoin(studyDocuments, eq(studyDocuments.id, studyChunks.documentId))
      .where(baseWhere)
      .orderBy(asc(studyChunks.chunkIndex))
      .limit(10);
  }

  let semantic: (Candidate & { score: number })[] = [];
  let mode: "keyword" | "hybrid" = "keyword";
  try {
    const embedded = await generateEmbeddings([query]);
    const literal = `[${embedded.embeddings[0].join(",")}]`;
    const distance = sql<number>`${studyChunks.embedding} <=> ${literal}::vector`;
    semantic = await db
      .select({
        id: studyChunks.id,
        sectionId: studyChunks.sectionId,
        sectionTitle: studySections.title,
        content: studyChunks.content,
        pageStart: studyChunks.pageStart,
        pageEnd: studyChunks.pageEnd,
        filename: studyDocuments.originalFilename,
        score: sql<number>`1 - (${distance})`,
      })
      .from(studyChunks)
      .innerJoin(studySections, eq(studySections.id, studyChunks.sectionId))
      .innerJoin(studyDocuments, eq(studyDocuments.id, studyChunks.documentId))
      .where(and(baseWhere, isNotNull(studyChunks.embedding)))
      .orderBy(asc(distance))
      .limit(30);
    mode = "hybrid";
  } catch (error) {
    logger.warn("study.semantic_fallback", {
      userId: ownerId,
      sessionId,
      ...errorFingerprint(error),
    });
  }
  return { results: fuse(keyword, semantic), mode };
}
