import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { stopAgentRunAction, retryAgentRunAction, routerRefresh } = vi.hoisted(
  () => ({
    stopAgentRunAction: vi.fn(),
    retryAgentRunAction: vi.fn(),
    routerRefresh: vi.fn(),
  }),
);
vi.mock("@/features/agents/actions", () => ({
  stopAgentRunAction,
  retryAgentRunAction,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

import { AgentMonitor } from "@/features/monitoring/agent-monitor";
import type {
  MonitorJob,
  MonitorRun,
  MonitorSnapshot,
} from "@/features/monitoring/status-model";

const assignmentId = "22222222-2222-4222-8222-222222222222";
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function job(overrides: Partial<MonitorJob>): MonitorJob {
  return {
    id: "job-1",
    kind: "draft",
    questionId: "q-1",
    questionNumber: 1,
    status: "completed",
    finalizing: false,
    attempts: 1,
    maxAttempts: 3,
    availableAt: iso(-60_000),
    lockedAt: null,
    leaseExpiresAt: null,
    completedAt: iso(-30_000),
    lastErrorCode: null,
    lastError: null,
    ...overrides,
  };
}

function run(overrides: Partial<MonitorRun>): MonitorRun {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    agent: "student",
    status: "running",
    workflowState: "DRAFTING",
    provider: "ollama",
    model: "qwen3:8b",
    createdAt: iso(-120_000),
    startedAt: iso(-100_000),
    completedAt: null,
    errorCode: null,
    errorMessage: null,
    retryable: false,
    jobs: [],
    events: [],
    ...overrides,
  };
}

function snapshot(overrides: Partial<MonitorSnapshot> = {}): MonitorSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    assignmentId,
    canEdit: true,
    config: {
      models: {
        writer: "qwen3:8b",
        researcher: "qwen3:8b",
        reviewer: "qwen3:8b",
        embedding: "nomic-embed-text",
      },
      requestTimeoutMs: 120_000,
      modelGraceMs: 30_000,
      workerStaleMs: 90_000,
      leaseMs: 120_000,
      heartbeatMs: 30_000,
    },
    ollama: {
      state: "reachable",
      checkedAt: iso(-2_000),
      lastSuccessAt: iso(-2_000),
      latencyMs: 14,
      errorCode: null,
      models: [
        { role: "writer", name: "qwen3:8b", installed: true },
        { role: "embedding", name: "nomic-embed-text", installed: false },
      ],
    },
    generation: { lastSuccess: null, lastFailure: null, inFlight: null },
    embeddings: {
      modelInstalled: false,
      chunkCount: 10,
      embeddedChunkCount: 0,
    },
    worker: {
      state: "online",
      startedAt: iso(-600_000),
      lastHeartbeatAt: iso(-5_000),
      stoppedAt: null,
      busy: true,
    },
    queue: {
      queued: 1,
      running: 1,
      retrying: 0,
      completed: 1,
      failed: 0,
      cancelled: 0,
      aheadOfAssignment: 0,
    },
    runs: [],
    ...overrides,
  };
}

const runningDraft = run({
  jobs: [
    job({ id: "job-1", questionNumber: 1, status: "completed" }),
    job({
      id: "job-2",
      questionNumber: 2,
      status: "processing",
      leaseExpiresAt: iso(60_000),
      completedAt: null,
    }),
    job({
      id: "job-3",
      questionNumber: 3,
      status: "queued",
      attempts: 0,
      completedAt: null,
    }),
  ],
  events: [
    {
      id: "e2",
      runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      agent: "student",
      eventType: "draft.model_request_started",
      message: "Sent question 2 to qwen3:8b; waiting for the model response.",
      severity: "info",
      createdAt: iso(-3_000),
      metadata: { jobId: "job-2" },
    },
    {
      id: "e1",
      runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      agent: "student",
      eventType: "draft.question_started",
      message: "Agent B started question 2 (attempt 1 of 3).",
      severity: "info",
      createdAt: iso(-4_000),
      metadata: { jobId: "job-2" },
    },
  ],
});

let current: MonitorSnapshot | null;
let monitorFails = false;

beforeEach(() => {
  window.localStorage.clear();
  monitorFails = false;
  current = snapshot({ runs: [runningDraft] });
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      if (input.includes("/monitor/events")) {
        return Response.json({ events: [], nextCursor: null });
      }
      if (input.includes("/provenance")) {
        return Response.json({ drafts: [], reports: [] });
      }
      if (monitorFails) {
        return Response.json(
          { message: "Service unavailable" },
          { status: 503 },
        );
      }
      return Response.json(current);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openMonitor() {
  render(
    <AgentMonitor
      courseId="11111111-1111-4111-8111-111111111111"
      assignmentId={assignmentId}
    />,
  );
  const trigger = await screen.findByTestId("agent-monitor-trigger");
  await waitFor(() =>
    expect(trigger).toHaveAccessibleName(
      expect.stringMatching(/Status: Running/),
    ),
  );
  fireEvent.click(trigger);
  return {
    trigger,
    dialog: await screen.findByRole("dialog", { name: "Agent monitor" }),
  };
}

describe("AgentMonitor", () => {
  it("summarises status on the trigger and opens and closes the drawer", async () => {
    const { trigger, dialog } = await openMonitor();
    expect(trigger).toHaveAccessibleName(
      expect.stringContaining("2 active tasks"),
    );
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByRole("tab", { name: /Agents/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("switches tabs with the arrow keys", async () => {
    const { dialog } = await openMonitor();
    const agentsTab = within(dialog).getByRole("tab", { name: /Agents/ });
    fireEvent.keyDown(agentsTab, { key: "ArrowLeft" });
    const systemTab = within(dialog).getByRole("tab", { name: /System/ });
    expect(systemTab).toHaveAttribute("aria-selected", "true");
    expect(systemTab).toHaveFocus();
    expect(within(dialog).getByText("Ollama connectivity")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Embeddings unavailable"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/operational without embeddings/),
    ).toBeInTheDocument();
    fireEvent.keyDown(systemTab, { key: "End" });
    expect(
      within(dialog).getByRole("tab", { name: /Changes & Evaluation/ }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      await within(dialog).findByText(/No draft versions/),
    ).toBeInTheDocument();
  });

  it("shows measured progress and an indeterminate bar for the model call", async () => {
    const { dialog } = await openMonitor();
    const progress = within(dialog).getByRole("progressbar", {
      name: "Agent B progress",
    });
    // One of three question tasks saved plus the pending final save: 1 / 4.
    expect(progress).toHaveAttribute("aria-valuenow", "25");
    const stage = within(dialog).getByRole("progressbar", {
      name: /Question 2: Waiting for the model/,
    });
    expect(stage).not.toHaveAttribute("aria-valuenow");
    expect(stage.querySelector("div")?.className).toContain("motion-reduce:");
    expect(
      within(dialog).getAllByText(/Question 2 · Waiting for the model/).length,
    ).toBeGreaterThan(0);
  });

  it("stops the loading animation and shows recovery guidance on failure", async () => {
    current = snapshot({
      runs: [
        run({
          status: "failed",
          completedAt: iso(-1_000),
          errorCode: "AI_RESPONSE_INVALID",
          errorMessage:
            "The AI response did not pass the required validation checks.",
          jobs: [
            job({ id: "job-1", status: "completed" }),
            job({
              id: "job-2",
              questionNumber: 2,
              status: "failed",
              lastError: "Invalid output",
            }),
          ],
        }),
      ],
    });
    render(
      <AgentMonitor
        courseId="11111111-1111-4111-8111-111111111111"
        assignmentId={assignmentId}
      />,
    );
    const trigger = await screen.findByTestId("agent-monitor-trigger");
    await waitFor(() =>
      expect(trigger).toHaveAccessibleName(
        expect.stringMatching(/Status: Failed.*new failure/),
      ),
    );
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/schema validation, so nothing was saved/),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Show task details" }),
    );
    expect(within(dialog).getByText(/Stopped at:/)).toBeInTheDocument();
    expect(dialog.querySelector(".kokonut-ai-wave")).toBeNull();
    expect(
      within(dialog).getByRole("progressbar", { name: "Agent B progress" }),
    ).toHaveAttribute("aria-valuenow", "33");
  });

  it("shows completed runs as finished without a spinner", async () => {
    current = snapshot({
      runs: [
        run({
          status: "completed",
          completedAt: iso(-1_000),
          jobs: [job({ id: "job-1", status: "completed" })],
        }),
      ],
    });
    render(
      <AgentMonitor
        courseId="11111111-1111-4111-8111-111111111111"
        assignmentId={assignmentId}
      />,
    );
    const trigger = await screen.findByTestId("agent-monitor-trigger");
    await waitFor(() =>
      expect(trigger).toHaveAccessibleName(/Status: Completed/),
    );
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Show task details" }),
    );
    expect(within(dialog).getByText(/Worked for/)).toBeInTheDocument();
    expect(dialog.querySelector(".kokonut-ai-wave")).toBeNull();
    expect(
      within(dialog).getByRole("progressbar", { name: "Agent B progress" }),
    ).toHaveAttribute("aria-valuenow", "100");
  });

  it("labels unknown and empty states instead of claiming health", async () => {
    current = snapshot({
      runs: [],
      ollama: {
        state: "unknown",
        checkedAt: null,
        lastSuccessAt: null,
        latencyMs: null,
        errorCode: null,
        models: [{ role: "writer", name: "qwen3:8b", installed: null }],
      },
      worker: {
        state: "unknown",
        startedAt: null,
        lastHeartbeatAt: null,
        stoppedAt: null,
        busy: false,
      },
    });
    render(
      <AgentMonitor
        courseId="11111111-1111-4111-8111-111111111111"
        assignmentId={assignmentId}
      />,
    );
    const trigger = await screen.findByTestId("agent-monitor-trigger");
    await waitFor(() => expect(trigger).toHaveAccessibleName(/Status: Idle/));
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/No Agent C run has been recorded/),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("tab", { name: /System/ }));
    expect(within(dialog).getAllByText("Unknown").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Never reported")).toBeInTheDocument();
  });

  it("reports a load failure instead of showing stale data as live", async () => {
    monitorFails = true;
    render(
      <AgentMonitor
        courseId="11111111-1111-4111-8111-111111111111"
        assignmentId={assignmentId}
      />,
    );
    const trigger = await screen.findByTestId("agent-monitor-trigger");
    await waitFor(() =>
      expect(trigger).toHaveAccessibleName(/Status: Unknown.*out of date/),
    );
    fireEvent.click(trigger);
    expect(
      await screen.findByText(/could not load: Service unavailable/),
    ).toBeInTheDocument();
  });

  it("stops an active run only after confirmation", async () => {
    stopAgentRunAction.mockResolvedValue({
      ok: true,
      message: "Run stopped. 2 unfinished tasks were cancelled.",
    });
    const { dialog } = await openMonitor();
    const card = within(dialog).getByRole("article", {
      name: "Agent B Drafting",
    });
    fireEvent.click(within(card).getByRole("button", { name: /Stop run/ }));
    expect(stopAgentRunAction).not.toHaveBeenCalled();
    expect(
      within(card).getByText(/2 unfinished tasks are cancelled/),
    ).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Confirm stop" }));
    await waitFor(() =>
      expect(stopAgentRunAction).toHaveBeenCalledWith(
        "11111111-1111-4111-8111-111111111111",
        assignmentId,
        runningDraft.id,
      ),
    );
    expect(await within(card).findByText(/^Run stopped./)).toHaveAttribute(
      "role",
      "status",
    );
    expect(routerRefresh).toHaveBeenCalled();
  });

  it("offers retry only for the latest failed or stopped run and only to editors", async () => {
    retryAgentRunAction.mockResolvedValue({
      ok: false,
      message: "A newer agent run exists.",
    });
    current = snapshot({
      runs: [
        run({
          status: "cancelled",
          completedAt: iso(-1_000),
          errorCode: "CANCELLED_BY_USER",
          errorMessage: "Stopped by a course editor.",
          retryable: true,
          jobs: [
            job({ id: "job-1", status: "completed" }),
            job({ id: "job-2", questionNumber: 2, status: "cancelled" }),
          ],
        }),
      ],
    });
    render(
      <AgentMonitor
        courseId="11111111-1111-4111-8111-111111111111"
        assignmentId={assignmentId}
      />,
    );
    const trigger = await screen.findByTestId("agent-monitor-trigger");
    await waitFor(() => expect(trigger).toHaveAccessibleName(/Status: Idle/));
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/Saved tasks are kept/),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /Stop run/ }),
    ).toBeNull();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Retry 1 unfinished task" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "A newer agent run exists.",
    );
    cleanup();

    current = { ...current!, canEdit: false };
    render(
      <AgentMonitor
        courseId="11111111-1111-4111-8111-111111111111"
        assignmentId={assignmentId}
      />,
    );
    fireEvent.click(await screen.findByTestId("agent-monitor-trigger"));
    const viewerDialog = await screen.findByRole("dialog");
    await within(viewerDialog).findByText(/Saved tasks are kept/);
    expect(
      within(viewerDialog).queryByRole("button", { name: /Retry/ }),
    ).toBeNull();
  });
});
