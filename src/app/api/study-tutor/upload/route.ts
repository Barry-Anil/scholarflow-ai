import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import {
  MAX_STUDY_DOCUMENT_BYTES,
  resolveStudyMime,
  safeStudyFilename,
  STUDY_DOCUMENT_JOB_TYPE,
  STUDY_STORAGE_BUCKET,
} from "@/features/study-tutor/constants";
import { validateStudyFileSignature } from "@/features/study-tutor/extract";
import { getOptionalUser } from "@/lib/auth/session";
import { getDatabase } from "@/lib/db";
import { processingJobs, studyDocuments, studySessions } from "@/lib/db/schema";
import { AppError, errorFingerprint, safeErrorMessage } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { enforceUserRateLimit } from "@/lib/security/rate-limit";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const user = await getOptionalUser();
  if (!user)
    return NextResponse.json(
      { error: "Sign in to upload notes." },
      { status: 401 },
    );
  try {
    await enforceUserRateLimit(user.id, "study.upload");
    const form = await request.formData();
    const file = form.get("document");
    if (!(file instanceof File)) {
      throw new AppError("INVALID_INPUT", "Choose a document to upload.", {
        status: 400,
      });
    }
    if (!file.size || file.size > MAX_STUDY_DOCUMENT_BYTES) {
      throw new AppError(
        "INVALID_INPUT",
        "Documents must be between 1 byte and 25 MB.",
        {
          status: 413,
        },
      );
    }
    const mimeType = resolveStudyMime(file.name, file.type);
    if (!mimeType) {
      throw new AppError(
        "INVALID_INPUT",
        "Supported formats are PDF, DOCX, PPTX, and TXT.",
        {
          status: 415,
        },
      );
    }
    const bytes = await file.arrayBuffer();
    validateStudyFileSignature(new Uint8Array(bytes), mimeType);
    const sha256 = createHash("sha256")
      .update(Buffer.from(bytes))
      .digest("hex");
    const db = getDatabase();
    const [duplicate] = await db
      .select({ sessionId: studyDocuments.sessionId })
      .from(studyDocuments)
      .where(
        and(
          eq(studyDocuments.ownerId, user.id),
          eq(studyDocuments.sha256, sha256),
        ),
      )
      .limit(1);
    if (duplicate) {
      return NextResponse.json({
        sessionId: duplicate.sessionId,
        duplicate: true,
      });
    }

    const sessionId = randomUUID();
    const documentId = randomUUID();
    const jobId = randomUUID();
    const title =
      file.name.replace(/\.[^.]+$/, "").slice(0, 240) || "Study notes";
    const storagePath = `${user.id}/${sessionId}/${documentId}/${safeStudyFilename(file.name)}`;
    const storage = getSupabaseAdminClient().storage.from(STUDY_STORAGE_BUCKET);
    const { error: uploadError } = await storage.upload(
      storagePath,
      Buffer.from(bytes),
      {
        contentType: mimeType,
        upsert: false,
      },
    );
    if (uploadError) {
      throw new AppError("UNEXPECTED_ERROR", "The notes could not be stored.", {
        cause: uploadError,
      });
    }
    try {
      await db.transaction(async (tx) => {
        await tx.insert(studySessions).values({
          id: sessionId,
          ownerId: user.id,
          title,
          status: "processing",
        });
        await tx.insert(studyDocuments).values({
          id: documentId,
          sessionId,
          ownerId: user.id,
          originalFilename: file.name.slice(0, 500),
          mimeType,
          sizeBytes: file.size,
          storagePath,
          sha256,
          status: "queued",
        });
        await tx.insert(processingJobs).values({
          id: jobId,
          ownerId: user.id,
          type: STUDY_DOCUMENT_JOB_TYPE,
          status: "queued",
          maxAttempts: 3,
          payload: { sessionId, documentId, storagePath, mimeType, title },
        });
      });
    } catch (error) {
      await storage.remove([storagePath]);
      throw error;
    }
    return NextResponse.json(
      { sessionId, jobId, duplicate: false, status: "queued" },
      { status: 202 },
    );
  } catch (error) {
    logger.error("study.upload_failed", {
      userId: user.id,
      ...errorFingerprint(error),
    });
    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json({ error: safeErrorMessage(error) }, { status });
  }
}
