import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentActivityTracker } from "@/features/agents/agent-activity-tracker";
import {
  activityCompletedSteps,
  activityTransferStatus,
  hasActiveRuns,
  latestRunForAgent,
  type ActivityRun,
} from "@/features/agents/activity-model";

const activeRun: ActivityRun = {
  id: "11111111-1111-4111-8111-111111111111",
  agent: "student",
  status: "running",
  workflowState: "DRAFTING",
  provider: "ollama",
  model: "qwen3:8b",
  createdAt: "2026-10-20T10:00:00.000Z",
  startedAt: "2026-10-20T10:00:01.000Z",
  completedAt: null,
  assignmentId: "22222222-2222-4222-8222-222222222222",
  assignmentTitle: "Evidence-based essay",
  courseId: "33333333-3333-4333-8333-333333333333",
  courseCode: "ENG101",
  courseTitle: "English",
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("agent activity model", () => {
  it("maps real run states to tracker progress", () => {
    expect(activityTransferStatus("running")).toBe("processing");
    expect(activityTransferStatus("completed")).toBe("completed");
    expect(activityTransferStatus("cancelled")).toBe("failed");
    expect(activityCompletedSteps(activeRun)).toBe(2);
    expect(hasActiveRuns([activeRun])).toBe(true);
    expect(latestRunForAgent([activeRun], "student")).toBe(activeRun);
  });
});

describe("AgentActivityTracker", () => {
  it("shows Agent A, B, and C without fake financial data", () => {
    render(<AgentActivityTracker initialRuns={[]} />);

    expect(screen.getByText("Agent A")).toBeInTheDocument();
    expect(screen.getByText("Agent B")).toBeInTheDocument();
    expect(screen.getByText("Agent C")).toBeInTheDocument();
    expect(screen.getByText("All agents settled")).toBeInTheDocument();
    expect(screen.queryByText(/USD|EUR|payment|bank/i)).not.toBeInTheDocument();
  });

  it("polls while active and stops after refreshed runs settle", async () => {
    vi.useFakeTimers();
    const completedRun = {
      ...activeRun,
      status: "completed" as const,
      completedAt: "2026-10-20T10:00:10.000Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ runs: [completedRun] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AgentActivityTracker initialRuns={[activeRun]} />);

    expect(screen.getByText("Live updates on")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/agent-activity", {
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
    expect(screen.getByText("All agents settled")).toBeInTheDocument();
  });
});
