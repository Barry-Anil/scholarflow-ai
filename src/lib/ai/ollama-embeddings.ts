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

const embeddingResponseSchema = z.object({
  model: z.string().min(1),
  embeddings: z.array(z.array(z.number().finite())),
  prompt_eval_count: z.number().int().optional(),
});

export type EmbeddingResult = {
  model: string;
  embeddings: number[][];
  inputTokens: number | null;
  latencyMs: number;
};

export class OllamaEmbeddingProvider {
  readonly #baseUrl: URL;
  readonly #timeoutMs: number;
  readonly #dimensions: number;
  readonly #headers: Headers;

  constructor(
    baseUrl: string,
    timeoutMs: number,
    dimensions = 768,
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
    this.#dimensions = dimensions;
    this.#headers = createOllamaRequestHeaders(accessCredentials);
  }

  async embed(model: string, input: string[]): Promise<EmbeddingResult> {
    if (!input.length || input.length > 32) {
      throw new AppError(
        "INVALID_INPUT",
        "Embedding requests must contain between 1 and 32 texts.",
      );
    }
    const startedAt = performance.now();
    const context: OllamaRequestContext = {
      operation: "embed",
      hostname: this.#baseUrl.hostname,
      model,
      timeoutMs: this.#timeoutMs,
      startedAt,
    };
    let response: Response;
    try {
      response = await fetch(new URL("/api/embed", this.#baseUrl), {
        method: "POST",
        headers: this.#headers,
        body: JSON.stringify({
          model,
          input,
          dimensions: this.#dimensions,
          truncate: true,
          keep_alive: "10m",
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
    const payload = embeddingResponseSchema.safeParse(responseBody);
    if (
      !payload.success ||
      payload.data.embeddings.length !== input.length ||
      payload.data.embeddings.some(
        (embedding) => embedding.length !== this.#dimensions,
      )
    ) {
      throw ollamaInvalidResponse(
        context,
        "invalid_payload",
        undefined,
        response.status,
      );
    }

    logOllamaCompleted(context, response.status);
    return {
      model: payload.data.model,
      embeddings: payload.data.embeddings,
      inputTokens: payload.data.prompt_eval_count ?? null,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}
