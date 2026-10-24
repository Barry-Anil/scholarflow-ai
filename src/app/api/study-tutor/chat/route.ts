import { and, asc, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { answerStudyQuestion } from "@/features/study-tutor/ai";
import { chatRequestSchema } from "@/features/study-tutor/contracts";
import { retrieveStudyContext } from "@/features/study-tutor/retrieval";
import { getOptionalUser } from "@/lib/auth/session";
import { getDatabase } from "@/lib/db";
import {
  studyMessages,
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
      { error: "Sign in to ask the tutor." },
      { status: 401 },
    );
  try {
    await enforceUserRateLimit(user.id, "study.ai");
    const parsed = chatRequestSchema.safeParse(await request.json());
    if (!parsed.success)
      throw new AppError("INVALID_INPUT", "Enter a valid question.", {
        status: 400,
      });
    const db = getDatabase();
    const [session] = await db
      .select({ id: studySessions.id, status: studySessions.status })
      .from(studySessions)
      .where(
        and(
          eq(studySessions.id, parsed.data.sessionId),
          eq(studySessions.ownerId, user.id),
        ),
      )
      .limit(1);
    if (!session || session.status !== "ready") {
      throw new AppError("FORBIDDEN", "This study session is unavailable.", {
        status: 404,
      });
    }
    const [retrieval, recentDesc] = await Promise.all([
      retrieveStudyContext(
        session.id,
        user.id,
        parsed.data.message,
        parsed.data.sectionId,
      ),
      db
        .select({ role: studyMessages.role, content: studyMessages.content })
        .from(studyMessages)
        .where(
          and(
            eq(studyMessages.sessionId, session.id),
            eq(studyMessages.ownerId, user.id),
          ),
        )
        .orderBy(desc(studyMessages.createdAt))
        .limit(8),
    ]);
    const history = recentDesc
      .reverse()
      .filter(
        (message) => message.role === "user" || message.role === "assistant",
      )
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
      }));
    const generated = await answerStudyQuestion({
      ownerId: user.id,
      question: parsed.data.message,
      history,
      sources: retrieval.results,
    });
    const used = new Set(generated.answer.sourceIds);
    const references: StudySourceReference[] = retrieval.results
      .filter((source) => used.has(source.id))
      .map((source) => ({
        chunkId: source.id,
        sectionId: source.sectionId,
        sectionTitle: source.sectionTitle,
        pageStart: source.pageStart ?? undefined,
        pageEnd: source.pageEnd ?? undefined,
        excerpt: source.content.slice(0, 280),
      }));
    await db.transaction(async (tx) => {
      await tx.insert(studyMessages).values([
        {
          sessionId: session.id,
          ownerId: user.id,
          role: "user",
          content: parsed.data.message,
        },
        {
          sessionId: session.id,
          ownerId: user.id,
          role: "assistant",
          content: generated.answer.answer,
          supportLevel: generated.answer.supportLevel,
          references,
          metadata: {
            suggestedQuestions: generated.answer.suggestedQuestions,
            retrievalMode: retrieval.mode,
          },
        },
      ]);
      await tx
        .update(studySessions)
        .set({ lastActivityAt: new Date() })
        .where(eq(studySessions.id, session.id));
    });
    return NextResponse.json({
      ...generated.answer,
      references,
      retrievalMode: retrieval.mode,
    });
  } catch (error) {
    logger.error("study.chat_failed", {
      userId: user.id,
      ...errorFingerprint(error),
    });
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: error instanceof AppError ? error.status : 500 },
    );
  }
}
