import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getOptionalUser } from "@/lib/auth/session";
import { getDatabase } from "@/lib/db";
import { studyProgress, studySections, studySessions } from "@/lib/db/schema";
import { AppError, safeErrorMessage } from "@/lib/errors";
import { enforceUserRateLimit } from "@/lib/security/rate-limit";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["view", "complete", "uncomplete"]),
    sessionId: z.uuid(),
    sectionId: z.uuid(),
  }),
  z.object({
    action: z.literal("settings"),
    sessionId: z.uuid(),
    provider: z.enum(["browser", "inworld"]),
    voiceId: z.string().trim().max(160).nullable(),
    playbackRate: z.number().min(0.5).max(2),
  }),
]);

export async function POST(request: Request) {
  const user = await getOptionalUser();
  if (!user)
    return NextResponse.json(
      { error: "Sign in to update progress." },
      { status: 401 },
    );
  try {
    await enforceUserRateLimit(user.id, "study.mutate");
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success)
      throw new AppError("INVALID_INPUT", "The progress update is invalid.", {
        status: 400,
      });
    const db = getDatabase();
    const [session] = await db
      .select({ id: studySessions.id })
      .from(studySessions)
      .where(
        and(
          eq(studySessions.id, parsed.data.sessionId),
          eq(studySessions.ownerId, user.id),
        ),
      )
      .limit(1);
    if (!session)
      throw new AppError("FORBIDDEN", "This study session is unavailable.", {
        status: 404,
      });
    if (parsed.data.action === "settings") {
      await db
        .update(studySessions)
        .set({
          preferredTtsProvider: parsed.data.provider,
          preferredVoiceId: parsed.data.voiceId,
          playbackRate: parsed.data.playbackRate.toFixed(2),
          lastActivityAt: new Date(),
        })
        .where(eq(studySessions.id, session.id));
      return NextResponse.json({ ok: true });
    }
    const [section] = await db
      .select({ id: studySections.id })
      .from(studySections)
      .where(
        and(
          eq(studySections.id, parsed.data.sectionId),
          eq(studySections.sessionId, session.id),
          eq(studySections.ownerId, user.id),
        ),
      )
      .limit(1);
    if (!section)
      throw new AppError("INVALID_INPUT", "This section is unavailable.", {
        status: 404,
      });
    const completedAt = parsed.data.action === "complete" ? new Date() : null;
    await db.transaction(async (tx) => {
      const progressUpdate =
        parsed.data.action === "view"
          ? { lastViewedAt: new Date() }
          : { lastViewedAt: new Date(), completedAt };
      await tx
        .insert(studyProgress)
        .values({
          sessionId: session.id,
          sectionId: section.id,
          ownerId: user.id,
          completedAt,
        })
        .onConflictDoUpdate({
          target: [studyProgress.sessionId, studyProgress.sectionId],
          set: progressUpdate,
        });
      await tx
        .update(studySessions)
        .set({ currentSectionId: section.id, lastActivityAt: new Date() })
        .where(eq(studySessions.id, session.id));
    });
    return NextResponse.json({ ok: true, completed: Boolean(completedAt) });
  } catch (error) {
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: error instanceof AppError ? error.status : 500 },
    );
  }
}
