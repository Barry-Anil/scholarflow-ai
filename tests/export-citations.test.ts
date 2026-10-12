import { describe, expect, it } from "vitest";

import { evaluateApprovalReadiness } from "@/features/exports/approval";
import {
  citationLocator,
  citationTitle,
  formatReference,
  type CitationLike,
} from "@/features/exports/citation-format";
import {
  AI_USE_DISCLOSURE,
  buildMarkdownExport,
  type AssignmentExportModel,
} from "@/features/exports/content";

const localCitation: CitationLike = {
  id: "citation-local",
  sourceType: "course_material",
  sourceId: "chunk-1",
  claimText: "The lecture defines the key concept.",
  locator: "Page 7",
  metadata: { title: "Week 3 lecture notes.pdf", pageStart: 7 },
  verified: true,
};

const externalCitation: CitationLike = {
  id: "citation-external",
  sourceType: "external",
  sourceId: "doi:10.1000/example",
  claimText: "The study reports the observed relationship.",
  locator: null,
  metadata: {
    title: "A careful study",
    authors: ["Alex Smith", "Priya Rao"],
    year: 2025,
    containerTitle: "Journal of Examples",
    doi: "10.1000/example",
  },
  verified: true,
};

describe("citation rendering", () => {
  it("uses stored local metadata and locator without inventing authors", () => {
    expect(citationTitle(localCitation)).toBe("Week 3 lecture notes.pdf");
    expect(citationLocator(localCitation)).toBe("Page 7");
    expect(formatReference(localCitation)).toBe(
      "Week 3 lecture notes.pdf. Page 7. Course material",
    );
  });

  it("formats available scholarly metadata and a normalized DOI link", () => {
    expect(formatReference(externalCitation)).toBe(
      "Alex Smith & Priya Rao (2025). A careful study. Journal of Examples. https://doi.org/10.1000/example",
    );
  });

  it("falls back to the stored source identifier when title metadata is absent", () => {
    expect(
      formatReference({
        ...localCitation,
        sourceId: "stored-source-id",
        metadata: {},
        locator: null,
      }),
    ).toBe("stored-source-id. Course material");
  });
});

describe("strict approval readiness", () => {
  const ready = {
    latestDraftExists: true,
    latestReviewStatus: "quality_gates_passed",
    reviewPassed: true,
    citationCount: 2,
    verifiedCitationCount: 2,
    activeAgentOperations: 0,
  };

  it("passes only when every strict gate passes", () => {
    expect(evaluateApprovalReadiness(ready).ready).toBe(true);
  });

  it.each([
    { citationCount: 0, verifiedCitationCount: 0 },
    { verifiedCitationCount: 1 },
    { reviewPassed: false },
    { latestReviewStatus: "changes_required" },
    { activeAgentOperations: 1 },
    { latestDraftExists: false },
  ])("blocks when a required gate changes: %o", (change) => {
    expect(evaluateApprovalReadiness({ ...ready, ...change }).ready).toBe(
      false,
    );
  });
});

describe("approved Markdown export", () => {
  it("includes answers, numbered references, approval status, and AI disclosure", () => {
    const model: AssignmentExportModel = {
      assignmentTitle: "Evidence review",
      courseLabel: "SOC101",
      draftVersion: 4,
      approvedAt: new Date("2026-10-10T10:00:00.000Z"),
      reviewStatus: "quality_gates_passed",
      answers: [
        {
          position: 0,
          prompt: "Evaluate the evidence.",
          markdown: "The evidence supports a qualified conclusion.",
          citations: [localCitation, externalCitation],
        },
      ],
    };
    const markdown = buildMarkdownExport(model);
    expect(markdown).toContain("# Evidence review");
    expect(markdown).toContain("Approved draft:** Version 4");
    expect(markdown).toContain("[1] Week 3 lecture notes.pdf");
    expect(markdown).toContain("[2] Alex Smith & Priya Rao (2025)");
    expect(markdown).toContain(AI_USE_DISCLOSURE);
    expect(markdown).not.toContain("undefined");
  });
});
