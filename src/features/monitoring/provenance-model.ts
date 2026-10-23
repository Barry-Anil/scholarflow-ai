// Pure provenance rules shared by the provenance API and the drawer.

export type DraftOrigin =
  | "ai_generated"
  | "ai_revised"
  | "student_edited"
  | "incomplete"
  | "unverified";

export const draftOriginLabels: Record<DraftOrigin, string> = {
  ai_generated: "AI-generated (Agent B run)",
  ai_revised: "AI-revised (Agent B revision run)",
  student_edited: "Saved by a person",
  incomplete: "Agent run not completed",
  unverified: "Attribution unverifiable",
};

/**
 * A draft is attributed to an agent only when a persisted Agent B run is
 * linked to that exact version and completed. Manual saves carry no run.
 */
export function classifyDraftOrigin(draft: {
  createdByAgent: string | null;
  sourceRunId: string | null;
  runAgent: string | null;
  runStatus: string | null;
  isRevisionTarget: boolean;
}): DraftOrigin {
  if (!draft.sourceRunId) {
    return draft.createdByAgent ? "unverified" : "student_edited";
  }
  if (draft.runAgent !== "student") return "unverified";
  if (draft.runStatus !== "completed") return "incomplete";
  return draft.isRevisionTarget ? "ai_revised" : "ai_generated";
}

export type CriterionEvaluationStatus =
  | "not_evaluated"
  | "in_progress"
  | "validation_failed"
  | "evaluation_failed"
  | "evaluation_stopped"
  | "findings_recorded"
  | "no_linked_findings";

export const criterionStatusLabels: Record<CriterionEvaluationStatus, string> =
  {
    not_evaluated: "Not evaluated",
    in_progress: "Evaluation in progress",
    validation_failed: "Validation failed",
    evaluation_failed: "Evaluation failed",
    evaluation_stopped: "Evaluation stopped before completion",
    findings_recorded: "Findings recorded",
    no_linked_findings: "Reviewed · no criterion-linked findings",
  };

/**
 * Agent A records findings, not per-criterion scores, so a criterion without
 * findings is reported as such and never as a pass or a score.
 */
export function criterionEvaluationStatus(input: {
  reportStatus: string | null;
  runErrorCode: string | null;
  findingCount: number;
}): CriterionEvaluationStatus {
  if (!input.reportStatus) return "not_evaluated";
  if (input.reportStatus === "in_progress") return "in_progress";
  if (input.reportStatus === "cancelled") return "evaluation_stopped";
  if (input.reportStatus === "failed") {
    return input.runErrorCode === "AI_RESPONSE_INVALID"
      ? "validation_failed"
      : "evaluation_failed";
  }
  return input.findingCount > 0 ? "findings_recorded" : "no_linked_findings";
}

export type DiffLine = {
  kind: "same" | "added" | "removed";
  text: string;
};

const MAX_DIFF_CELLS = 4_000_000;

/**
 * Line-level LCS diff. Inputs too large for an exact table fall back to a
 * whole-document replacement, which is still accurate, just coarser.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const left = before.split("\n");
  const right = after.split("\n");
  let start = 0;
  while (
    start < left.length &&
    start < right.length &&
    left[start] === right[start]
  ) {
    start += 1;
  }
  let leftEnd = left.length;
  let rightEnd = right.length;
  while (
    leftEnd > start &&
    rightEnd > start &&
    left[leftEnd - 1] === right[rightEnd - 1]
  ) {
    leftEnd -= 1;
    rightEnd -= 1;
  }
  const head: DiffLine[] = left
    .slice(0, start)
    .map((text) => ({ kind: "same", text }));
  const tail: DiffLine[] = left
    .slice(leftEnd)
    .map((text) => ({ kind: "same", text }));
  const a = left.slice(start, leftEnd);
  const b = right.slice(start, rightEnd);

  if (a.length * b.length > MAX_DIFF_CELLS) {
    return [
      ...head,
      ...a.map((text): DiffLine => ({ kind: "removed", text })),
      ...b.map((text): DiffLine => ({ kind: "added", text })),
      ...tail,
    ];
  }

  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      middle.push({ kind: "same", text: a[i]! });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      middle.push({ kind: "removed", text: a[i]! });
      i += 1;
    } else {
      middle.push({ kind: "added", text: b[j]! });
      j += 1;
    }
  }
  while (i < a.length) middle.push({ kind: "removed", text: a[i++]! });
  while (j < b.length) middle.push({ kind: "added", text: b[j++]! });
  return [...head, ...middle, ...tail];
}

export function diffStats(lines: DiffLine[]) {
  return {
    added: lines.filter((line) => line.kind === "added").length,
    removed: lines.filter((line) => line.kind === "removed").length,
  };
}
