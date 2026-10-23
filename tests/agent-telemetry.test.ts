import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const inserted: Array<Record<string, unknown>> = [];
let failInserts = false;

vi.mock("@/lib/db", () => ({
  getDatabase: () => ({
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        if (failInserts) throw new Error("database down");
        inserted.push(row);
      },
    }),
  }),
}));

const { instrumentProvider, recordAgentStage, runWithAgentJobTelemetry } =
  await import("@/features/agents/agent-telemetry");
const { AppError } = await import("@/lib/errors");

const context = {
  prefix: "draft" as const,
  runId: "run-1",
  assignmentId: "assignment-1",
  ownerId: "owner-1",
  jobId: "job-1",
  questionId: "question-1",
  questionNumber: 2,
  attempt: 1,
  maxAttempts: 3,
};

const request = {
  model: "qwen3:8b",
  messages: [{ role: "user" as const, content: "private prompt" }],
  schema: z.object({ ok: z.boolean() }),
};

beforeEach(() => {
  inserted.length = 0;
  failInserts = false;
});

describe("agent telemetry", () => {
  it("does not record events outside a job context", async () => {
    const provider = instrumentProvider(
      {
        generateObject: async () => ({
          value: { ok: true } as never,
          provider: "ollama",
          model: "qwen3:8b",
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 5,
        }),
      },
      { timeoutMs: 1000 },
    );
    await provider.generateObject(request);
    expect(inserted).toHaveLength(0);
  });

  it("records the request and its schema-valid response for the job", async () => {
    const provider = instrumentProvider(
      {
        generateObject: async () => ({
          value: { ok: true } as never,
          provider: "ollama",
          model: "qwen3:8b",
          inputTokens: 120,
          outputTokens: 80,
          latencyMs: 2400,
        }),
      },
      { timeoutMs: 120_000 },
    );
    await runWithAgentJobTelemetry(context, () =>
      provider.generateObject(request),
    );
    expect(inserted.map((row) => row.eventType)).toEqual([
      "draft.model_request_started",
      "draft.model_response_received",
    ]);
    expect(inserted[1]).toMatchObject({
      runId: "run-1",
      metadata: {
        jobId: "job-1",
        questionId: "question-1",
        attempt: 1,
        latencyMs: 2400,
        outputTokens: 80,
      },
    });
    expect(JSON.stringify(inserted)).not.toContain("private prompt");
  });

  it("records a failed request with its error code and rethrows", async () => {
    const failure = new AppError("AI_TIMEOUT", "Timed out.");
    const provider = instrumentProvider(
      {
        generateObject: async () => {
          throw failure;
        },
      },
      { timeoutMs: 120_000 },
    );
    await expect(
      runWithAgentJobTelemetry(context, () => provider.generateObject(request)),
    ).rejects.toBe(failure);
    expect(inserted.map((row) => row.eventType)).toEqual([
      "draft.model_request_started",
      "draft.model_request_failed",
    ]);
    expect(inserted[1]).toMatchObject({
      metadata: { errorCode: "AI_TIMEOUT" },
    });
  });

  it("never fails the job when an event cannot be stored", async () => {
    failInserts = true;
    await expect(
      runWithAgentJobTelemetry(context, () =>
        recordAgentStage("question_started", "Started."),
      ),
    ).resolves.toBeUndefined();
  });
});
