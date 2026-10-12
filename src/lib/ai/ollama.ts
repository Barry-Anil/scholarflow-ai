import "server-only";

import { z } from "zod";

import { AppError } from "@/lib/errors";
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

  constructor(baseUrl: string, timeoutMs: number) {
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
  }

  async generateObject<T>(request: StructuredGenerationRequest<T>) {
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await fetch(new URL("/api/chat", this.#baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      throw new AppError(
        "UNEXPECTED_ERROR",
        "Ollama is not reachable. Start Ollama and confirm the configured model is installed.",
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new AppError(
        "UNEXPECTED_ERROR",
        response.status === 404
          ? "The configured Ollama model is unavailable. Pull the model and retry."
          : "Ollama could not complete the structured AI request.",
        { status: response.status },
      );
    }

    const payload = ollamaResponseSchema.safeParse(await response.json());
    if (!payload.success) {
      throw new AppError(
        "UNEXPECTED_ERROR",
        "Ollama returned an unexpected response.",
      );
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(payload.data.message.content);
    } catch (error) {
      throw new AppError(
        "UNEXPECTED_ERROR",
        "Ollama returned invalid structured output.",
        { cause: error },
      );
    }
    const value = request.schema.safeParse(parsedJson);
    if (!value.success) {
      throw new AppError(
        "UNEXPECTED_ERROR",
        "Ollama returned an incomplete draft. Retry or choose another model.",
      );
    }
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
