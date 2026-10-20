import "server-only";

import { z } from "zod";

import { AppError } from "@/lib/errors";
import {
  createOllamaRequestHeaders,
  type OllamaAccessCredentials,
} from "./ollama-access";
import {
  logOllamaCompleted,
  ollamaFetchError,
  ollamaHttpError,
  ollamaInvalidResponse,
  type OllamaRequestContext,
} from "./ollama-errors";
import type {
  StructuredAiProvider,
  StructuredGenerationRequest,
} from "./types";

const ollamaResponseSchema = z.object({
  model: z.string(),
  message: z.object({ content: z.string() }),
  prompt_eval_count: z.number().int().optional(),
  eval_count: z.number().int().optional(),
});

export class OllamaProvider implements StructuredAiProvider {
  readonly #baseUrl: URL;
  readonly #timeoutMs: number;
  readonly #headers: Headers;

  constructor(
    baseUrl: string,
    timeoutMs: number,
    accessCredentials?: OllamaAccessCredentials,
  ) {
    const parsed = new URL(baseUrl);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    ) {
      throw new AppError(
        "CONFIGURATION_MISSING",
        "The Ollama server URL is not valid.",
      );
    }
    this.#baseUrl = parsed;
    this.#timeoutMs = timeoutMs;
    this.#headers = createOllamaRequestHeaders(accessCredentials);
  }

  async generateObject<T>(request: StructuredGenerationRequest<T>) {
    const startedAt = performance.now();
    const context: OllamaRequestContext = {
      operation: "chat",
      hostname: this.#baseUrl.hostname,
      model: request.model,
      timeoutMs: this.#timeoutMs,
      startedAt,
    };
    let response: Response;
    try {
      response = await fetch(new URL("/api/chat", this.#baseUrl), {
        method: "POST",
        headers: this.#headers,
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          stream: false,
          format: z.toJSONSchema(request.schema),
          think: false,
          options: { temperature: request.temperature ?? 0 },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw ollamaFetchError(error, context);
    }
    if (!response.ok) {
      throw ollamaHttpError(response, context);
    }

    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch (error) {
      throw ollamaInvalidResponse(
        context,
        "invalid_json",
        error,
        response.status,
      );
    }
    const payload = ollamaResponseSchema.safeParse(responseBody);
    if (!payload.success) {
      throw ollamaInvalidResponse(
        context,
        "invalid_payload",
        undefined,
        response.status,
      );
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(payload.data.message.content);
    } catch (error) {
      throw ollamaInvalidResponse(
        context,
        "invalid_structured_output",
        error,
        response.status,
      );
    }
    const value = request.schema.safeParse(parsedJson);
    if (!value.success) {
      throw ollamaInvalidResponse(
        context,
        "invalid_structured_output",
        undefined,
        response.status,
      );
    }
    logOllamaCompleted(context, response.status);
    return {
      value: value.data,
      provider: "ollama",
      model: payload.data.model,
      inputTokens: payload.data.prompt_eval_count ?? null,
      outputTokens: payload.data.eval_count ?? null,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}
