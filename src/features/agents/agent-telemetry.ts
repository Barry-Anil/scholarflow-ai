import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import type { StructuredAiProvider } from "@/lib/ai/types";
import { getDatabase } from "@/lib/db";
import { agentRunEvents } from "@/lib/db/schema";
import { errorFingerprint } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";

export type AgentStagePrefix = "research" | "draft" | "review" | "revision";

export type AgentJobTelemetryContext = {
  prefix: AgentStagePrefix;
  runId: string;
  assignmentId: string;
  ownerId: string;
  jobId: string;
  questionId: string;
  questionNumber: number | null;
  attempt: number;
  maxAttempts: number;
};

const storage = new AsyncLocalStorage<AgentJobTelemetryContext>();

export function runWithAgentJobTelemetry<T>(
  context: AgentJobTelemetryContext,
  work: () => Promise<T>,
) {
  return storage.run(context, work);
}

export function currentAgentJobTelemetry() {
  return storage.getStore() ?? null;
}

/**
 * Appends a stage event for the job running in the current async context.
 * Monitoring is best-effort: a failed insert is logged and never fails the job.
 */
export async function recordAgentStage(
  stage: string,
  message: string,
  metadata: Record<string, unknown> = {},
  context = currentAgentJobTelemetry(),
) {
  if (!context) return;
  try {
    await getDatabase()
      .insert(agentRunEvents)
      .values({
        runId: context.runId,
        assignmentId: context.assignmentId,
        ownerId: context.ownerId,
        eventType: `${context.prefix}.${stage}`,
        message,
        metadata: {
          questionId: context.questionId,
          jobId: context.jobId,
          attempt: context.attempt,
          maxAttempts: context.maxAttempts,
          ...metadata,
        },
      });
  } catch (error) {
    logger.warn("agent.telemetry_event_failed", {
      jobId: context.jobId,
      stage,
      ...errorFingerprint(error),
    });
  }
}

export function questionLabel(context: AgentJobTelemetryContext | null) {
  return context?.questionNumber
    ? `question ${context.questionNumber}`
    : "the question";
}

/**
 * Wraps a provider so each model request records when it was sent, and whether
 * a schema-valid response came back or the request failed. Outside a job
 * context the provider is returned unchanged.
 */
export function instrumentProvider(
  provider: StructuredAiProvider,
  options: { timeoutMs: number },
): StructuredAiProvider {
  return {
    async generateObject(request) {
      const context = currentAgentJobTelemetry();
      if (!context) return provider.generateObject(request);
      const startedAt = performance.now();
      await recordAgentStage(
        "model_request_started",
        `Sent ${questionLabel(context)} to ${request.model}; waiting for the model response.`,
        { model: request.model, timeoutMs: options.timeoutMs },
        context,
      );
      try {
        const result = await provider.generateObject(request);
        await recordAgentStage(
          "model_response_received",
          `Received a schema-valid response from ${result.model} in ${formatSeconds(result.latencyMs)}.`,
          {
            provider: result.provider,
            model: result.model,
            latencyMs: result.latencyMs,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
          },
          context,
        );
        return result;
      } catch (error) {
        const latencyMs = Math.round(performance.now() - startedAt);
        const errorCode =
          errorFingerprint(error).errorCode ?? "UNEXPECTED_ERROR";
        await recordAgentStage(
          "model_request_failed",
          `The model request failed (${errorCode}) after ${formatSeconds(latencyMs)}.`,
          { model: request.model, latencyMs, errorCode },
          context,
        );
        throw error;
      }
    },
  };
}

function formatSeconds(milliseconds: number) {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}
