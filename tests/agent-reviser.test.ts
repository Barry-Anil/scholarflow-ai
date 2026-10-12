import { describe, expect, it } from "vitest";

import {
  buildRevisionPrompt,
  reviseQuestionFromFindings,
  type RevisionInput,
} from "@/features/agents/reviser";
import type {
  StructuredAiProvider,
  StructuredGenerationRequest,
} from "@/lib/ai/types";

function providerWith(value: unknown): StructuredAiProvider {
  return {
    async generateObject<T>(request: StructuredGenerationRequest<T>) {
      return {
        value: request.schema.parse(value),
        provider: "test",
        model: request.model,
        inputTokens: 20,
        outputTokens: 30,
        latencyMs: 3,
      };
    },
  };
}

const input: RevisionInput = {
  question: "Evaluate the theory.",
  requirements: ["Address a counterargument"],
  wordLimit: 500,
  currentAnswer: "The theory is persuasive.",
  rubric: [{ title: "Analysis", description: "Evaluates views", weight: 50 }],
  findings: [
    {
      id: "finding-a",
      severity: "major",
      explanation: "The counterargument is missing.",
      recommendedCorrection: "Add and answer the strongest objection.",
      studentNote: "Keep the response concise.",
    },
  ],
  evidence: [
    {
      sourceId: "source-a",
      sourceLabel: "Course reading",
      evidence: "The reading presents a substantial objection.",
    },
  ],
};

describe("Agent B controlled revision", () => {
  it("removes citations outside the saved evidence allow-list", async () => {
    const result = await reviseQuestionFromFindings(
      providerWith({
        markdown: "A revised answer.",
        citations: [
          { sourceId: "source-a", claimText: "Supported", locator: "Page 2" },
          { sourceId: "invented", claimText: "Invented", locator: null },
        ],
        confidenceScore: 85,
        confidenceReasons: ["The revision addresses the accepted finding."],
        changeSummary: ["Added and evaluated a counterargument."],
      }),
      "writer-model",
      input,
    );

    expect(result.answer.citations).toHaveLength(1);
    expect(result.answer.citations[0]?.sourceId).toBe("source-a");
  });

  it("marks the answer, findings, and evidence as bounded untrusted inputs", () => {
    const prompt = buildRevisionPrompt(input);
    expect(prompt).toContain("UNTRUSTED CURRENT ANSWER");
    expect(prompt).toContain("ACCEPTED FINDINGS");
    expect(prompt).toContain('id="finding-a"');
    expect(prompt).toContain('id="source-a"');
  });
});
