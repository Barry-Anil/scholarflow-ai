"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth/session";
import { requireCourseAccess } from "@/lib/auth/course-access";
import { getDatabase } from "@/lib/db";
import { courseMembers } from "@/lib/db/schema";
import { AppError, errorFingerprint, safeErrorMessage } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { enforceUserRateLimit } from "@/lib/security/rate-limit";

const memberSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  role: z.enum(["editor", "viewer"]),
});
const changeSchema = z.object({
  memberId: z.uuid(),
  role: z.enum(["editor", "viewer"]),
});

export type MemberActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

export async function addCourseMemberAction(
  courseId: string,
  _state: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const user = await requireUser();
  const parsed = memberSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!z.uuid().safeParse(courseId).success || !parsed.success) {
    return {
      status: "error",
      message:
        parsed.error?.issues[0]?.message ?? "Enter a valid member account.",
    };
  }

  try {
    await enforceUserRateLimit(user.id, "course.membership");
    const access = await requireCourseAccess(courseId, user.id, "manage");
    const db = getDatabase();
    const users = await db.execute<{ id: string; email: string }>(sql`
      select id, email
      from auth.users
      where lower(email) = ${parsed.data.email}
      limit 1
    `);
    const target = users[0];
    if (!target) {
      throw new AppError(
        "INVALID_INPUT",
        "No registered ScholarFlow account uses that email address.",
      );
    }
    if (target.id === access.ownerId) {
      throw new AppError(
        "INVALID_INPUT",
        "The course owner already has full access.",
      );
    }

    await db
      .insert(courseMembers)
      .values({
        courseId,
        userId: target.id,
        role: parsed.data.role,
      })
      .onConflictDoUpdate({
        target: [courseMembers.courseId, courseMembers.userId],
        set: { role: parsed.data.role },
      });
    revalidatePath(`/dashboard/courses/${courseId}/members`);
    return {
      status: "success",
      message: `${target.email} now has ${parsed.data.role} access.`,
    };
  } catch (error) {
    logger.error("course.member_add_failed", {
      userId: user.id,
      courseId,
      ...errorFingerprint(error),
    });
    return { status: "error", message: safeErrorMessage(error) };
  }
}

export async function changeCourseMemberRoleAction(
  courseId: string,
  memberId: string,
  formData: FormData,
) {
  const user = await requireUser();
  const parsed = changeSchema.safeParse({
    memberId,
    role: formData.get("role"),
  });
  if (!z.uuid().safeParse(courseId).success || !parsed.success) return;

  try {
    await enforceUserRateLimit(user.id, "course.membership");
    await requireCourseAccess(courseId, user.id, "manage");
    await getDatabase()
      .update(courseMembers)
      .set({ role: parsed.data.role })
      .where(
        and(
          eq(courseMembers.id, parsed.data.memberId),
          eq(courseMembers.courseId, courseId),
          sql`${courseMembers.role} <> 'owner'::course_member_role`,
        ),
      );
  } catch (error) {
    logger.error("course.member_role_failed", {
      userId: user.id,
      courseId,
      ...errorFingerprint(error),
    });
  }
  revalidatePath(`/dashboard/courses/${courseId}/members`);
}

export async function removeCourseMemberAction(
  courseId: string,
  memberId: string,
) {
  const user = await requireUser();
  if (
    !z.uuid().safeParse(courseId).success ||
    !z.uuid().safeParse(memberId).success
  )
    return;

  try {
    await enforceUserRateLimit(user.id, "course.membership");
    await requireCourseAccess(courseId, user.id, "manage");
    await getDatabase()
      .delete(courseMembers)
      .where(
        and(
          eq(courseMembers.id, memberId),
          eq(courseMembers.courseId, courseId),
          sql`${courseMembers.role} <> 'owner'::course_member_role`,
        ),
      );
  } catch (error) {
    logger.error("course.member_remove_failed", {
      userId: user.id,
      courseId,
      ...errorFingerprint(error),
    });
  }
  revalidatePath(`/dashboard/courses/${courseId}/members`);
}
