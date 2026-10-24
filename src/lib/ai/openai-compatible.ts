import "server-only";

import { z } from "zod";

import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import type {
  StructuredAiProvider,
  StructuredGenerationRequest,
} from "./types";

const completionSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional() }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().optional(),
      completion_tokens: z.number().int().optional(),
    })
    .optional(),
});

export type OpenAiCompatibleConfig = {
  baseUrl: string;
  apiKey: string | null;
  timeoutMs: number;
};

/**
 * Structured generation through an OpenAI-compatible chat completions API.
 * JSON mode plus the schema in the system prompt works across routers that
 * do not all support strict json_schema; the reply is validated either way.
 */
export class OpenAiCompatibleProvider implements StructuredAiProvider {
  readonly #endpoint: URL;
  readonly #config: OpenAiCompatibleConfig;
  readonly #fetcher: typeof fetch;

  constructor(config: OpenAiCompatibleConfig, fetcher: typeof fetch = fetch) {
    const base = new URL(config.baseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username) {
      throw new AppError(
        "CONFIGURATION_MISSING",
        "The fallback AI URL is not valid.",
      );
    }
    this.#endpoint = new URL(
      `${base.pathname.replace(/\/+$/, "")}/chat/completions`,
      base,
    );
    this.#config = config;
    this.#fetcher = fetcher;
  }

  async generateObject<T>(request: StructuredGenerationRequest<T>) {
    const startedAt = performance.now();
    const timeout = AbortSignal.timeout(this.#config.timeoutMs);
    const signal = request.signal
      ? AbortSignal.any([timeout, request.signal])
      : timeout;
    const schemaInstruction = `Respond with a single JSON object that matches this JSON Schema exactly, with no other text:\n${JSON.stringify(z.toJSONSchema(request.schema))}`;
    const [first, ...rest] = request.messages;
    const messages =
      first?.role === "system"
        ? [
            { ...first, content: `${first.content}\n\n${schemaInstruction}` },
            ...rest,
          ]
        : [
            { role: "system" as const, content: schemaInstruction },
            ...request.messages,
          ];

    let response: Response;
    try {
      response = await this.#fetcher(this.#endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.#config.apiKey
            ? { Authorization: `Bearer ${this.#config.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: request.model,
          messages,
          temperature: request.temperature ?? 0,
          response_format: { type: "json_object" },
          stream: false,
        }),
        cache: "no-store",
        signal,
      });
    } catch (error) {
      const timedOut =
        timeout.aborted ||
        (error instanceof Error && error.name === "TimeoutError");
      throw new AppError(
        timedOut ? "AI_TIMEOUT" : "AI_UNAVAILABLE",
        timedOut
          ? "The fallback AI service took too long to respond."
          : "The fallback AI service is unavailable.",
        { cause: error },
      );
    }
    if (!response.ok) {
      logger.warn("ai.fallback_request_failed", {
        hostname: this.#endpoint.hostname,
        status: response.status,
        model: request.model,
      });
      throw new AppError(
        response.status === 401 || response.status === 403
          ? "AI_AUTHORIZATION_FAILED"
          : "AI_UNAVAILABLE",
        "The fallback AI service rejected the request.",
        { status: 502 },
      );
    }
    const payload = completionSchema.safeParse(
      await response.json().catch(() => null),
    );
    const content = payload.success
      ? payload.data.choices[0]?.message.content
      : null;
    if (!payload.success || !content) {
      throw new AppError(
        "AI_RESPONSE_INVALID",
        "The fallback AI service returned an unreadable response.",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripCodeFence(content));
    } catch (error) {
      throw new AppError(
        "AI_RESPONSE_INVALID",
        "The fallback AI response was not valid JSON.",
        { cause: error },
      );
    }
    const value = request.schema.safeParse(parsed);
    if (!value.success) {
      throw new AppError(
        "AI_RESPONSE_INVALID",
        "The fallback AI response did not match the required structure.",
      );
    }
    return {
      value: value.data,
      provider: "openai-compatible",
      model: payload.data.model ?? request.model,
      inputTokens: payload.data.usage?.prompt_tokens ?? null,
      outputTokens: payload.data.usage?.completion_tokens ?? null,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}

/** Some models wrap JSON in a Markdown code fence despite JSON mode. */
function stripCodeFence(content: string) {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1]! : trimmed;
}
