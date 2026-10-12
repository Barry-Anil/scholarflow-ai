import "server-only";

import { sql } from "drizzle-orm";

import { getDatabase } from "@/lib/db";
import { AppError } from "@/lib/errors";

export type CourseRole = "owner" | "editor" | "viewer";
export type CoursePermission = "read" | "edit" | "manage";

export type CourseAccess = {
  courseId: string;
  ownerId: string;
  role: CourseRole;
};

const minimumRole: Record<CoursePermission, number> = {
  read: 0,
  edit: 1,
  manage: 2,
};

const roleRank: Record<CourseRole, number> = {
  viewer: 0,
  editor: 1,
  owner: 2,
};

export function hasCoursePermission(
  role: CourseRole,
  permission: CoursePermission,
) {
  return roleRank[role] >= minimumRole[permission];
}

export async function getCourseAccess(
  courseId: string,
  userId: string,
): Promise<CourseAccess | null> {
  const rows = await getDatabase().execute<{
    course_id: string;
    owner_id: string;
    member_role: CourseRole | null;
  }>(sql`
    select
      c.id as course_id,
      c.owner_id,
      cm.role as member_role
    from courses c
    left join course_members cm
      on cm.course_id = c.id
      and cm.user_id = ${userId}
    where c.id = ${courseId}
      and (c.owner_id = ${userId} or cm.user_id is not null)
    limit 1
  `);
  const row = rows[0];
  if (!row) return null;

  return {
    courseId: row.course_id,
    ownerId: row.owner_id,
    role: row.owner_id === userId ? "owner" : (row.member_role ?? "viewer"),
  };
}

export async function requireCourseAccess(
  courseId: string,
  userId: string,
  permission: CoursePermission = "read",
) {
  const access = await getCourseAccess(courseId, userId);
  if (!access || !hasCoursePermission(access.role, permission)) {
    throw new AppError(
      "FORBIDDEN",
      permission === "read"
        ? "You cannot access this course."
        : permission === "edit"
          ? "You need editor access to change this course."
          : "Only the course owner can manage members.",
      { status: 403 },
    );
  }
  return access;
}

export async function requireAssignmentAccess(
  assignmentId: string,
  userId: string,
  permission: CoursePermission = "read",
) {
  const rows = await getDatabase().execute<{
    assignment_id: string;
    course_id: string;
    owner_id: string;
    title: string;
  }>(sql`
    select
      a.id as assignment_id,
      a.course_id,
      a.owner_id,
      a.title
    from assignments a
    where a.id = ${assignmentId}
    limit 1
  `);
  const assignment = rows[0];
  if (!assignment) {
    throw new AppError("FORBIDDEN", "The assignment is unavailable.", {
      status: 404,
    });
  }
  const access = await requireCourseAccess(
    assignment.course_id,
    userId,
    permission,
  );
  return {
    ...access,
    assignmentId: assignment.assignment_id,
    assignmentOwnerId: assignment.owner_id,
    title: assignment.title,
  };
}

export async function getAccessibleCourseIds(userId: string) {
  const rows = await getDatabase().execute<{ id: string }>(sql`
    select c.id
    from courses c
    where c.owner_id = ${userId}
      or exists (
        select 1
        from course_members cm
        where cm.course_id = c.id and cm.user_id = ${userId}
      )
    order by c.updated_at desc
  `);
  return rows.map((row) => row.id);
}
