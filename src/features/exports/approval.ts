export const APPROVAL_ATTESTATION =
  "I have inspected this draft, its citations, and Agent A's review, and I approve this exact version for export.";
export const APPROVAL_ATTESTATION_VERSION = "student-approval-v1";

export type ApprovalReadinessInput = {
  latestDraftExists: boolean;
  latestReviewStatus: string | null;
  reviewPassed: boolean;
  citationCount: number;
  verifiedCitationCount: number;
  activeAgentOperations: number;
};

export function evaluateApprovalReadiness(input: ApprovalReadinessInput) {
  const checks = [
    {
      key: "latest-draft",
      label: "The latest visible draft is selected",
      passed: input.latestDraftExists,
    },
    {
      key: "review",
      label: "Agent A completed review and every defined quality gate passed",
      passed:
        input.latestReviewStatus === "quality_gates_passed" &&
        input.reviewPassed,
    },
    {
      key: "citations",
      label: "Every stored citation is verified",
      passed:
        input.citationCount > 0 &&
        input.verifiedCitationCount === input.citationCount,
    },
    {
      key: "operations",
      label: "No agent operation is active",
      passed: input.activeAgentOperations === 0,
    },
  ];
  return { ready: checks.every((check) => check.passed), checks };
}
