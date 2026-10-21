import "server-only";

import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { cache } from "react";

import { requireUser } from "@/lib/auth/session";
import {
  requireAssignmentAccess,
  requireCourseAccess,
} from "@/lib/auth/course-access";
import { getDatabase } from "@/lib/db";
import {
  DRAFT_JOB_TYPE,
  RESEARCH_JOB_TYPE,
  REVIEW_JOB_TYPE,
  REVISION_JOB_TYPE,
} from "@/features/agents/contracts";
import { EXPORT_JOB_TYPE } from "@/features/exports/contracts";
import {
  agentRunEvents,
  agentRuns,
  answerCitations,
  assignmentDrafts,
  assignmentQuestions,
  assignments,
  courses,
  draftAnswers,
  draftApprovals,
  exportRecords,
  researchFindings,
  reviewFindings,
  reviewReports,
  revisionHistory,
  rubricCriteria,
  processingJobs,
} from "@/lib/db/schema";

export const getCourseAssignments = cache(async (courseId: string) => {
  const user = await requireUser();
  const access = await requireCourseAccess(courseId, user.id, "read").catch(
    () => null,
  );
  if (!access) return null;
  const db = getDatabase();
  const [course] = await db
    .select({ id: courses.id, code: courses.code, title: courses.title })
    .from(courses)
    .where(eq(courses.id, courseId))
    .limit(1);
  if (!course) return null;

  const items = await db
    .select({
      id: assignments.id,
      title: assignments.title,
      status: assignments.status,
      dueAt: assignments.dueAt,
      createdAt: assignments.createdAt,
    })
    .from(assignments)
    .where(eq(assignments.courseId, courseId))
    .orderBy(desc(assignments.createdAt));
  return { course, assignments: items, role: access.role };
});

export const getAssignmentWorkspace = cache(
  async (courseId: string, assignmentId: string) => {
    const user = await requireUser();
    const access = await requireAssignmentAccess(
      assignmentId,
      user.id,
      "read",
    ).catch(() => null);
    if (!access || access.courseId !== courseId) return null;
    const db = getDatabase();
    const [assignment] = await db
      .select({
        id: assignments.id,
        title: assignments.title,
        briefMarkdown: assignments.briefMarkdown,
        status: assignments.status,
        dueAt: assignments.dueAt,
        externalResearchAllowed: assignments.externalResearchAllowed,
        courseId: courses.id,
        courseCode: courses.code,
        courseTitle: courses.title,
      })
      .from(assignments)
      .innerJoin(courses, eq(courses.id, assignments.courseId))
      .where(
        and(
          eq(assignments.id, assignmentId),
          eq(assignments.courseId, courseId),
        ),
      )
      .limit(1);
    if (!assignment) return null;

    const [questions, criteria, latestDraft] = await Promise.all([
      db
        .select()
        .from(assignmentQuestions)
        .where(eq(assignmentQuestions.assignmentId, assignmentId))
        .orderBy(assignmentQuestions.position),
      db
        .select()
        .from(rubricCriteria)
        .where(eq(rubricCriteria.assignmentId, assignmentId))
        .orderBy(rubricCriteria.position),
      db
        .select({ draft: assignmentDrafts })
        .from(assignmentDrafts)
        .leftJoin(agentRuns, eq(agentRuns.id, assignmentDrafts.sourceRunId))
        .where(
          and(
            eq(assignmentDrafts.assignmentId, assignmentId),
            or(
              isNull(assignmentDrafts.sourceRunId),
              eq(agentRuns.status, "completed"),
            ),
          ),
        )
        .orderBy(desc(assignmentDrafts.version))
        .limit(1)
        .then((rows) => rows[0]?.draft ?? null),
    ]);
    const answers = latestDraft
      ? await db
          .select({
            questionId: draftAnswers.questionId,
            markdown: draftAnswers.markdown,
            wordCount: draftAnswers.wordCount,
            confidenceScore: draftAnswers.confidenceScore,
            confidenceReasons: draftAnswers.confidenceReasons,
            id: draftAnswers.id,
          })
          .from(draftAnswers)
          .where(eq(draftAnswers.draftId, latestDraft.id))
      : [];

    const [
      latestResearchRun,
      runs,
      events,
      activeJobs,
      activeExportJobs,
      exports,
    ] = await Promise.all([
      db
        .select({ id: agentRuns.id, output: agentRuns.output })
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.assignmentId, assignmentId),
            eq(agentRuns.agent, "researcher"),
            eq(agentRuns.status, "completed"),
          ),
        )
        .orderBy(desc(agentRuns.createdAt))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select({
          id: agentRuns.id,
          agent: agentRuns.agent,
          status: agentRuns.status,
          workflowState: agentRuns.workflowState,
          provider: agentRuns.provider,
          model: agentRuns.model,
          errorMessage: agentRuns.errorMessage,
          createdAt: agentRuns.createdAt,
          completedAt: agentRuns.completedAt,
        })
        .from(agentRuns)
        .where(eq(agentRuns.assignmentId, assignmentId))
        .orderBy(desc(agentRuns.createdAt))
        .limit(8),
      db
        .select({
          id: agentRunEvents.id,
          eventType: agentRunEvents.eventType,
          message: agentRunEvents.message,
          createdAt: agentRunEvents.createdAt,
        })
        .from(agentRunEvents)
        .where(eq(agentRunEvents.assignmentId, assignmentId))
        .orderBy(desc(agentRunEvents.createdAt))
        .limit(12),
      db
        .select({
          id: processingJobs.id,
          type: processingJobs.type,
          status: processingJobs.status,
        })
        .from(processingJobs)
        .where(
          and(
            eq(processingJobs.assignmentId, assignmentId),
            inArray(processingJobs.type, [
              RESEARCH_JOB_TYPE,
              DRAFT_JOB_TYPE,
              REVIEW_JOB_TYPE,
              REVISION_JOB_TYPE,
            ]),
            inArray(processingJobs.status, ["queued", "processing"]),
          ),
        )
        .orderBy(processingJobs.createdAt),
      db
        .select({
          id: processingJobs.id,
          status: processingJobs.status,
          payload: processingJobs.payload,
        })
        .from(processingJobs)
        .where(
          and(
            eq(processingJobs.assignmentId, assignmentId),
            eq(processingJobs.type, EXPORT_JOB_TYPE),
            inArray(processingJobs.status, ["queued", "processing"]),
          ),
        )
        .orderBy(processingJobs.createdAt),
      db
        .select({
          id: exportRecords.id,
          draftId: exportRecords.draftId,
          format: exportRecords.format,
          filename: exportRecords.filename,
          sizeBytes: exportRecords.sizeBytes,
          status: exportRecords.status,
          errorMessage: exportRecords.errorMessage,
          completedAt: exportRecords.completedAt,
          createdAt: exportRecords.createdAt,
        })
        .from(exportRecords)
        .where(eq(exportRecords.assignmentId, assignmentId))
        .orderBy(desc(exportRecords.createdAt))
        .limit(12),
    ]);
    const findings = latestResearchRun
      ? await db
          .select()
          .from(researchFindings)
          .where(eq(researchFindings.runId, latestResearchRun.id))
          .orderBy(desc(researchFindings.relevanceScore))
          .limit(16)
      : [];
    const citations = answers.length
      ? await db
          .select({
            id: answerCitations.id,
            answerId: answerCitations.answerId,
            sourceType: answerCitations.sourceType,
            sourceId: answerCitations.sourceId,
            claimText: answerCitations.claimText,
            locator: answerCitations.locator,
            metadata: answerCitations.metadata,
            verified: answerCitations.verified,
          })
          .from(answerCitations)
          .where(
            inArray(
              answerCitations.answerId,
              answers.map((answer) => answer.id),
            ),
          )
          .orderBy(answerCitations.createdAt)
      : [];
    const citationCounts = answers.map((answer) => ({
      answerId: answer.id,
      count: citations.filter((citation) => citation.answerId === answer.id)
        .length,
    }));
    const latestReviewReport = latestDraft
      ? await db
          .select()
          .from(reviewReports)
          .where(
            and(
              eq(reviewReports.assignmentId, assignmentId),
              eq(reviewReports.draftId, latestDraft.id),
            ),
          )
          .orderBy(desc(reviewReports.createdAt))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null;
    const reviewItems = latestReviewReport
      ? await db
          .select({
            id: reviewFindings.id,
            rubricCriterionId: reviewFindings.rubricCriterionId,
            severity: reviewFindings.severity,
            required: reviewFindings.required,
            title: reviewFindings.title,
            explanation: reviewFindings.explanation,
            location: reviewFindings.location,
            recommendedCorrection: reviewFindings.recommendedCorrection,
            answerId: reviewFindings.answerId,
            resolution: reviewFindings.resolution,
            decisionNote: reviewFindings.decisionNote,
            decidedAt: reviewFindings.decidedAt,
          })
          .from(reviewFindings)
          .where(eq(reviewFindings.reportId, latestReviewReport.id))
          .orderBy(reviewFindings.createdAt)
      : [];
    const allReviewReports = await db
      .select({
        id: reviewReports.id,
        draftId: reviewReports.draftId,
        overallStatus: reviewReports.overallStatus,
        estimatedScore: reviewReports.estimatedScore,
        createdAt: reviewReports.createdAt,
      })
      .from(reviewReports)
      .where(eq(reviewReports.assignmentId, assignmentId))
      .orderBy(desc(reviewReports.createdAt))
      .limit(5);
    const previousReviewReport =
      allReviewReports.find((report) => report.id !== latestReviewReport?.id) ??
      null;
    const previousReviewItems = previousReviewReport
      ? await db
          .select({
            id: reviewFindings.id,
            rubricCriterionId: reviewFindings.rubricCriterionId,
            severity: reviewFindings.severity,
            title: reviewFindings.title,
            recommendedCorrection: reviewFindings.recommendedCorrection,
            resolution: reviewFindings.resolution,
          })
          .from(reviewFindings)
          .where(eq(reviewFindings.reportId, previousReviewReport.id))
      : [];
    const approval = latestDraft
      ? await db
          .select({
            id: draftApprovals.id,
            approvedAt: draftApprovals.approvedAt,
            reviewReportId: draftApprovals.reviewReportId,
            attestationVersion: draftApprovals.attestationVersion,
          })
          .from(draftApprovals)
          .where(
            and(
              eq(draftApprovals.assignmentId, assignmentId),
              eq(draftApprovals.draftId, latestDraft.id),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null;
    const revisions = await db
      .select({
        id: revisionHistory.id,
        iteration: revisionHistory.iteration,
        fromDraftId: revisionHistory.fromDraftId,
        toDraftId: revisionHistory.toDraftId,
        createdAt: revisionHistory.createdAt,
        changeSummary: revisionHistory.changeSummary,
      })
      .from(revisionHistory)
      .where(eq(revisionHistory.assignmentId, assignmentId))
      .orderBy(desc(revisionHistory.iteration));

    return {
      assignment,
      questions,
      criteria,
      latestDraft,
      answers,
      findings,
      latestResearchRun,
      runs,
      events,
      activeJobs,
      activeExportJobs,
      exports,
      citationCounts,
      citations,
      latestReviewReport,
      reviewItems,
      previousReviewReport,
      previousReviewItems,
      approval,
      revisions,
      role: access.role,
    };
  },
);
