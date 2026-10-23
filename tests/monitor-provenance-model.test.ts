import { describe, expect, it } from "vitest";

import {
  classifyDraftOrigin,
  criterionEvaluationStatus,
  diffLines,
  diffStats,
} from "@/features/monitoring/provenance-model";

describe("draft origin", () => {
  const base = {
    createdByAgent: null,
    sourceRunId: null,
    runAgent: null,
    runStatus: null,
    isRevisionTarget: false,
  };

  it("attributes a manual save to a person", () => {
    expect(classifyDraftOrigin(base)).toBe("student_edited");
  });

  it("attributes to an agent only with a completed linked Agent B run", () => {
    const linked = {
      ...base,
      createdByAgent: "student",
      sourceRunId: "run-1",
      runAgent: "student",
    };
    expect(classifyDraftOrigin({ ...linked, runStatus: "completed" })).toBe(
      "ai_generated",
    );
    expect(
      classifyDraftOrigin({
        ...linked,
        runStatus: "completed",
        isRevisionTarget: true,
      }),
    ).toBe("ai_revised");
    expect(classifyDraftOrigin({ ...linked, runStatus: "failed" })).toBe(
      "incomplete",
    );
  });

  it("refuses attribution when the run link is missing or wrong", () => {
    expect(classifyDraftOrigin({ ...base, createdByAgent: "student" })).toBe(
      "unverified",
    );
    expect(
      classifyDraftOrigin({
        ...base,
        sourceRunId: "run-1",
        runAgent: "reviewer",
        runStatus: "completed",
      }),
    ).toBe("unverified");
  });
});

describe("criterion evaluation status", () => {
  it("reports missing and failed evaluations explicitly", () => {
    expect(
      criterionEvaluationStatus({
        reportStatus: null,
        runErrorCode: null,
        findingCount: 0,
      }),
    ).toBe("not_evaluated");
    expect(
      criterionEvaluationStatus({
        reportStatus: "failed",
        runErrorCode: "AI_RESPONSE_INVALID",
        findingCount: 0,
      }),
    ).toBe("validation_failed");
    expect(
      criterionEvaluationStatus({
        reportStatus: "failed",
        runErrorCode: "AI_TIMEOUT",
        findingCount: 0,
      }),
    ).toBe("evaluation_failed");
    expect(
      criterionEvaluationStatus({
        reportStatus: "in_progress",
        runErrorCode: null,
        findingCount: 0,
      }),
    ).toBe("in_progress");
  });

  it("never turns an absence of findings into a pass", () => {
    expect(
      criterionEvaluationStatus({
        reportStatus: "quality_gates_passed",
        runErrorCode: null,
        findingCount: 0,
      }),
    ).toBe("no_linked_findings");
    expect(
      criterionEvaluationStatus({
        reportStatus: "changes_required",
        runErrorCode: null,
        findingCount: 2,
      }),
    ).toBe("findings_recorded");
  });
});

describe("line diff", () => {
  it("marks added, removed, and unchanged lines", () => {
    const lines = diffLines("a\nb\nc\nd", "a\nB\nc\nd\ne");
    expect(lines).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
      { kind: "same", text: "c" },
      { kind: "same", text: "d" },
      { kind: "added", text: "e" },
    ]);
    expect(diffStats(lines)).toEqual({ added: 2, removed: 1 });
  });

  it("treats a first version as entirely added", () => {
    expect(diffStats(diffLines("", "one\ntwo"))).toEqual({
      added: 2,
      removed: 1,
    });
  });

  it("reports no changes for identical documents", () => {
    expect(diffStats(diffLines("x\ny", "x\ny"))).toEqual({
      added: 0,
      removed: 0,
    });
  });
});
