import { describe, expect, it } from "vitest";
import {
  computeRubricScale,
  getScaleLevel,
} from "@/features/assignments/rubric-scale";

describe("rubric-scale", () => {
  it("computes baseline scale levels correctly", () => {
    expect(getScaleLevel(95)).toEqual({
      level: "exemplary",
      label: "Exemplary",
    });
    expect(getScaleLevel(80)).toEqual({
      level: "proficient",
      label: "Proficient",
    });
    expect(getScaleLevel(65)).toEqual({
      level: "developing",
      label: "Developing",
    });
    expect(getScaleLevel(40)).toEqual({
      level: "at_risk",
      label: "Needs Attention",
    });
  });

  it("handles empty criteria list gracefully", () => {
    const result = computeRubricScale({
      criteria: [],
      hasDraft: false,
      answers: [],
    });
    expect(result.overallScore).toBe(100);
    expect(result.criteria).toHaveLength(0);
  });

  it("calculates draft baseline when unreviewed", () => {
    const criteria = [
      {
        id: "c1",
        title: "Global code quality",
        description: "Clean code",
        weight: 50,
        position: 1,
      },
      {
        id: "c2",
        title: "Task 1 PoS analysis",
        description: "Correct PoS",
        weight: 50,
        position: 2,
      },
    ];
    const answers = [
      { questionId: "q1", markdown: "Substantive answer" },
      { questionId: "q2", markdown: "" },
    ];

    const result = computeRubricScale({
      criteria,
      hasDraft: true,
      answers,
      hasReviewReport: false,
    });

    expect(result.hasReview).toBe(false);
    expect(result.overallScore).toBeGreaterThan(0);
    expect(result.criteria).toHaveLength(2);
  });

  it("accurately detects regressions and improvements across reviews", () => {
    const criteria = [
      {
        id: "c1",
        title: "Code quality",
        description: "Modular",
        weight: 50,
        position: 1,
      },
      {
        id: "c2",
        title: "Evidence",
        description: "Citations",
        weight: 50,
        position: 2,
      },
    ];
    const answers = [
      { questionId: "q1", markdown: "Answer text" },
      { questionId: "q2", markdown: "Answer text" },
    ];

    // Previous review had 1 critical finding on c1, 0 on c2
    const previousReviewItems = [
      {
        id: "prev-1",
        rubricCriterionId: "c1",
        severity: "critical",
        title: "Broken code",
        recommendedCorrection: "Fix syntax",
        resolution: "open",
      },
    ];

    // Current review fixed c1 (resolved), but found a minor finding on c2
    const currentReviewItems = [
      {
        id: "cur-1",
        rubricCriterionId: "c1",
        severity: "critical",
        title: "Broken code",
        recommendedCorrection: "Fix syntax",
        resolution: "resolved",
      },
      {
        id: "cur-2",
        rubricCriterionId: "c2",
        severity: "minor",
        title: "Typo in citation",
        recommendedCorrection: "Check author",
        resolution: "open",
      },
    ];

    const result = computeRubricScale({
      criteria,
      hasDraft: true,
      answers,
      reviewItems: currentReviewItems,
      previousReviewItems,
      hasReviewReport: true,
      hasPreviousReviewReport: true,
    });

    // c1 improved from critical penalty to resolved bonus
    const c1 = result.criteria.find((c) => c.id === "c1");
    expect(c1?.trend).toBe("better");
    expect(c1?.delta).toBeGreaterThan(0);

    // c2 got worse (regressed from 95 to 87)
    const c2 = result.criteria.find((c) => c.id === "c2");
    expect(c2?.trend).toBe("regressed");
    expect(c2?.delta).toBeLessThan(0);

    // overall score moved
    expect(result.overallDelta).not.toBeNull();
  });
});
