import "server-only";

import { and, asc, count, desc, eq } from "drizzle-orm";
import { cache } from "react";

import { requireUser } from "@/lib/auth/session";
import { getDatabase } from "@/lib/db";
import {
  studyDocuments,
  studyExplanations,
  studyMessages,
  studyProgress,
  studySections,
  studySessions,
} from "@/lib/db/schema";
import { readStudyDocumentProgress } from "./processing-progress";

export const getStudyTutorHomeData = cache(async () => {
  const user = await requireUser();
  const db = getDatabase();
  const rows = await db
    .select({
      id: studySessions.id,
      title: studySessions.title,
      status: studySessions.status,
      lastActivityAt: studySessions.lastActivityAt,
      createdAt: studySessions.createdAt,
      filename: studyDocuments.originalFilename,
      documentStatus: studyDocuments.status,
      metadata: studyDocuments.extractionMetadata,
      sectionCount: count(studySections.id),
    })
    .from(studySessions)
    .leftJoin(studyDocuments, eq(studyDocuments.sessionId, studySessions.id))
    .leftJoin(studySections, eq(studySections.sessionId, studySessions.id))
    .where(eq(studySessions.ownerId, user.id))
    .groupBy(studySessions.id, studyDocuments.id)
    .orderBy(desc(studySessions.lastActivityAt));
  return {
    sessions: rows.map(({ metadata, documentStatus, ...session }) => ({
      ...session,
      processing: readStudyDocumentProgress(
        metadata,
        documentStatus ?? session.status,
      ),
    })),
  };
});

export const getStudySessionData = cache(async (sessionId: string) => {
  const user = await requireUser();
  const db = getDatabase();
  const [session] = await db
    .select({
      id: studySessions.id,
      title: studySessions.title,
      status: studySessions.status,
      currentSectionId: studySessions.currentSectionId,
      preferredTtsProvider: studySessions.preferredTtsProvider,
      preferredVoiceId: studySessions.preferredVoiceId,
      playbackRate: studySessions.playbackRate,
      filename: studyDocuments.originalFilename,
      errorMessage: studyDocuments.errorMessage,
      metadata: studyDocuments.extractionMetadata,
    })
    .from(studySessions)
    .leftJoin(studyDocuments, eq(studyDocuments.sessionId, studySessions.id))
    .where(
      and(eq(studySessions.id, sessionId), eq(studySessions.ownerId, user.id)),
    )
    .limit(1);
  if (!session) return null;
  const [sections, progress, messages, explanations] = await Promise.all([
    db
      .select({
        id: studySections.id,
        position: studySections.position,
        title: studySections.title,
        content: studySections.content,
        pageStart: studySections.pageStart,
        pageEnd: studySections.pageEnd,
      })
      .from(studySections)
      .where(
        and(
          eq(studySections.sessionId, session.id),
          eq(studySections.ownerId, user.id),
        ),
      )
      .orderBy(asc(studySections.position)),
    db
      .select({
        sectionId: studyProgress.sectionId,
        completedAt: studyProgress.completedAt,
      })
      .from(studyProgress)
      .where(
        and(
          eq(studyProgress.sessionId, session.id),
          eq(studyProgress.ownerId, user.id),
        ),
      ),
    db
      .select({
        id: studyMessages.id,
        role: studyMessages.role,
        content: studyMessages.content,
        supportLevel: studyMessages.supportLevel,
        references: studyMessages.references,
        metadata: studyMessages.metadata,
        createdAt: studyMessages.createdAt,
      })
      .from(studyMessages)
      .where(
        and(
          eq(studyMessages.sessionId, session.id),
          eq(studyMessages.ownerId, user.id),
        ),
      )
      .orderBy(asc(studyMessages.createdAt))
      .limit(100),
    db
      .select({
        id: studyExplanations.id,
        sectionId: studyExplanations.sectionId,
        mode: studyExplanations.mode,
        content: studyExplanations.content,
        references: studyExplanations.references,
        createdAt: studyExplanations.createdAt,
      })
      .from(studyExplanations)
      .where(
        and(
          eq(studyExplanations.sessionId, session.id),
          eq(studyExplanations.ownerId, user.id),
        ),
      )
      .orderBy(desc(studyExplanations.createdAt))
      .limit(50),
  ]);
  return { session, sections, progress, messages, explanations };
});
