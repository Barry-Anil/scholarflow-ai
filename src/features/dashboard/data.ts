import "server-only";

import { and, count, desc, eq, inArray } from "drizzle-orm";
import { cache } from "react";

import { requireUser } from "@/lib/auth/session";
import { getAccessibleCourseIds } from "@/lib/auth/course-access";
import { getDatabase } from "@/lib/db";
import { assignments, courses, processingJobs } from "@/lib/db/schema";
import { AppError, errorFingerprint } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";

export const getWorkspaceOverview = cache(async () => {
  const user = await requireUser();
  const db = getDatabase();

  try {
    const courseIds = await getAccessibleCourseIds(user.id);
    if (!courseIds.length) {
      return {
        user: {
          id: user.id,
          email: user.email ?? "Student",
          displayName: user.user_metadata.display_name as string | undefined,
        },
        metrics: {
          courses: 0,
          activeAssignments: 0,
          awaitingApproval: 0,
          failedJobs: 0,
        },
        recentCourses: [],
      };
    }
    const [
      courseCount,
      activeAssignments,
      awaitingApproval,
      failedJobs,
      recentCourses,
    ] = await Promise.all([
      db
        .select({ value: count() })
        .from(courses)
        .where(inArray(courses.id, courseIds)),
      db
        .select({ value: count() })
        .from(assignments)
        .where(
          and(
            inArray(assignments.courseId, courseIds),
            inArray(assignments.status, [
              "READY",
              "PLANNING",
              "RESEARCHING",
              "DRAFTING",
              "REVIEWING",
              "REVISING",
              "FINAL_REVIEW",
            ]),
          ),
        ),
      db
        .select({ value: count() })
        .from(assignments)
        .where(
          and(
            inArray(assignments.courseId, courseIds),
            eq(assignments.status, "READY_FOR_STUDENT_APPROVAL"),
          ),
        ),
      db
        .select({ value: count() })
        .from(processingJobs)
        .where(
          and(
            inArray(processingJobs.courseId, courseIds),
            eq(processingJobs.status, "failed"),
          ),
        ),
      db
        .select({
          id: courses.id,
          code: courses.code,
          title: courses.title,
          createdAt: courses.createdAt,
        })
        .from(courses)
        .where(inArray(courses.id, courseIds))
        .orderBy(desc(courses.createdAt))
        .limit(4),
    ]);

    return {
      user: {
        id: user.id,
        email: user.email ?? "Student",
        displayName: user.user_metadata.display_name as string | undefined,
      },
      metrics: {
        courses: courseCount[0]?.value ?? 0,
        activeAssignments: activeAssignments[0]?.value ?? 0,
        awaitingApproval: awaitingApproval[0]?.value ?? 0,
        failedJobs: failedJobs[0]?.value ?? 0,
      },
      recentCourses,
    };
  } catch (error) {
    logger.error("dashboard.overview_failed", {
      userId: user.id,
      ...errorFingerprint(error),
    });
    throw new AppError(
      "DATABASE_UNAVAILABLE",
      "Workspace data is temporarily unavailable.",
      { cause: error, status: 503 },
    );
  }
});
