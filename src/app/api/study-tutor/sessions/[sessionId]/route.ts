import { and, count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { STUDY_STORAGE_BUCKET } from "@/features/study-tutor/constants";
import { getOptionalUser } from "@/lib/auth/session";
import { getDatabase } from "@/lib/db";
import { studyDocuments, studySections, studySessions } from "@/lib/db/schema";
import { enforceUserRateLimit } from "@/lib/security/rate-limit";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const user = await getOptionalUser();
  if (!user)
    return NextResponse.json(
      { error: "Sign in to view this session." },
      { status: 401 },
    );
  const { sessionId } = await context.params;
  const [session] = await getDatabase()
    .select({
      status: studySessions.status,
      documentStatus: studyDocuments.status,
      error: studyDocuments.errorMessage,
      sectionCount: count(studySections.id),
    })
    .from(studySessions)
    .leftJoin(studyDocuments, eq(studyDocuments.sessionId, studySessions.id))
    .leftJoin(studySections, eq(studySections.sessionId, studySessions.id))
    .where(
      and(eq(studySessions.id, sessionId), eq(studySessions.ownerId, user.id)),
    )
    .groupBy(studySessions.id, studyDocuments.id)
    .limit(1);
  if (!session)
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  return NextResponse.json(session, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const user = await getOptionalUser();
  if (!user)
    return NextResponse.json(
      { error: "Sign in to delete this session." },
      { status: 401 },
    );
  await enforceUserRateLimit(user.id, "study.mutate");
  const { sessionId } = await context.params;
  const db = getDatabase();
  const [document] = await db
    .select({ path: studyDocuments.storagePath })
    .from(studyDocuments)
    .innerJoin(studySessions, eq(studySessions.id, studyDocuments.sessionId))
    .where(
      and(eq(studySessions.id, sessionId), eq(studySessions.ownerId, user.id)),
    )
    .limit(1);
  if (!document)
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  const { error } = await getSupabaseAdminClient()
    .storage.from(STUDY_STORAGE_BUCKET)
    .remove([document.path]);
  if (error)
    return NextResponse.json(
      { error: "The stored notes could not be removed." },
      { status: 502 },
    );
  await db
    .delete(studySessions)
    .where(
      and(eq(studySessions.id, sessionId), eq(studySessions.ownerId, user.id)),
    );
  return NextResponse.json({ ok: true });
}
