import "server-only";

import { z } from "zod";

import { AppError } from "@/lib/errors";

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

  constructor(baseUrl: string, timeoutMs: number, dimensions = 768) {
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
  }

  async embed(model: string, input: string[]): Promise<EmbeddingResult> {
    if (!input.length || input.length > 32) {
      throw new AppError(
        "INVALID_INPUT",
        "Embedding requests must contain between 1 and 32 texts.",
      );
    }
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await fetch(new URL("/api/embed", this.#baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      throw new AppError(
        "UNEXPECTED_ERROR",
        "Ollama embeddings are unavailable. Keyword retrieval remains active.",
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new AppError(
        "UNEXPECTED_ERROR",
        response.status === 404
          ? "The configured Ollama embedding model is unavailable. Pull the model and retry."
          : "Ollama could not generate embeddings.",
        { status: response.status },
      );
    }

    const payload = embeddingResponseSchema.safeParse(await response.json());
    if (
      !payload.success ||
      payload.data.embeddings.length !== input.length ||
      payload.data.embeddings.some(
        (embedding) => embedding.length !== this.#dimensions,
      )
    ) {
      throw new AppError(
        "UNEXPECTED_ERROR",
        `Ollama must return one ${this.#dimensions}-dimension embedding per input.`,
      );
    }

    return {
      model: payload.data.model,
      embeddings: payload.data.embeddings,
      inputTokens: payload.data.prompt_eval_count ?? null,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}
