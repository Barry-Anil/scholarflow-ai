import type { AgentActivityStatus } from "@/components/kokonutui/currency-transfer";

export type ActivityAgent = "student" | "researcher" | "reviewer" | "system";
export type ActivityRunStatus =
  "queued" | "running" | "completed" | "failed" | "cancelled";

export type ActivityRun = {
  id: string;
  agent: ActivityAgent;
  status: ActivityRunStatus;
  workflowState: string;
  provider: string | null;
  model: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  assignmentId: string;
  assignmentTitle: string;
  courseId: string;
  courseCode: string | null;
  courseTitle: string;
};

export const activityAgents = [
  {
    agent: "reviewer" as const,
    label: "Agent A",
    role: "Independent reviewer",
  },
  { agent: "student" as const, label: "Agent B", role: "Writer and reviser" },
  {
    agent: "researcher" as const,
    label: "Agent C",
    role: "Evidence researcher",
  },
];

export function latestRunForAgent(runs: ActivityRun[], agent: ActivityAgent) {
  return runs.find((run) => run.agent === agent);
}

export function hasActiveRuns(runs: ActivityRun[]) {
  return runs.some(
    (run) => run.status === "queued" || run.status === "running",
  );
}

export function activityTransferStatus(
  status?: ActivityRunStatus,
): AgentActivityStatus {
  if (!status) return "idle";
  if (status === "queued" || status === "running") return "processing";
  if (status === "completed") return "completed";
  return "failed";
}

export function activityCompletedSteps(run?: ActivityRun) {
  if (!run) return 0;
  if (run.status === "completed") return 4;
  if (run.status === "queued") return 1;
  return run.startedAt ? 2 : 1;
}
