"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CopyableId,
  EmptyState,
  Field,
  formatClock,
  Section,
  StatusBadge,
  type Tone,
} from "./monitor-ui";
import type {
  getDraftProvenance,
  getProvenanceIndex,
  getRubricTrace,
} from "./provenance";
import {
  criterionStatusLabels,
  diffLines,
  diffStats,
  draftOriginLabels,
  type CriterionEvaluationStatus,
  type DiffLine,
  type DraftOrigin,
} from "./provenance-model";

type ProvenanceIndex = Awaited<ReturnType<typeof getProvenanceIndex>>;
type DraftDetail = Awaited<ReturnType<typeof getDraftProvenance>>;
type RubricTrace = Awaited<ReturnType<typeof getRubricTrace>>;

type Loadable<T> =
  | { status: "idle" | "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

function useProvenance<T>(url: string | null, refreshKey: number) {
  // Results are keyed by request, so a new request reads as loading without
  // resetting state inside the effect.
  const key = url ? `${url}#${refreshKey}` : null;
  const [result, setResult] = useState<{
    key: string;
    value: Loadable<T>;
  } | null>(null);
  useEffect(() => {
    if (!url || !key) return;
    const controller = new AbortController();
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as
          (T & { message?: string }) | null;
        if (!response.ok || !body) {
          throw new Error(body?.message ?? "The record could not be loaded.");
        }
        setResult({ key, value: { status: "ready", data: body } });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setResult({
          key,
          value: {
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "The record could not be loaded.",
          },
        });
      });
    return () => controller.abort();
  }, [url, key]);
  if (!key) return { status: "idle" } as Loadable<T>;
  return result?.key === key
    ? result.value
    : ({ status: "loading" } as Loadable<T>);
}

const originTone: Record<DraftOrigin, Tone> = {
  ai_generated: "info",
  ai_revised: "info",
  student_edited: "success",
  incomplete: "warning",
  unverified: "warning",
};

export function ChangesTab({ assignmentId }: { assignmentId: string }) {
  const base = `/api/assignments/${assignmentId}/provenance`;
  const [refreshKey, setRefreshKey] = useState(0);
  const index = useProvenance<ProvenanceIndex>(base, refreshKey);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);

  const drafts = index.status === "ready" ? index.data.drafts : [];
  const reports = index.status === "ready" ? index.data.reports : [];
  const selectedDraftId = draftId ?? drafts[0]?.id ?? null;
  const selectedReportId = reportId ?? reports[0]?.id ?? null;
  const detail = useProvenance<DraftDetail>(
    selectedDraftId ? `${base}?draftId=${selectedDraftId}` : null,
    refreshKey,
  );
  const trace = useProvenance<RubricTrace>(
    selectedReportId ? `${base}?reportId=${selectedReportId}` : null,
    refreshKey,
  );

  if (index.status === "loading" || index.status === "idle") {
    return (
      <p className="text-sm text-slate-500">Loading provenance records…</p>
    );
  }
  if (index.status === "error") {
    return (
      <p
        role="alert"
        className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700"
      >
        {index.message}
      </p>
    );
  }
  const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId);
  const selectClass =
    "h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:outline-hidden";

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setRefreshKey((key) => key + 1)}
        >
          Refresh records
        </Button>
      </div>

      <Section
        title="Draft change history"
        description="Saved versions are immutable. Attribution comes from the run linked to each exact version."
      >
        {!drafts.length ? (
          <EmptyState>No draft versions have been saved yet.</EmptyState>
        ) : (
          <>
            <label
              htmlFor="provenance-draft"
              className="text-[11px] font-semibold uppercase tracking-wider text-slate-400"
            >
              Version
            </label>
            <select
              id="provenance-draft"
              className={cn(selectClass, "mt-1")}
              value={selectedDraftId ?? ""}
              onChange={(event) => setDraftId(event.target.value)}
            >
              {drafts.map((draft) => (
                <option key={draft.id} value={draft.id}>
                  Version {draft.version} · {draftOriginLabels[draft.origin]} ·{" "}
                  {formatClock(draft.createdAt)}
                </option>
              ))}
            </select>
            {selectedDraft && (
              <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Field label="Origin">
                  <StatusBadge tone={originTone[selectedDraft.origin]}>
                    {draftOriginLabels[selectedDraft.origin]}
                  </StatusBadge>
                </Field>
                <Field label="Generation run">
                  {selectedDraft.runId ? (
                    <CopyableId
                      label="generation run ID"
                      value={selectedDraft.runId}
                    />
                  ) : (
                    "None (manual save)"
                  )}
                </Field>
                <Field label="Model">
                  <span className="font-mono">
                    {selectedDraft.runModel ?? "—"}
                  </span>
                </Field>
                <Field label="Compared with">
                  {selectedDraft.parentVersion
                    ? `Version ${selectedDraft.parentVersion}${selectedDraft.revisionIteration ? ` (revision cycle ${selectedDraft.revisionIteration})` : ""}`
                    : "No earlier version"}
                </Field>
                <Field label="Words">{selectedDraft.wordCount}</Field>
                <Field label="Approval">
                  {selectedDraft.isApproved
                    ? "Approved by the student"
                    : "Not approved"}
                </Field>
              </dl>
            )}
            <div className="mt-4">
              {detail.status === "loading" && (
                <p className="text-xs text-slate-500">Loading version…</p>
              )}
              {detail.status === "error" && (
                <p role="alert" className="text-xs text-rose-700">
                  {detail.message}
                </p>
              )}
              {detail.status === "ready" && (
                <DraftDetailView detail={detail.data} />
              )}
            </div>
          </>
        )}
      </Section>

      <Section
        title="Rubric evaluation trace"
        description="Agent A's findings are advisory model assessments. They are not a university grade."
      >
        {!reports.length ? (
          <EmptyState>
            Not evaluated: Agent A has not reviewed any draft version.
          </EmptyState>
        ) : (
          <>
            <label
              htmlFor="provenance-report"
              className="text-[11px] font-semibold uppercase tracking-wider text-slate-400"
            >
              Review report
            </label>
            <select
              id="provenance-report"
              className={cn(selectClass, "mt-1")}
              value={selectedReportId ?? ""}
              onChange={(event) => setReportId(event.target.value)}
            >
              {reports.map((report) => (
                <option key={report.id} value={report.id}>
                  Review of version {report.draftVersion ?? "?"} ·{" "}
                  {reportStatusLabel(report.overallStatus)} ·{" "}
                  {formatClock(report.createdAt)}
                </option>
              ))}
            </select>
            <SourceLegend />
            <div className="mt-3">
              {trace.status === "loading" && (
                <p className="text-xs text-slate-500">Loading review…</p>
              )}
              {trace.status === "error" && (
                <p role="alert" className="text-xs text-rose-700">
                  {trace.message}
                </p>
              )}
              {trace.status === "ready" && (
                <RubricTraceView trace={trace.data} />
              )}
            </div>
          </>
        )}
      </Section>
    </div>
  );
}

function reportStatusLabel(status: string) {
  if (status === "quality_gates_passed") return "quality gates passed";
  if (status === "changes_required") return "changes required";
  if (status === "in_progress") return "in progress";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "stopped";
  return status;
}

const CONTEXT_LINES = 2;

type DiffBlock =
  { kind: "lines"; lines: DiffLine[] } | { kind: "gap"; count: number };

function collapseDiff(lines: DiffLine[]): DiffBlock[] {
  const keep = lines.map((line) => line.kind !== "same");
  const visible = lines.map((_, index) => {
    for (let offset = -CONTEXT_LINES; offset <= CONTEXT_LINES; offset += 1) {
      if (keep[index + offset]) return true;
    }
    return false;
  });
  const blocks: DiffBlock[] = [];
  lines.forEach((line, index) => {
    const last = blocks.at(-1);
    if (visible[index]) {
      if (last?.kind === "lines") last.lines.push(line);
      else blocks.push({ kind: "lines", lines: [line] });
    } else if (last?.kind === "gap") {
      last.count += 1;
    } else {
      blocks.push({ kind: "gap", count: 1 });
    }
  });
  return blocks;
}

function DraftDetailView({ detail }: { detail: DraftDetail }) {
  const [showAll, setShowAll] = useState(false);
  const lines = useMemo(
    () => diffLines(detail.parent?.markdown ?? "", detail.draft.markdown),
    [detail.parent?.markdown, detail.draft.markdown],
  );
  const stats = diffStats(lines);
  const blocks = showAll
    ? [{ kind: "lines" as const, lines }]
    : collapseDiff(lines);
  const { validation } = detail;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-slate-700">
            {detail.parent
              ? `Changes from version ${detail.parent.version} to version ${detail.draft.version}`
              : `Version ${detail.draft.version} (first saved version)`}
            <span className="ml-2 font-mono text-teal-700">+{stats.added}</span>{" "}
            <span className="font-mono text-rose-700">−{stats.removed}</span>
          </p>
          <button
            type="button"
            className="text-xs font-semibold text-teal-700 hover:text-teal-900"
            onClick={() => setShowAll((value) => !value)}
            aria-pressed={showAll}
          >
            {showAll ? "Show changes only" : "Show full document"}
          </button>
        </div>
        <div
          className="mt-2 max-h-80 overflow-auto rounded-xl border border-slate-200 bg-slate-50 font-mono text-[11px] leading-5"
          aria-label="Markdown diff"
          role="region"
          tabIndex={0}
        >
          {stats.added + stats.removed === 0 && detail.parent ? (
            <p className="p-3 text-slate-500">
              No text changed between these versions.
            </p>
          ) : (
            blocks.map((block, index) =>
              block.kind === "gap" ? (
                <p
                  key={index}
                  className="bg-slate-100 px-3 py-0.5 text-slate-400"
                >
                  … {block.count} unchanged line{block.count === 1 ? "" : "s"}
                </p>
              ) : (
                block.lines.map((line, lineIndex) => (
                  <p
                    key={`${index}-${lineIndex}`}
                    className={cn(
                      "px-3 whitespace-pre-wrap break-words",
                      line.kind === "added" && "bg-teal-50 text-teal-900",
                      line.kind === "removed" &&
                        "bg-rose-50 text-rose-900 line-through decoration-rose-300",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="mr-2 select-none text-slate-400"
                    >
                      {line.kind === "added"
                        ? "+"
                        : line.kind === "removed"
                          ? "−"
                          : " "}
                    </span>
                    <span className="sr-only">
                      {line.kind === "added"
                        ? "Added: "
                        : line.kind === "removed"
                          ? "Removed: "
                          : ""}
                    </span>
                    {line.text || " "}
                  </p>
                ))
              ),
            )
          )}
        </div>
      </div>

      {detail.revision && (
        <div className="space-y-3 rounded-xl border border-slate-200 p-3">
          <p className="text-xs font-semibold text-slate-800">
            Revision cycle {detail.revision.iteration}
          </p>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-teal-700">
              Student-accepted findings that motivated this revision
            </p>
            {detail.revision.motivatingFindings.length ? (
              <ul className="mt-1 space-y-1">
                {detail.revision.motivatingFindings.map((finding) => (
                  <li key={finding.id} className="text-xs text-slate-600">
                    <span className="font-medium text-slate-800">
                      {finding.title}
                    </span>{" "}
                    ({finding.severity}) ·{" "}
                    {finding.resolution === "resolved"
                      ? "later marked addressed by Agent A"
                      : "accepted by the student"}
                    {finding.decisionNote
                      ? ` · note: ${finding.decisionNote}`
                      : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-slate-500">
                No accepted findings are linked.
              </p>
            )}
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-700">
              Changes claimed by Agent B (not independently verified)
            </p>
            {detail.revision.claimedChanges.some(
              (item) => item.items.length,
            ) ? (
              <ul className="mt-1 space-y-1">
                {detail.revision.claimedChanges.map((item) =>
                  item.items.map((change, index) => (
                    <li
                      key={`${item.questionNumber}-${index}`}
                      className="text-xs text-slate-600"
                    >
                      Question {item.questionNumber ?? "?"}: {change}
                    </li>
                  )),
                )}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-slate-500">
                No change summary was recorded.
              </p>
            )}
            <p className="mt-1 text-[11px] text-slate-500">
              Only a later Agent A review of this version can confirm these
              fixes.
            </p>
          </div>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Answers saved">
          {validation.answersSaved} of {validation.questionCount} questions
        </Field>
        <Field label="Citations verified">
          {validation.verifiedCitationCount} of {validation.citationCount}
        </Field>
        <Field label="Failed model requests">
          {validation.failedModelRequests ?? "Not applicable (manual save)"}
        </Field>
      </dl>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Evidence cited in this version
        </p>
        {detail.citations.length ? (
          <ul className="mt-1 space-y-1">
            {detail.citations.map((citation) => (
              <li
                key={citation.id}
                className="flex flex-wrap items-center gap-2 text-xs text-slate-600"
              >
                <span>Q{citation.questionNumber}</span>
                <span className="min-w-0 truncate font-medium text-slate-800">
                  {citation.title ?? citation.sourceId}
                </span>
                <span className="text-slate-400">
                  {citation.sourceType === "external" ? "External" : "Course"}
                  {citation.locator ? ` · ${citation.locator}` : ""}
                </span>
                <StatusBadge tone={citation.verified ? "success" : "warning"}>
                  {citation.verified ? "Verified by Agent A" : "Unverified"}
                </StatusBadge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-slate-500">No stored citations.</p>
        )}
      </div>
    </div>
  );
}

function SourceLegend() {
  return (
    <ul className="mt-3 flex flex-wrap gap-2 text-[11px]" aria-label="Legend">
      <li>
        <StatusBadge tone="info">AI assessment</StatusBadge>
      </li>
      <li>
        <StatusBadge tone="neutral">Deterministic check</StatusBadge>
      </li>
      <li>
        <StatusBadge tone="success">Student decision</StatusBadge>
      </li>
      <li>
        <StatusBadge tone="warning">Missing or failed</StatusBadge>
      </li>
    </ul>
  );
}

const criterionTone: Record<CriterionEvaluationStatus, Tone> = {
  not_evaluated: "warning",
  in_progress: "neutral",
  validation_failed: "warning",
  evaluation_failed: "warning",
  evaluation_stopped: "warning",
  findings_recorded: "info",
  no_linked_findings: "info",
};

const gateLabels: Record<string, string> = {
  requirementCoverage: "Requirement coverage",
  evidenceGrounding: "Evidence grounding",
  citationTraceability: "Citation traceability",
  criticalReasoning: "Critical reasoning",
  academicClarity: "Academic clarity",
};

function RubricTraceView({ trace }: { trace: RubricTrace }) {
  const { report, deterministicChecks: checks } = trace;
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Draft version">
          Version {report.draftVersion ?? "?"}
        </Field>
        <Field label="Reviewer run">
          {report.runId ? (
            <CopyableId label="reviewer run ID" value={report.runId} />
          ) : (
            "Run record missing"
          )}
        </Field>
        <Field label="Configured model">
          <span className="font-mono">{report.runModel ?? "—"}</span>
        </Field>
        <Field label="Report status">
          {reportStatusLabel(report.overallStatus)}
        </Field>
        {report.runErrorCode && (
          <Field label="Run error">
            <span className="font-mono text-rose-700">
              {report.runErrorCode}
            </span>
          </Field>
        )}
        {report.estimatedScore !== null && (
          <Field label="Advisory estimate">
            {report.estimatedScore} (AI estimate, not a grade)
          </Field>
        )}
      </dl>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Deterministic checks (computed by code from stored records)
        </p>
        {checks ? (
          <ul className="mt-2 grid gap-1 text-xs text-slate-700 sm:grid-cols-2">
            <li>
              Questions reviewed: {checks.questionsReviewed ?? "?"} of{" "}
              {checks.expectedQuestions ?? "?"}
            </li>
            <li>
              Citations verified: {checks.citationsVerified ?? "?"} of{" "}
              {checks.citationCount ?? "?"}
            </li>
            <li>Required findings: {checks.requiredFindings ?? "?"}</li>
            <li>
              Unverified prior corrections:{" "}
              {checks.unresolvedPriorFindings ?? "?"}
            </li>
            <li className="sm:col-span-2 font-semibold">
              All defined gates {checks.passed ? "passed" : "not passed"} ·
              student approval still required
            </li>
          </ul>
        ) : (
          <p className="mt-2 text-xs text-amber-800">
            {report.overallStatus === "failed"
              ? "No checks were computed because the review failed."
              : report.overallStatus === "cancelled"
                ? "No checks were computed because the review was stopped."
                : "Checks are computed once every question has been reviewed."}
          </p>
        )}
      </div>

      <ol className="space-y-3">
        {trace.criteria.map((criterion) => (
          <li
            key={criterion.id}
            className="rounded-xl border border-slate-200 p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-xs font-semibold text-slate-900">
                {criterion.title}
                {criterion.weight !== null && (
                  <span className="ml-1 font-normal text-slate-500">
                    ({criterion.weight}%)
                  </span>
                )}
              </p>
              <StatusBadge tone={criterionTone[criterion.status]}>
                {criterionStatusLabels[criterion.status]}
                {criterion.status === "findings_recorded"
                  ? ` (${criterion.findings.length})`
                  : ""}
              </StatusBadge>
            </div>
            {criterion.previousFindingCount !== null && (
              <p className="mt-1 text-[11px] text-slate-500">
                Previous review: {criterion.previousFindingCount} linked finding
                {criterion.previousFindingCount === 1 ? "" : "s"} → this review:{" "}
                {criterion.findings.length}
              </p>
            )}
            {criterion.findings.length > 0 && (
              <ul className="mt-2 space-y-2">
                {criterion.findings.map((finding) => (
                  <FindingItem key={finding.id} finding={finding} />
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>

      {trace.unlinkedFindings.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Findings not linked to a rubric criterion
          </p>
          <ul className="mt-2 space-y-2">
            {trace.unlinkedFindings.map((finding) => (
              <FindingItem key={finding.id} finding={finding} />
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-700">
          Agent A per-question assessments (AI, after the reviewer&apos;s
          code-level overrides)
        </p>
        {trace.modelAssessments.length ? (
          <ul className="mt-2 space-y-2">
            {trace.modelAssessments.map((item, index) => (
              <li
                key={`${item.questionNumber}-${index}`}
                className="rounded-xl bg-sky-50/60 p-3 text-xs text-slate-700"
              >
                <p className="font-semibold">
                  Question {item.questionNumber ?? "?"}
                  {item.confidenceScore !== null
                    ? ` · reviewer confidence ${item.confidenceScore}/100`
                    : ""}
                  {item.citationCount !== null
                    ? ` · ${item.verifiedCitationCount ?? 0}/${item.citationCount} citations verified`
                    : ""}
                </p>
                <ul className="mt-1 flex flex-wrap gap-1">
                  {Object.entries(item.qualityGates).map(([gate, passed]) => (
                    <li key={gate}>
                      <StatusBadge tone={passed ? "info" : "warning"}>
                        {gateLabels[gate] ?? gate}: {passed ? "met" : "not met"}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
                {item.uncertaintyReasons.length > 0 && (
                  <ul className="mt-1 list-disc pl-4 text-slate-500">
                    {item.uncertaintyReasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-amber-800">
            No per-question assessment was recorded.
          </p>
        )}
      </div>

      {report.unresolvedConcerns.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Unresolved concerns
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-600">
            {report.unresolvedConcerns.map((concern) => (
              <li key={concern}>{concern}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FindingItem({
  finding,
}: {
  finding: RubricTrace["unlinkedFindings"][number];
}) {
  return (
    <li className="rounded-lg bg-sky-50/60 p-2.5 text-xs text-slate-700">
      <p className="font-semibold text-slate-900">
        <StatusBadge tone="info" className="mr-1">
          AI
        </StatusBadge>
        {finding.title}{" "}
        <span className="font-normal text-slate-500">
          · {finding.severity}
          {finding.required ? " · required" : ""}
          {finding.questionNumber
            ? ` · question ${finding.questionNumber}`
            : ""}
        </span>
      </p>
      <p className="mt-1 leading-5">{finding.explanation}</p>
      {finding.evidence && (
        <p className="mt-1 leading-5 text-slate-500">
          Evidence: {finding.evidence}
        </p>
      )}
      {finding.location && (
        <p className="mt-1 text-slate-500">Location: {finding.location}</p>
      )}
      <p className="mt-1 font-medium">
        Suggested fix: {finding.recommendedCorrection}
      </p>
      <p className="mt-2">
        {finding.resolution === "open" ? (
          <StatusBadge tone="warning">Awaiting student decision</StatusBadge>
        ) : finding.resolution === "resolved" ? (
          <StatusBadge tone="info">
            Marked addressed by Agent A in a later review
          </StatusBadge>
        ) : (
          <StatusBadge tone="success">
            Student {finding.resolution}
            {finding.decidedAt ? ` · ${formatClock(finding.decidedAt)}` : ""}
          </StatusBadge>
        )}
        {finding.decisionNote && (
          <span className="ml-2 text-slate-500">
            Note: {finding.decisionNote}
          </span>
        )}
      </p>
    </li>
  );
}
