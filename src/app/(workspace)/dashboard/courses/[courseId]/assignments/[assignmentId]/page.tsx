import {
  ArrowLeft,
  AlertTriangle,
  Bot,
  BookOpenCheck,
  CalendarDays,
  Check,
  FileCheck2,
  History,
  ListChecks,
  RotateCcw,
  SearchCheck,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AgentControls } from "@/features/agents/agent-controls";
import { AgentJobMonitor } from "@/features/agents/agent-job-monitor";
import { decideReviewFindingAction } from "@/features/agents/actions";
import {
  DRAFT_JOB_TYPE,
  RESEARCH_JOB_TYPE,
  REVIEW_JOB_TYPE,
  REVISION_JOB_TYPE,
} from "@/features/agents/contracts";
import { getAssignmentWorkspace } from "@/features/assignments/data";
import { DraftEditor } from "@/features/assignments/draft-editor";
import {
  WorkspaceDrawerManager,
  DrawerTriggerButton,
} from "@/features/assignments/workspace-drawer";
import { ApprovalExportPanel } from "@/features/exports/approval-export-panel";
import { evaluateApprovalReadiness } from "@/features/exports/approval";
import {
  citationIdentity,
  formatReference,
} from "@/features/exports/citation-format";
import { ExportJobMonitor } from "@/features/exports/export-job-monitor";
import { getAiEnv } from "@/lib/env/server";

type PageProps = {
  params: Promise<{ courseId: string; assignmentId: string }>;
  searchParams: Promise<{
    saved?: string | string[];
    words?: string | string[];
    agent?: string | string[];
    status?: string | string[];
    message?: string | string[];
  }>;
};

export default function AssignmentWorkspacePage(props: PageProps) {
  return (
    <Suspense fallback={<WorkspaceLoadingState />}>
      <WorkspaceContent {...props} />
    </Suspense>
  );
}

async function WorkspaceContent({ params, searchParams }: PageProps) {
  await connection();
  const [{ courseId, assignmentId }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const ids = z
    .object({ courseId: z.uuid(), assignmentId: z.uuid() })
    .safeParse({ courseId, assignmentId });
  if (!ids.success) notFound();
  const data = await getAssignmentWorkspace(courseId, assignmentId);
  if (!data) notFound();
  const canEdit = data.role !== "viewer";
  const answerByQuestion = new Map(
    data.answers.map((answer) => [answer.questionId, answer]),
  );
  const citationCountByAnswer = new Map(
    data.citationCounts.map((item) => [item.answerId, item.count]),
  );
  const citationsByAnswer = new Map<string, typeof data.citations>();
  data.citations.forEach((citation) => {
    const current = citationsByAnswer.get(citation.answerId) ?? [];
    current.push(citation);
    citationsByAnswer.set(citation.answerId, current);
  });
  const aiEnv = getAiEnv();
  const savedVersion = singleValue(query.saved);
  const savedWords = singleValue(query.words);
  const showSaved = /^\d+$/.test(savedVersion) && /^\d+$/.test(savedWords);
  const agentStatus = singleValue(query.status);
  const agentMessage = singleValue(query.message).slice(0, 500);
  const showAgentMessage =
    ["success", "warning", "error"].includes(agentStatus) && agentMessage;
  const activeOperation =
    data.activeJobs[0]?.type === RESEARCH_JOB_TYPE
      ? "research"
      : data.activeJobs[0]?.type === REVIEW_JOB_TYPE
        ? "review"
        : data.activeJobs[0]?.type === REVISION_JOB_TYPE
          ? "revision"
          : "draft";
  const acceptedFindingCount = data.reviewItems.filter(
    (finding) => finding.resolution === "accepted",
  ).length;
  const workspacePath = `/dashboard/courses/${courseId}/assignments/${assignmentId}`;
  const approvalReadiness = evaluateApprovalReadiness({
    latestDraftExists: Boolean(data.latestDraft),
    latestReviewStatus: data.latestReviewReport?.overallStatus ?? null,
    reviewPassed: data.latestReviewReport?.qualityGateResults.passed === true,
    citationCount: data.citations.length,
    verifiedCitationCount: data.citations.filter(
      (citation) => citation.verified,
    ).length,
    activeAgentOperations: data.activeJobs.length,
  });
  const referenceMap = new Map<string, (typeof data.citations)[number]>();
  data.citations.forEach((citation) => {
    const identity = citationIdentity(citation);
    if (!referenceMap.has(identity)) referenceMap.set(identity, citation);
  });
  const references = [...referenceMap.values()];

  return (
    <main className="p-5 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {showSaved && (
          <div
            role="status"
            className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800"
          >
            Draft saved as version {savedVersion} · {savedWords} words.
          </div>
        )}
        {showAgentMessage && (
          <div
            role="status"
            className={`rounded-xl border px-4 py-3 text-sm font-medium ${
              agentStatus === "error"
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : agentStatus === "warning"
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-teal-200 bg-teal-50 text-teal-800"
            }`}
          >
            {agentMessage}
          </div>
        )}
        {data.activeJobs.length > 0 && (
          <AgentJobMonitor
            jobIds={data.activeJobs.map((job) => job.id)}
            workspacePath={workspacePath}
            operation={activeOperation}
          />
        )}
        {data.activeExportJobs.length > 0 && (
          <ExportJobMonitor
            jobIds={data.activeExportJobs.map((job) => job.id)}
            workspacePath={workspacePath}
          />
        )}
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-3">
            <Link href={`/dashboard/courses/${courseId}/assignments`}>
              <ArrowLeft className="size-4" /> All assignments
            </Link>
          </Button>
          <div className="mt-4 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <p className="text-sm font-semibold text-teal-700">
                {data.assignment.courseCode || data.assignment.courseTitle}
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
                {data.assignment.title}
              </h1>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusPill icon={ListChecks}>
                  {data.questions.length} question
                  {data.questions.length === 1 ? "" : "s"}
                </StatusPill>
                <DrawerTriggerButton
                  tab="rubric"
                  variant="ghost"
                  className="h-auto p-0 hover:bg-transparent"
                >
                  <StatusPill icon={BookOpenCheck}>
                    {data.criteria.length} rubric criteria
                  </StatusPill>
                </DrawerTriggerButton>
                <StatusPill icon={History}>
                  {data.latestDraft
                    ? `Draft version ${data.latestDraft.version}`
                    : "Unsaved draft"}
                </StatusPill>
                {data.assignment.dueAt && (
                  <StatusPill icon={CalendarDays}>
                    Due {formatDate(data.assignment.dueAt)}
                  </StatusPill>
                )}
                {data.approval && (
                  <StatusPill icon={FileCheck2}>
                    Version {data.latestDraft?.version} approved
                  </StatusPill>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-500">
              <span className="font-semibold text-slate-700">
                Research policy:
              </span>{" "}
              {data.assignment.externalResearchAllowed
                ? "Course sources first, then credible external sources."
                : "Course sources only unless you change the policy later."}
            </div>
          </div>
        </div>

        <WorkspaceDrawerManager
          courseId={courseId}
          assignmentId={assignmentId}
          assignmentTitle={data.assignment.title}
          briefMarkdown={data.assignment.briefMarkdown}
          questions={data.questions}
          criteria={data.criteria}
          answers={data.answers}
          hasDraft={Boolean(data.latestDraft)}
          draftVersion={data.latestDraft?.version ?? null}
          reviewItems={data.reviewItems}
          previousReviewItems={data.previousReviewItems}
          hasReviewReport={Boolean(data.latestReviewReport)}
          hasPreviousReviewReport={Boolean(data.previousReviewReport)}
          events={data.events}
        />

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div>
            <div className="mb-4">
              <h2 className="text-xl font-semibold tracking-tight text-slate-950">
                Draft answers
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Markdown is the canonical format. Saved versions are immutable.
              </p>
            </div>
            <DraftEditor
              assignmentId={assignmentId}
              isAgentDraft={data.latestDraft?.createdByAgent === "student"}
              busy={data.activeJobs.some(
                (job) =>
                  job.type === DRAFT_JOB_TYPE ||
                  job.type === REVIEW_JOB_TYPE ||
                  job.type === REVISION_JOB_TYPE,
              )}
              readOnly={!canEdit}
              questions={data.questions.map((question) => {
                const answer = answerByQuestion.get(question.id);
                return {
                  id: question.id,
                  position: question.position,
                  prompt: question.prompt,
                  requirements: question.requirements,
                  wordLimit: question.wordLimit,
                  answer: answer?.markdown ?? "",
                  confidenceScore: answer?.confidenceScore ?? 0,
                  confidenceReasons: answer?.confidenceReasons ?? [],
                  citationCount: answer
                    ? (citationCountByAnswer.get(answer.id) ?? 0)
                    : 0,
                  citations: answer
                    ? (citationsByAnswer.get(answer.id) ?? [])
                    : [],
                };
              })}
            />
          </div>

          <aside className="space-y-6 xl:sticky xl:top-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileCheck2 className="size-5 text-teal-600" /> Approval and
                  exports
                </CardTitle>
                <CardDescription>
                  Approval is strict, version-specific, and required before
                  generating private files.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ApprovalExportPanel
                  courseId={courseId}
                  assignmentId={assignmentId}
                  draftVersion={data.latestDraft?.version ?? null}
                  approval={data.approval}
                  checks={approvalReadiness.checks}
                  ready={approvalReadiness.ready}
                  exportBusy={data.activeExportJobs.length > 0}
                  exports={data.exports}
                  readOnly={!canEdit}
                />
              </CardContent>
            </Card>

            {references.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BookOpenCheck className="size-5 text-teal-600" /> Reference
                    list
                  </CardTitle>
                  <CardDescription>
                    Built only from metadata stored with the latest draft.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ol className="space-y-3">
                    {references.map((citation, index) => (
                      <li
                        key={citationIdentity(citation)}
                        className="text-xs leading-5 text-slate-600"
                      >
                        <span className="font-semibold text-slate-800">
                          [{index + 1}]
                        </span>{" "}
                        {formatReference(citation)}
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            )}

            {canEdit && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bot className="size-5 text-teal-600" /> Agents A + B + C
                  </CardTitle>
                  <CardDescription>
                    Research first, inspect the provenance, then generate a new
                    evidence-backed draft version.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <AgentControls
                    courseId={courseId}
                    assignmentId={assignmentId}
                    sourceCount={data.findings.length}
                    model={aiEnv.AI_MODEL_WRITER}
                    externalResearchEnabled={
                      data.assignment.externalResearchAllowed
                    }
                    busy={data.activeJobs.length > 0}
                    hasDraft={Boolean(data.latestDraft)}
                    reviewerModel={aiEnv.AI_MODEL_REVIEWER}
                    canRevise={
                      data.latestReviewReport?.overallStatus ===
                        "changes_required" && acceptedFindingCount > 0
                    }
                    revisionCount={data.revisions.length}
                    maxIterations={aiEnv.MAX_AGENT_ITERATIONS}
                  />
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-5 text-teal-600" /> Independent
                  review
                </CardTitle>
                <CardDescription>
                  Agent A checks the latest draft independently. Its result is
                  advisory and always requires student inspection.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.latestReviewReport ? (
                  <div className="space-y-4">
                    <div
                      className={`rounded-xl border p-4 ${
                        data.latestReviewReport.overallStatus ===
                        "quality_gates_passed"
                          ? "border-teal-200 bg-teal-50"
                          : data.latestReviewReport.overallStatus ===
                              "in_progress"
                            ? "border-sky-200 bg-sky-50"
                            : "border-amber-200 bg-amber-50"
                      }`}
                    >
                      <p className="text-sm font-semibold text-slate-800">
                        {reviewStatusLabel(
                          data.latestReviewReport.overallStatus,
                        )}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-600">
                        {reviewSummary(
                          data.latestReviewReport.qualityGateResults,
                        )}
                      </p>
                    </div>
                    {data.reviewItems.length > 0 && (
                      <ol className="space-y-3">
                        {data.reviewItems.slice(0, 8).map((finding) => (
                          <li
                            key={finding.id}
                            className="rounded-xl border border-slate-200 bg-white p-3"
                          >
                            <div className="flex items-start gap-2">
                              <AlertTriangle
                                className={`mt-0.5 size-4 shrink-0 ${severityColor(finding.severity)}`}
                              />
                              <div>
                                <p className="text-xs font-semibold text-slate-800">
                                  {finding.title}
                                </p>
                                <p className="mt-1 text-xs leading-5 text-slate-500">
                                  {finding.explanation}
                                </p>
                                <p className="mt-2 text-xs font-medium leading-5 text-slate-700">
                                  Fix: {finding.recommendedCorrection}
                                </p>
                                <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                  {finding.resolution === "open"
                                    ? "Awaiting your decision"
                                    : finding.resolution}
                                </p>
                                {canEdit &&
                                  finding.resolution !== "resolved" &&
                                  data.latestReviewReport?.overallStatus ===
                                    "changes_required" && (
                                    <form
                                      action={decideReviewFindingAction.bind(
                                        null,
                                        courseId,
                                        assignmentId,
                                        finding.id,
                                      )}
                                      className="mt-3 space-y-2"
                                    >
                                      <input
                                        name="note"
                                        defaultValue={
                                          finding.decisionNote ?? ""
                                        }
                                        maxLength={1000}
                                        placeholder="Optional note for Agent B"
                                        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                                      />
                                      <div className="grid grid-cols-2 gap-2">
                                        <Button
                                          type="submit"
                                          name="decision"
                                          value="accepted"
                                          size="sm"
                                          variant="accent"
                                          disabled={data.activeJobs.length > 0}
                                        >
                                          <Check className="size-3.5" /> Accept
                                        </Button>
                                        <Button
                                          type="submit"
                                          name="decision"
                                          value="rejected"
                                          size="sm"
                                          variant="secondary"
                                          disabled={data.activeJobs.length > 0}
                                        >
                                          <X className="size-3.5" /> Reject
                                        </Button>
                                      </div>
                                    </form>
                                  )}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                    {data.latestReviewReport.unresolvedConcerns.length > 0 && (
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs font-semibold text-slate-700">
                          Remaining uncertainty
                        </p>
                        <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-500">
                          {data.latestReviewReport.unresolvedConcerns
                            .slice(0, 5)
                            .map((concern) => (
                              <li key={concern}>• {concern}</li>
                            ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-500">
                    Save a draft, then run Agent A for structured findings and
                    quality-gate checks.
                  </p>
                )}
              </CardContent>
            </Card>

            {data.revisions.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <RotateCcw className="size-5 text-teal-600" /> Revision
                    history
                  </CardTitle>
                  <CardDescription>
                    Immutable Agent B cycles created from student-accepted
                    findings.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ol className="space-y-3">
                    {data.revisions.slice(0, 5).map((revision) => (
                      <li
                        key={revision.id}
                        className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                      >
                        <p className="text-xs font-semibold text-slate-800">
                          Revision cycle {revision.iteration}
                        </p>
                        <p className="mt-1 text-[11px] leading-5 text-slate-500">
                          {formatTimestamp(revision.createdAt)} · preserved as
                          an immutable draft
                        </p>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <SearchCheck className="size-5 text-teal-600" /> Research
                  evidence
                </CardTitle>
                <CardDescription>
                  Retrieved course passages and scholarly abstracts from the
                  latest completed Agent C run.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.findings.length ? (
                  <div className="space-y-3">
                    {data.findings.slice(0, 6).map((finding) => (
                      <article
                        key={finding.id}
                        className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-xs font-semibold text-teal-700">
                            {sourceTitle(finding.citationMetadata)}
                          </p>
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            {finding.sourceType === "external"
                              ? "External"
                              : "Course"}
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-4 text-xs leading-5 text-slate-600">
                          {finding.evidence}
                        </p>
                        <p className="mt-2 text-[11px] text-slate-400">
                          {sourceLocator(finding.citationMetadata)}
                        </p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-500">
                    Run Agent C to retrieve traceable evidence before drafting.
                  </p>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </main>
  );
}

function StatusPill({
  icon: Icon,
  children,
}: {
  icon: typeof ListChecks;
  children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
      <Icon className="size-3.5 text-teal-600" />
      {children}
    </span>
  );
}

function WorkspaceLoadingState() {
  return (
    <main className="p-5 lg:p-8" aria-busy="true" aria-live="polite">
      <div className="mx-auto max-w-7xl">
        <p className="text-sm font-semibold text-teal-700">
          Assignment workspace
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
          Loading your latest draft…
        </h1>
        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="h-[34rem] animate-pulse rounded-2xl border border-slate-200 bg-white shadow-sm" />
          <div className="h-80 animate-pulse rounded-2xl border border-slate-200 bg-white shadow-sm" />
        </div>
      </div>
    </main>
  );
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}

function singleValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function sourceTitle(metadata: Record<string, unknown>) {
  return typeof metadata.title === "string"
    ? metadata.title
    : "Retrieved source";
}

function sourceLocator(metadata: Record<string, unknown>) {
  if (typeof metadata.pageStart === "number")
    return `Page ${metadata.pageStart}`;
  if (typeof metadata.url === "string") {
    try {
      return new URL(metadata.url).hostname;
    } catch {
      return "External source";
    }
  }
  return "Source location not supplied";
}

function formatTimestamp(value: Date) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function reviewStatusLabel(status: string) {
  if (status === "quality_gates_passed") return "Defined quality gates passed";
  if (status === "in_progress") return "Review in progress";
  return "Changes required";
}

function reviewSummary(results: Record<string, unknown>) {
  const reviewed = numericResult(results, "questionsReviewed");
  const expected = numericResult(results, "expectedQuestions");
  const required = numericResult(results, "requiredFindings");
  if (!reviewed && !expected) return "Agent A is evaluating the latest draft.";
  return `${reviewed}/${expected} questions reviewed · ${required} required finding${required === 1 ? "" : "s"}. Student approval is still required.`;
}

function numericResult(results: Record<string, unknown>, key: string) {
  return typeof results[key] === "number" ? results[key] : 0;
}

function severityColor(
  severity: "critical" | "major" | "minor" | "suggestion",
) {
  if (severity === "critical") return "text-rose-600";
  if (severity === "major") return "text-amber-600";
  if (severity === "minor") return "text-sky-600";
  return "text-slate-400";
}
