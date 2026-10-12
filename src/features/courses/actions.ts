"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth/session";
import { getDatabase } from "@/lib/db";
import { courseMembers, courses } from "@/lib/db/schema";
import { AppError, errorFingerprint, safeErrorMessage } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { enforceUserRateLimit } from "@/lib/security/rate-limit";

const createCourseSchema = z.object({
  code: z.string().trim().max(48).optional(),
  title: z.string().trim().min(2, "Enter a course title.").max(240),
});

export type CourseActionState = {
  status: "idle" | "error" | "success";
  message?: string;
};

export async function createCourseAction(
  _state: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  const user = await requireUser();
  const parsed = createCourseSchema.safeParse({
    code: formData.get("code") || undefined,
    title: formData.get("title"),
  });
  if (!parsed.success)
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid course.",
    };

  try {
    await enforceUserRateLimit(user.id, "course.create");
    const db = getDatabase();
    await db.transaction(async (tx) => {
      const [course] = await tx
        .insert(courses)
        .values({
          ownerId: user.id,
          title: parsed.data.title,
          code: parsed.data.code || null,
        })
        .returning({ id: courses.id });
      if (!course) {
        throw new AppError(
          "UNEXPECTED_ERROR",
          "The course could not be created.",
        );
      }
      await tx
        .insert(courseMembers)
        .values({ courseId: course.id, userId: user.id, role: "owner" });
    });
    logger.info("course.created", { userId: user.id });
    revalidatePath("/dashboard");
    return { status: "success", message: "Course created." };
  } catch (error) {
    logger.error("course.create_failed", {
      userId: user.id,
      ...errorFingerprint(error),
    });
    return {
      status: "error",
      message: safeErrorMessage(
        error instanceof AppError
          ? error
          : new AppError(
              "DATABASE_UNAVAILABLE",
              "Course creation is temporarily unavailable.",
              { cause: error },
            ),
      ),
    };
  }
}
