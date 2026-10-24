import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { generateStudyLesson } from "@/features/study-tutor/ai";
import { explainRequestSchema } from "@/features/study-tutor/contracts";
import { getOptionalUser } from "@/lib/auth/session";
import { getDatabase } from "@/lib/db";
import {
  studyChunks,
  studyExplanations,
  studySections,
  studySessions,
  type StudySourceReference,
} from "@/lib/db/schema";
import { AppError, errorFingerprint, safeErrorMessage } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { enforceUserRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const user = await getOptionalUser();
  if (!user)
    return NextResponse.json(
      { error: "Sign in to generate a lesson." },
      { status: 401 },
    );
  try {
    await enforceUserRateLimit(user.id, "study.ai");
    const parsed = explainRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new AppError(
        "INVALID_INPUT",
        "Choose a valid section and lesson mode.",
        { status: 400 },
      );
    }
    const db = getDatabase();
    const [section] = await db
      .select({ id: studySections.id, title: studySections.title })
      .from(studySections)
      .where(
        and(
          eq(studySections.id, parsed.data.sectionId),
          eq(studySections.sessionId, parsed.data.sessionId),
          eq(studySections.ownerId, user.id),
        ),
      )
      .limit(1);
    if (!section)
      throw new AppError("FORBIDDEN", "This study section is unavailable.", {
        status: 404,
      });
    const sources = await db
      .select({
        id: studyChunks.id,
        sectionId: studyChunks.sectionId,
        sectionTitle: studySections.title,
        content: studyChunks.content,
        pageStart: studyChunks.pageStart,
        pageEnd: studyChunks.pageEnd,
      })
      .from(studyChunks)
      .innerJoin(studySections, eq(studySections.id, studyChunks.sectionId))
      .where(
        and(
          eq(studyChunks.sectionId, section.id),
          eq(studyChunks.ownerId, user.id),
        ),
      )
      .orderBy(asc(studyChunks.chunkIndex))
      .limit(20);
    if (!sources.length)
      throw new AppError(
        "INVALID_INPUT",
        "This section has no readable source text.",
        { status: 422 },
      );
    const generated = await generateStudyLesson({
      ownerId: user.id,
      mode: parsed.data.mode,
      sectionTitle: section.title,
      sources,
    });
    const used = new Set(generated.lesson.sourceIds);
    const references: StudySourceReference[] = sources
      .filter((source) => used.has(source.id))
      .map((source) => ({
        chunkId: source.id,
        sectionId: source.sectionId,
        sectionTitle: source.sectionTitle,
        pageStart: source.pageStart ?? undefined,
        pageEnd: source.pageEnd ?? undefined,
        excerpt: source.content.slice(0, 280),
      }));
    const [saved] = await db
      .insert(studyExplanations)
      .values({
        sessionId: parsed.data.sessionId,
        sectionId: section.id,
        ownerId: user.id,
        mode: parsed.data.mode,
        content: generated.lesson,
        references,
        provider: generated.usage.provider,
        model: generated.usage.model,
      })
      .returning({
        id: studyExplanations.id,
        createdAt: studyExplanations.createdAt,
      });
    await db
      .update(studySessions)
      .set({ currentSectionId: section.id, lastActivityAt: new Date() })
      .where(
        and(
          eq(studySessions.id, parsed.data.sessionId),
          eq(studySessions.ownerId, user.id),
        ),
      );
    return NextResponse.json({
      explanationId: saved?.id,
      createdAt: saved?.createdAt,
      lesson: generated.lesson,
      references,
    });
  } catch (error) {
    logger.error("study.explanation_failed", {
      userId: user.id,
      ...errorFingerprint(error),
    });
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: error instanceof AppError ? error.status : 500 },
    );
  }
}
