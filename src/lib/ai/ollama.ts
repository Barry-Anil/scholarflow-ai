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
  ollamaStreamError,
  type OllamaRequestContext,
} from "./ollama-errors";
import type {
  StructuredAiProvider,
  StructuredGenerationRequest,
} from "./types";

// One line of Ollama's NDJSON stream. Intermediate lines carry a content delta;
// the final line has `done: true` plus token counts; failures arrive as `error`.
const ollamaChunkSchema = z.object({
  model: z.string().optional(),
  message: z.object({ content: z.string() }).optional(),
  done: z.boolean().optional(),
  done_reason: z.string().optional(),
  prompt_eval_count: z.number().int().optional(),
  eval_count: z.number().int().optional(),
  error: z.string().optional(),
});

type OllamaChunk = z.infer<typeof ollamaChunkSchema>;

async function* readLines(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield line;
        newline = buffer.indexOf("\n");
      }
    }
    const rest = (buffer + decoder.decode()).trim();
    if (rest) yield rest;
  } finally {
    // Releases the connection if the consumer stops early or an error is thrown.
    await reader.cancel().catch(() => undefined);
  }
}

export class OllamaProvider implements StructuredAiProvider {
  readonly #baseUrl: URL;
  readonly #timeoutMs: number;
  readonly #headers: Headers;
  readonly #generationOptions: OllamaGenerationOptions;

  constructor(
    baseUrl: string,
    timeoutMs: number,
    accessCredentials?: OllamaAccessCredentials,
    generationOptions: OllamaGenerationOptions = {},
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
    this.#generationOptions = generationOptions;
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
    // One deadline covers connecting, model loading and reading the whole stream.
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const signal = request.signal
      ? AbortSignal.any([timeout, request.signal])
      : timeout;
    let response: Response;
    try {
      response = await fetch(new URL("/api/chat", this.#baseUrl), {
        method: "POST",
        headers: this.#headers,
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          // Streaming keeps bytes flowing so proxies (Cloudflare: ~100s idle)
          // do not cut long generations.
          stream: true,
          format: z.toJSONSchema(request.schema),
          think: false,
          options: {
            temperature: request.temperature ?? 0,
            ...(this.#generationOptions.numCtx === undefined
              ? {}
              : { num_ctx: this.#generationOptions.numCtx }),
            ...(this.#generationOptions.numPredict === undefined
              ? {}
              : { num_predict: this.#generationOptions.numPredict }),
            ...(this.#generationOptions.topP === undefined
              ? {}
              : { top_p: this.#generationOptions.topP }),
            ...(this.#generationOptions.seed === undefined
              ? {}
              : { seed: this.#generationOptions.seed }),
          },
        }),
        cache: "no-store",
        signal,
      });
    } catch (error) {
      throw ollamaFetchError(error, context);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw ollamaHttpError(response, context);
    }

    const { content, final } = await this.#readStream(response, context);
    if (final.done_reason === "length") {
      throw ollamaInvalidResponse(
        context,
        "truncated_output",
        undefined,
        response.status,
      );
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(content);
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
      model: final.model ?? request.model,
      inputTokens: final.prompt_eval_count ?? null,
      outputTokens: final.eval_count ?? null,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }

  async #readStream(response: Response, context: OllamaRequestContext) {
    if (!response.body) {
      throw ollamaInvalidResponse(
        context,
        "invalid_payload",
        undefined,
        response.status,
      );
    }
    const parts: string[] = [];
    let final: OllamaChunk | undefined;
    try {
      for await (const line of readLines(response.body)) {
        let json: unknown;
        try {
          json = JSON.parse(line);
        } catch (error) {
          throw ollamaInvalidResponse(
            context,
            "invalid_json",
            error,
            response.status,
          );
        }
        const chunk = ollamaChunkSchema.safeParse(json);
        if (!chunk.success) {
          throw ollamaInvalidResponse(
            context,
            "invalid_payload",
            undefined,
            response.status,
          );
        }
        if (chunk.data.error) {
          throw ollamaStreamError(context, chunk.data.error);
        }
        if (chunk.data.message) parts.push(chunk.data.message.content);
        if (chunk.data.done) {
          final = chunk.data;
          break;
        }
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      // Timeouts, caller aborts and dropped connections while reading the body.
      throw ollamaFetchError(error, context);
    }
    if (!final) {
      // The stream closed without a terminal chunk: the connection was cut.
      throw ollamaInvalidResponse(
        context,
        "invalid_payload",
        undefined,
        response.status,
      );
    }
    return { content: parts.join(""), final };
  }
}

export type OllamaGenerationOptions = {
  numCtx?: number;
  numPredict?: number;
  topP?: number;
  seed?: number;
};
