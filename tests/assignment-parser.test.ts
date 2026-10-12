import { describe, expect, it } from "vitest";

import {
  countWords,
  parseAssignmentQuestions,
  parseRubricCriteria,
} from "@/features/assignments/parser";

describe("assignment parser", () => {
  it("extracts numbered questions, requirements, and word limits", () => {
    const questions = parseAssignmentQuestions(`
Question 1. Explain social constructionism (500 words)
- Use at least two course readings
- Define the key terms

Q2: Apply the theory to a contemporary case (1,200 words)
* Address one counterargument
`);

    expect(questions).toEqual([
      {
        prompt: "Explain social constructionism (500 words)",
        requirements: [
          "Use at least two course readings",
          "Define the key terms",
        ],
        wordLimit: 500,
      },
      {
        prompt: "Apply the theory to a contemporary case (1,200 words)",
        requirements: ["Address one counterargument"],
        wordLimit: 1200,
      },
    ]);
  });

  it("creates one safe fallback question for an unnumbered brief", () => {
    expect(
      parseAssignmentQuestions(
        "Write a reflective analysis of the weekly readings.\n- Compare two authors",
      ),
    ).toEqual([
      {
        prompt: "Write a reflective analysis of the weekly readings.",
        requirements: ["Compare two authors"],
        wordLimit: null,
      },
    ]);
  });

  it("extracts rubric titles, descriptions, and percentages", () => {
    expect(
      parseRubricCriteria(
        "Critical analysis (40%) - Evaluates competing views\nEvidence 30%: Uses credible course sources\nClarity",
      ),
    ).toEqual([
      {
        title: "Critical analysis",
        description: "Evaluates competing views",
        weight: 40,
      },
      {
        title: "Evidence",
        description: "Uses credible course sources",
        weight: 30,
      },
      { title: "Clarity", description: "Clarity", weight: null },
    ]);
  });

  it("counts words consistently for persisted draft metadata", () => {
    expect(countWords("  One two\nthree.  ")).toBe(3);
    expect(countWords("   ")).toBe(0);
  });
});
