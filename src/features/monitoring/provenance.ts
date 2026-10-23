import "server-only";

import { and, desc, eq, inArray, lt } from "drizzle-orm";

import { requireAssignmentAccess } from "@/lib/auth/course-access";
import { getDatabase } from "@/lib/db";
import {
  agentRunEvents,
  agentRuns,
  answerCitations,
  assignmentDrafts,
  assignmentQuestions,
  draftAnswers,
  draftApprovals,
  reviewFindings,
  reviewReports,
  revisionHistory,
  rubricCriteria,
} from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import {
  classifyDraftOrigin,
  criterionEvaluationStatus,
  type CriterionEvaluationStatus,
  type DraftOrigin,
} from "./provenance-model";

const qualityGateKeys = [
  "requirementCoverage",
  "evidenceGrounding",
  "citationTraceability",
  "criticalReasoning",
  "academicClarity",
] as const;

export type DraftVersionSummary = {
  id: string;
  version: number;
  createdAt: string;
  wordCount: number;
  isApproved: boolean;
  origin: DraftOrigin;
  runId: string | null;
  runStatus: string | null;
  runModel: string | null;
  parentDraftId: string | null;
  parentVersion: number | null;
  revisionIteration: number | null;
};

export type ReviewReportSummary = {
  id: string;
  draftId: string;
  draftVersion: number | null;
  runId: string | null;
  runModel: string | null;
  runStatus: string | null;
  overallStatus: string;
  createdAt: string;
};

export async function getProvenanceIndex(assignmentId: string, userId: string) {
  await requireAssignmentAccess(assignmentId, userId, "read");
  const db = getDatabase();
  const [drafts, revisions, reports, approvals] = await Promise.all([
    db
      .select({
        id: assignmentDrafts.id,
        version: assignmentDrafts.version,
        createdAt: assignmentDrafts.createdAt,
        wordCount: assignmentDrafts.wordCount,
        createdByAgent: assignmentDrafts.createdByAgent,
        sourceRunId: assignmentDrafts.sourceRunId,
        runAgent: agentRuns.agent,
        runStatus: agentRuns.status,
        runModel: agentRuns.model,
      })
      .from(assignmentDrafts)
      .leftJoin(agentRuns, eq(agentRuns.id, assignmentDrafts.sourceRunId))
      .where(eq(assignmentDrafts.assignmentId, assignmentId))
      .orderBy(desc(assignmentDrafts.version))
      .limit(50),
    db
      .select({
        toDraftId: revisionHistory.toDraftId,
        fromDraftId: revisionHistory.fromDraftId,
        iteration: revisionHistory.iteration,
      })
      .from(revisionHistory)
      .where(eq(revisionHistory.assignmentId, assignmentId)),
    db
      .select({
        id: reviewReports.id,
        draftId: reviewReports.draftId,
        draftVersion: assignmentDrafts.version,
        runId: reviewReports.runId,
        runModel: agentRuns.model,
        runStatus: agentRuns.status,
        overallStatus: reviewReports.overallStatus,
        createdAt: reviewReports.createdAt,
      })
      .from(reviewReports)
      .innerJoin(
        assignmentDrafts,
        eq(assignmentDrafts.id, reviewReports.draftId),
      )
      .leftJoin(agentRuns, eq(agentRuns.id, reviewReports.runId))
      .where(eq(reviewReports.assignmentId, assignmentId))
      .orderBy(desc(reviewReports.createdAt))
      .limit(20),
    db
      .select({ draftId: draftApprovals.draftId })
      .from(draftApprovals)
      .where(eq(draftApprovals.assignmentId, assignmentId)),
  ]);
  const revisionByTarget = new Map(
    revisions.map((revision) => [revision.toDraftId, revision]),
  );
  const versionById = new Map(drafts.map((draft) => [draft.id, draft.version]));
  const approved = new Set(approvals.map((approval) => approval.draftId));

  const summaries: DraftVersionSummary[] = drafts.map((draft, index) => {
    const revision = revisionByTarget.get(draft.id);
    const previous = drafts[index + 1] ?? null;
    const parentDraftId = revision?.fromDraftId ?? previous?.id ?? null;
    return {
      id: draft.id,
      version: draft.version,
      createdAt: draft.createdAt.toISOString(),
      wordCount: draft.wordCount,
      isApproved: approved.has(draft.id),
      origin: classifyDraftOrigin({
        createdByAgent: draft.createdByAgent,
        sourceRunId: draft.sourceRunId,
        runAgent: draft.runAgent,
        runStatus: draft.runStatus,
        isRevisionTarget: Boolean(revision),
      }),
      runId: draft.sourceRunId,
      runStatus: draft.runStatus,
      runModel: draft.runModel,
      parentDraftId,
      parentVersion: parentDraftId
        ? (versionById.get(parentDraftId) ?? null)
        : null,
      revisionIteration: revision?.iteration ?? null,
    };
  });

  return {
    drafts: summaries,
    reports: reports.map((report): ReviewReportSummary => ({
      ...report,
      createdAt: report.createdAt.toISOString(),
    })),
  };
}

async function draftInAssignment(assignmentId: string, draftId: string) {
  const [draft] = await getDatabase()
    .select()
    .from(assignmentDrafts)
    .where(
      and(
        eq(assignmentDrafts.id, draftId),
        eq(assignmentDrafts.assignmentId, assignmentId),
      ),
    )
    .limit(1);
  if (!draft) {
    throw new AppError("FORBIDDEN", "This draft version is unavailable.", {
      status: 404,
    });
  }
  return draft;
}

async function questionNumbersFor(assignmentId: string) {
  const questions = await getDatabase()
    .select({
      id: assignmentQuestions.id,
      position: assignmentQuestions.position,
    })
    .from(assignmentQuestions)
    .where(eq(assignmentQuestions.assignmentId, assignmentId));
  return new Map(
    questions.map((question) => [question.id, question.position + 1]),
  );
}

export async function getDraftProvenance(
  assignmentId: string,
  userId: string,
  draftId: string,
) {
  await requireAssignmentAccess(assignmentId, userId, "read");
  const db = getDatabase();
  const draft = await draftInAssignment(assignmentId, draftId);
  const [revision, previous] = await Promise.all([
    db
      .select()
      .from(revisionHistory)
      .where(
        and(
          eq(revisionHistory.assignmentId, assignmentId),
          eq(revisionHistory.toDraftId, draft.id),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({ id: assignmentDrafts.id })
      .from(assignmentDrafts)
      .where(
        and(
          eq(assignmentDrafts.assignmentId, assignmentId),
          lt(assignmentDrafts.version, draft.version),
        ),
      )
      .orderBy(desc(assignmentDrafts.version))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);
  const parentId = revision?.fromDraftId ?? previous?.id ?? null;

  const [parent, citations, motivatingFindings, runEvents, answers, numbers] =
    await Promise.all([
      parentId ? draftInAssignment(assignmentId, parentId) : null,
      db
        .select({
          id: answerCitations.id,
          sourceType: answerCitations.sourceType,
          sourceId: answerCitations.sourceId,
          locator: answerCitations.locator,
          metadata: answerCitations.metadata,
          verified: answerCitations.verified,
          questionPosition: assignmentQuestions.position,
        })
        .from(answerCitations)
        .innerJoin(draftAnswers, eq(draftAnswers.id, answerCitations.answerId))
        .innerJoin(
          assignmentQuestions,
          eq(assignmentQuestions.id, draftAnswers.questionId),
        )
        .where(eq(draftAnswers.draftId, draft.id))
        .orderBy(assignmentQuestions.position),
      revision?.reportId
        ? db
            .select({
              id: reviewFindings.id,
              title: reviewFindings.title,
              severity: reviewFindings.severity,
              resolution: reviewFindings.resolution,
              decisionNote: reviewFindings.decisionNote,
              decidedAt: reviewFindings.decidedAt,
            })
            .from(reviewFindings)
            .where(
              and(
                eq(reviewFindings.reportId, revision.reportId),
                inArray(reviewFindings.resolution, ["accepted", "resolved"]),
              ),
            )
        : Promise.resolve([]),
      draft.sourceRunId
        ? db
            .select({
              eventType: agentRunEvents.eventType,
              metadata: agentRunEvents.metadata,
            })
            .from(agentRunEvents)
            .where(eq(agentRunEvents.runId, draft.sourceRunId))
        : Promise.resolve([]),
      db
        .select({ id: draftAnswers.id })
        .from(draftAnswers)
        .where(eq(draftAnswers.draftId, draft.id)),
      questionNumbersFor(assignmentId),
    ]);
  const savedQuestions = runEvents.filter((event) =>
    /\.question_(completed|recovered|copied)$/.test(event.eventType),
  ).length;
  const failedModelRequests = runEvents.filter((event) =>
    event.eventType.endsWith(".model_request_failed"),
  ).length;
  // Agent B's own account of what it changed; Agent A must verify it.
  const claimedChanges = runEvents
    .filter((event) => event.eventType === "revision.question_completed")
    .map((event) => ({
      questionNumber:
        typeof event.metadata.questionId === "string"
          ? (numbers.get(event.metadata.questionId) ?? null)
          : null,
      items: stringList(event.metadata.changeSummary),
    }))
    .sort(
      (left, right) => (left.questionNumber ?? 0) - (right.questionNumber ?? 0),
    );

  return {
    draft: {
      id: draft.id,
      version: draft.version,
      createdAt: draft.createdAt.toISOString(),
      markdown: draft.markdown,
      runId: draft.sourceRunId,
    },
    parent: parent
      ? { id: parent.id, version: parent.version, markdown: parent.markdown }
      : null,
    citations: citations.map((citation) => ({
      id: citation.id,
      sourceType: citation.sourceType,
      sourceId: citation.sourceId,
      title:
        typeof citation.metadata.title === "string"
          ? citation.metadata.title
          : null,
      locator: citation.locator,
      verified: citation.verified,
      questionNumber: citation.questionPosition + 1,
    })),
    revision: revision
      ? {
          iteration: revision.iteration,
          reportId: revision.reportId,
          claimedChanges,
          motivatingFindings: motivatingFindings.map((finding) => ({
            ...finding,
            decidedAt: finding.decidedAt?.toISOString() ?? null,
          })),
        }
      : null,
    validation: {
      answersSaved: answers.length,
      questionCount: numbers.size,
      savedQuestionEvents: draft.sourceRunId ? savedQuestions : null,
      failedModelRequests: draft.sourceRunId ? failedModelRequests : null,
      citationCount: citations.length,
      verifiedCitationCount: citations.filter((citation) => citation.verified)
        .length,
    },
  };
}

export type FindingTrace = {
  id: string;
  severity: string;
  required: boolean;
  title: string;
  explanation: string;
  evidence: string | null;
  location: string | null;
  recommendedCorrection: string;
  questionNumber: number | null;
  resolution: string;
  decisionNote: string | null;
  decidedAt: string | null;
};

export type CriterionTrace = {
  id: string;
  title: string;
  weight: number | null;
  status: CriterionEvaluationStatus;
  findings: FindingTrace[];
  previousFindingCount: number | null;
};

export async function getRubricTrace(
  assignmentId: string,
  userId: string,
  reportId: string,
) {
  await requireAssignmentAccess(assignmentId, userId, "read");
  const db = getDatabase();
  const [report] = await db
    .select({
      id: reviewReports.id,
      draftId: reviewReports.draftId,
      draftVersion: assignmentDrafts.version,
      runId: reviewReports.runId,
      overallStatus: reviewReports.overallStatus,
      estimatedScore: reviewReports.estimatedScore,
      unresolvedConcerns: reviewReports.unresolvedConcerns,
      qualityGateResults: reviewReports.qualityGateResults,
      createdAt: reviewReports.createdAt,
      runModel: agentRuns.model,
      runStatus: agentRuns.status,
      runErrorCode: agentRuns.errorCode,
    })
    .from(reviewReports)
    .innerJoin(assignmentDrafts, eq(assignmentDrafts.id, reviewReports.draftId))
    .leftJoin(agentRuns, eq(agentRuns.id, reviewReports.runId))
    .where(
      and(
        eq(reviewReports.id, reportId),
        eq(reviewReports.assignmentId, assignmentId),
      ),
    )
    .limit(1);
  if (!report) {
    throw new AppError("FORBIDDEN", "This review report is unavailable.", {
      status: 404,
    });
  }
  const [criteria, findings, questionEvents, previousReport, numbers] =
    await Promise.all([
      db
        .select()
        .from(rubricCriteria)
        .where(eq(rubricCriteria.assignmentId, assignmentId))
        .orderBy(rubricCriteria.position),
      findingsFor(report.id),
      report.runId
        ? db
            .select({ metadata: agentRunEvents.metadata })
            .from(agentRunEvents)
            .where(
              and(
                eq(agentRunEvents.runId, report.runId),
                eq(agentRunEvents.eventType, "review.question_completed"),
              ),
            )
        : Promise.resolve([]),
      db
        .select({ id: reviewReports.id })
        .from(reviewReports)
        .where(
          and(
            eq(reviewReports.assignmentId, assignmentId),
            lt(reviewReports.createdAt, report.createdAt),
          ),
        )
        .orderBy(desc(reviewReports.createdAt))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      questionNumbersFor(assignmentId),
    ]);
  const previousFindings = previousReport
    ? await findingsFor(previousReport.id)
    : null;
  const toFindingTrace = (finding: FindingRow): FindingTrace => ({
    id: finding.id,
    severity: finding.severity,
    required: finding.required,
    title: finding.title,
    explanation: finding.explanation,
    evidence: finding.evidence,
    location: finding.location,
    recommendedCorrection: finding.recommendedCorrection,
    questionNumber: finding.questionId
      ? (numbers.get(finding.questionId) ?? null)
      : null,
    resolution: finding.resolution,
    decisionNote: finding.decisionNote,
    decidedAt: finding.decidedAt?.toISOString() ?? null,
  });

  const criteriaTrace: CriterionTrace[] = criteria.map((criterion) => {
    const linked = findings.filter(
      (finding) => finding.rubricCriterionId === criterion.id,
    );
    return {
      id: criterion.id,
      title: criterion.title,
      weight: criterion.weight,
      status: criterionEvaluationStatus({
        reportStatus: report.overallStatus,
        runErrorCode: report.runErrorCode,
        findingCount: linked.length,
      }),
      findings: linked.map(toFindingTrace),
      previousFindingCount: previousFindings
        ? previousFindings.filter(
            (finding) => finding.rubricCriterionId === criterion.id,
          ).length
        : null,
    };
  });
  const gates = report.qualityGateResults;
  const settled = !["in_progress", "failed", "cancelled"].includes(
    report.overallStatus,
  );

  return {
    report: {
      id: report.id,
      draftId: report.draftId,
      draftVersion: report.draftVersion,
      runId: report.runId,
      runModel: report.runModel,
      runStatus: report.runStatus,
      runErrorCode: report.runErrorCode,
      overallStatus: report.overallStatus,
      estimatedScore: report.estimatedScore,
      unresolvedConcerns: report.unresolvedConcerns,
      createdAt: report.createdAt.toISOString(),
      hasPreviousReport: Boolean(previousReport),
    },
    criteria: criteriaTrace,
    unlinkedFindings: findings
      .filter((finding) => !finding.rubricCriterionId)
      .map(toFindingTrace),
    // Model-reported per-question assessments, after the reviewer's own
    // deterministic overrides for missing answers and unverified citations.
    modelAssessments: questionEvents
      .map(({ metadata }) => {
        const rawGates =
          metadata.qualityGates && typeof metadata.qualityGates === "object"
            ? (metadata.qualityGates as Record<string, unknown>)
            : {};
        return {
          questionNumber:
            typeof metadata.questionId === "string"
              ? (numbers.get(metadata.questionId) ?? null)
              : null,
          qualityGates: Object.fromEntries(
            qualityGateKeys.map((key) => [key, rawGates[key] === true]),
          ) as Record<(typeof qualityGateKeys)[number], boolean>,
          confidenceScore: numberOrNull(metadata.confidenceScore),
          uncertaintyReasons: stringList(metadata.uncertaintyReasons),
          verifiedCitationCount: numberOrNull(metadata.verifiedCitationCount),
          citationCount: numberOrNull(metadata.citationCount),
        };
      })
      .sort(
        (left, right) =>
          (left.questionNumber ?? 0) - (right.questionNumber ?? 0),
      ),
    // Computed by code in finalizeReviewRun from stored records.
    deterministicChecks: settled
      ? {
          questionsReviewed: numberOrNull(gates.questionsReviewed),
          expectedQuestions: numberOrNull(gates.expectedQuestions),
          everyQuestionReviewed: gates.everyQuestionReviewed === true,
          citationCount: numberOrNull(gates.citationCount),
          citationsVerified: numberOrNull(gates.citationsVerified),
          requiredFindings: numberOrNull(gates.requiredFindings),
          unresolvedPriorFindings: numberOrNull(gates.unresolvedPriorFindings),
          passed: gates.passed === true,
        }
      : null,
  };
}

type FindingRow = Awaited<ReturnType<typeof findingsFor>>[number];

function findingsFor(reportId: string) {
  return getDatabase()
    .select({
      id: reviewFindings.id,
      rubricCriterionId: reviewFindings.rubricCriterionId,
      severity: reviewFindings.severity,
      required: reviewFindings.required,
      title: reviewFindings.title,
      explanation: reviewFindings.explanation,
      evidence: reviewFindings.evidence,
      location: reviewFindings.location,
      recommendedCorrection: reviewFindings.recommendedCorrection,
      resolution: reviewFindings.resolution,
      decisionNote: reviewFindings.decisionNote,
      decidedAt: reviewFindings.decidedAt,
      questionId: draftAnswers.questionId,
    })
    .from(reviewFindings)
    .leftJoin(draftAnswers, eq(draftAnswers.id, reviewFindings.answerId))
    .where(eq(reviewFindings.reportId, reportId))
    .orderBy(reviewFindings.createdAt);
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .slice(0, 12)
        .map((item) => item.slice(0, 500))
    : [];
}

function numberOrNull(value: unknown) {
  return typeof value === "number" ? value : null;
}
