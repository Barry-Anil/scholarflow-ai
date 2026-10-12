import "server-only";

import { and, count, countDistinct, desc, eq, inArray } from "drizzle-orm";
import { cache } from "react";

import { requireUser } from "@/lib/auth/session";
import { getAccessibleCourseIds } from "@/lib/auth/course-access";
import { getDatabase } from "@/lib/db";
import {
  agentRuns,
  assignments,
  courses,
  documents,
  reviewFindings,
  reviewReports,
} from "@/lib/db/schema";
import {
  getAiEnv,
  getConfigurationStatus,
  getOperationsEnv,
} from "@/lib/env/server";
import { AppError, errorFingerprint } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";

async function workspaceQuery<T>(
  event: string,
  query: (context: {
    db: ReturnType<typeof getDatabase>;
    user: Awaited<ReturnType<typeof requireUser>>;
    courseIds: string[];
  }) => Promise<T>,
) {
  const user = await requireUser();

  try {
    return await query({
      db: getDatabase(),
      user,
      courseIds: await getAccessibleCourseIds(user.id),
    });
  } catch (error) {
    logger.error(event, {
      userId: user.id,
      ...errorFingerprint(error),
    });
    throw new AppError(
      "DATABASE_UNAVAILABLE",
      "Workspace data is temporarily unavailable.",
      { cause: error, status: 503 },
    );
  }
}

export const getCoursesHub = cache(() =>
  workspaceQuery("workspace.courses_failed", async ({ db, courseIds }) => {
    if (!courseIds.length) return [];
    return db
      .select({
        id: courses.id,
        code: courses.code,
        title: courses.title,
        description: courses.description,
        assignmentCount: countDistinct(assignments.id),
        documentCount: countDistinct(documents.id),
        updatedAt: courses.updatedAt,
      })
      .from(courses)
      .leftJoin(assignments, eq(assignments.courseId, courses.id))
      .leftJoin(documents, eq(documents.courseId, courses.id))
      .where(inArray(courses.id, courseIds))
      .groupBy(courses.id)
      .orderBy(desc(courses.updatedAt));
  }),
);

export const getKnowledgeHub = cache(() =>
  workspaceQuery("workspace.knowledge_failed", async ({ db, courseIds }) => {
    if (!courseIds.length) return { courses: [], documents: [] };
    const [courseRows, documentRows] = await Promise.all([
      db
        .select({
          id: courses.id,
          code: courses.code,
          title: courses.title,
          documentCount: count(documents.id),
        })
        .from(courses)
        .leftJoin(documents, eq(documents.courseId, courses.id))
        .where(inArray(courses.id, courseIds))
        .groupBy(courses.id)
        .orderBy(desc(courses.updatedAt)),
      db
        .select({
          id: documents.id,
          filename: documents.originalFilename,
          status: documents.status,
          sizeBytes: documents.sizeBytes,
          createdAt: documents.createdAt,
          courseId: courses.id,
          courseCode: courses.code,
          courseTitle: courses.title,
        })
        .from(documents)
        .innerJoin(courses, eq(courses.id, documents.courseId))
        .where(inArray(courses.id, courseIds))
        .orderBy(desc(documents.createdAt))
        .limit(50),
    ]);

    return { courses: courseRows, documents: documentRows };
  }),
);

export const getActivityHub = cache(() =>
  workspaceQuery("workspace.activity_failed", async ({ db, courseIds }) => {
    if (!courseIds.length) return [];
    return db
      .select({
        id: agentRuns.id,
        agent: agentRuns.agent,
        status: agentRuns.status,
        workflowState: agentRuns.workflowState,
        provider: agentRuns.provider,
        model: agentRuns.model,
        createdAt: agentRuns.createdAt,
        completedAt: agentRuns.completedAt,
        assignmentId: assignments.id,
        assignmentTitle: assignments.title,
        courseId: courses.id,
        courseCode: courses.code,
        courseTitle: courses.title,
      })
      .from(agentRuns)
      .innerJoin(assignments, eq(assignments.id, agentRuns.assignmentId))
      .innerJoin(courses, eq(courses.id, assignments.courseId))
      .where(inArray(courses.id, courseIds))
      .orderBy(desc(agentRuns.createdAt))
      .limit(50);
  }),
);

export const getReviewHub = cache(() =>
  workspaceQuery("workspace.reviews_failed", async ({ db, courseIds }) => {
    if (!courseIds.length) return [];
    const reports = await db
      .select({
        id: reviewReports.id,
        overallStatus: reviewReports.overallStatus,
        estimatedScore: reviewReports.estimatedScore,
        requiresAnotherCycle: reviewReports.requiresAnotherCycle,
        createdAt: reviewReports.createdAt,
        assignmentId: assignments.id,
        assignmentTitle: assignments.title,
        courseId: courses.id,
        courseCode: courses.code,
        courseTitle: courses.title,
      })
      .from(reviewReports)
      .innerJoin(assignments, eq(assignments.id, reviewReports.assignmentId))
      .innerJoin(courses, eq(courses.id, assignments.courseId))
      .where(inArray(courses.id, courseIds))
      .orderBy(desc(reviewReports.createdAt))
      .limit(50);

    const findingCounts = reports.length
      ? await db
          .select({
            reportId: reviewFindings.reportId,
            value: count(),
          })
          .from(reviewFindings)
          .where(
            and(
              inArray(
                reviewFindings.reportId,
                reports.map((report) => report.id),
              ),
              eq(reviewFindings.resolution, "open"),
            ),
          )
          .groupBy(reviewFindings.reportId)
      : [];
    const openByReport = new Map(
      findingCounts.map((item) => [item.reportId, item.value]),
    );

    return reports.map((report) => ({
      ...report,
      openFindings: openByReport.get(report.id) ?? 0,
    }));
  }),
);

export const getSettingsHub = cache(async () => {
  const user = await requireUser();
  const configuration = getConfigurationStatus();
  const operations = getOperationsEnv();
  let ai: ReturnType<typeof getAiEnv> | null = null;

  try {
    ai = getAiEnv();
  } catch (error) {
    logger.warn("workspace.ai_configuration_invalid", {
      userId: user.id,
      ...errorFingerprint(error),
    });
  }

  return {
    user: {
      email: user.email ?? "Student",
      displayName: user.user_metadata.display_name as string | undefined,
    },
    configuration,
    workerConfigured: operations.success,
    ai,
  };
});
