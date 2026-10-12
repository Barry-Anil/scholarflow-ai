import "server-only";

import { eq, sql } from "drizzle-orm";
import { cache } from "react";

import { requireUser } from "@/lib/auth/session";
import { requireCourseAccess, type CourseRole } from "@/lib/auth/course-access";
import { getDatabase } from "@/lib/db";
import { courses } from "@/lib/db/schema";

export const getCourseMembers = cache(async (courseId: string) => {
  const user = await requireUser();
  const access = await requireCourseAccess(courseId, user.id, "read").catch(
    () => null,
  );
  if (!access) return null;
  const db = getDatabase();
  const [course] = await db
    .select({
      id: courses.id,
      code: courses.code,
      title: courses.title,
    })
    .from(courses)
    .where(eq(courses.id, courseId))
    .limit(1);
  if (!course) return null;

  const members = await db.execute<{
    id: string;
    user_id: string;
    role: CourseRole;
    created_at: Date | string;
    email: string;
    display_name: string | null;
  }>(sql`
    select
      cm.id,
      cm.user_id,
      cm.role,
      cm.created_at,
      au.email,
      p.display_name
    from course_members cm
    join auth.users au on au.id = cm.user_id
    left join profiles p on p.id = cm.user_id
    where cm.course_id = ${courseId}
    order by
      case cm.role
        when 'owner' then 0
        when 'editor' then 1
        else 2
      end,
      lower(au.email)
  `);

  return {
    course,
    role: access.role,
    members: members.map((member) => ({
      id: member.id,
      userId: member.user_id,
      role: member.role,
      email: member.email,
      displayName: member.display_name,
      createdAt:
        member.created_at instanceof Date
          ? member.created_at
          : new Date(member.created_at),
    })),
  };
});
