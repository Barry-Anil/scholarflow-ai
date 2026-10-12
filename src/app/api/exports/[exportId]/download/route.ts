import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { EXPORT_BUCKET } from "@/features/exports/contracts";
import { getOptionalUser } from "@/lib/auth/session";
import { requireAssignmentAccess } from "@/lib/auth/course-access";
import { getDatabase } from "@/lib/db";
import { assignments, exportRecords } from "@/lib/db/schema";
import { AppError, safeErrorMessage } from "@/lib/errors";
import { enforceUserRateLimit } from "@/lib/security/rate-limit";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  context: { params: Promise<{ exportId: string }> },
) {
  const user = await getOptionalUser();
  if (!user)
    return NextResponse.json(
      { message: "Sign in to continue." },
      { status: 401 },
    );
  const parsed = z.uuid().safeParse((await context.params).exportId);
  if (!parsed.success)
    return NextResponse.json({ message: "Invalid export." }, { status: 400 });
  try {
    await enforceUserRateLimit(user.id, "export.download");
  } catch (error) {
    return NextResponse.json(
      { message: safeErrorMessage(error) },
      { status: error instanceof AppError ? error.status : 500 },
    );
  }

  const db = getDatabase();
  const [record] = await db
    .select({
      path: exportRecords.storagePath,
      filename: exportRecords.filename,
      assignmentId: exportRecords.assignmentId,
    })
    .from(exportRecords)
    .innerJoin(assignments, eq(assignments.id, exportRecords.assignmentId))
    .where(
      and(
        eq(exportRecords.id, parsed.data),
        eq(exportRecords.status, "completed"),
      ),
    )
    .limit(1);
  if (!record?.path)
    return NextResponse.json(
      { message: "The export is not available." },
      { status: 404 },
    );
  try {
    await requireAssignmentAccess(record.assignmentId, user.id, "read");
  } catch {
    return NextResponse.json(
      { message: "The export is not available." },
      { status: 404 },
    );
  }
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.storage
    .from(EXPORT_BUCKET)
    .createSignedUrl(record.path, 60, {
      download: record.filename ?? true,
    });
  if (error || !data.signedUrl)
    return NextResponse.json(
      { message: "A secure download link could not be created." },
      { status: 500 },
    );
  return NextResponse.redirect(data.signedUrl, 307);
}
