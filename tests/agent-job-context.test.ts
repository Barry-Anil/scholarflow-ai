import { describe, expect, it } from "vitest";

import {
  acceptedFindingIdsForRevision,
  DRAFT_JOB_TYPE,
  isDraftRunContextValid,
  RESEARCH_JOB_TYPE,
  REVIEW_JOB_TYPE,
  REVISION_JOB_TYPE,
} from "@/features/agents/contracts";

describe("agent draft job context", () => {
  const draftRunId = "11111111-1111-4111-8111-111111111111";
  const reviewRunId = "22222222-2222-4222-8222-222222222222";

  it("requires Agent B to operate only on the draft created by its own run", () => {
    expect(isDraftRunContextValid(DRAFT_JOB_TYPE, draftRunId, draftRunId)).toBe(
      true,
    );
    expect(
      isDraftRunContextValid(DRAFT_JOB_TYPE, draftRunId, reviewRunId),
    ).toBe(false);
    expect(isDraftRunContextValid(DRAFT_JOB_TYPE, null, draftRunId)).toBe(
      false,
    );
  });

  it("allows Agent A to review an existing student or Agent B draft", () => {
    expect(
      isDraftRunContextValid(REVIEW_JOB_TYPE, draftRunId, reviewRunId),
    ).toBe(true);
    expect(isDraftRunContextValid(REVIEW_JOB_TYPE, null, reviewRunId)).toBe(
      true,
    );
  });

  it("requires a revision job to own its new target draft", () => {
    expect(
      isDraftRunContextValid(REVISION_JOB_TYPE, reviewRunId, reviewRunId),
    ).toBe(true);
    expect(
      isDraftRunContextValid(REVISION_JOB_TYPE, draftRunId, reviewRunId),
    ).toBe(false);
  });

  it("does not treat unrelated job types as valid draft operations", () => {
    expect(
      isDraftRunContextValid(RESEARCH_JOB_TYPE, draftRunId, draftRunId),
    ).toBe(false);
  });

  it("requires a non-empty locked finding set and deduplicates its snapshot", () => {
    expect(acceptedFindingIdsForRevision([])).toEqual([]);
    expect(
      acceptedFindingIdsForRevision([
        { id: "finding-a" },
        { id: "finding-a" },
        { id: "finding-b" },
      ]),
    ).toEqual(["finding-a", "finding-b"]);
  });
});
