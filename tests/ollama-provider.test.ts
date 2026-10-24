import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { OllamaProvider } from "@/lib/ai/ollama";
import { AppError } from "@/lib/errors";

afterEach(() => vi.unstubAllGlobals());

/** Builds an Ollama-style NDJSON stream, emitting each string as its own network chunk. */
function ndjsonResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
  );
}

function lines(...objects: unknown[]) {
  return objects.map((object) => `${JSON.stringify(object)}\n`);
}

const request = {
  model: "test-model",
  schema: z.object({ answer: z.string() }),
  messages: [{ role: "user" as const, content: "Draft" }],
};

describe("Ollama structured provider", () => {
  it("sends a JSON schema and validates the returned object", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ndjsonResponse(
        lines(
          {
            model: "test-model",
            message: { content: '{"answer":' },
            done: false,
          },
          {
            model: "test-model",
            message: { content: '"grounded"}' },
            done: false,
          },
          {
            model: "test-model",
            message: { content: "" },
            done: true,
            done_reason: "stop",
            prompt_eval_count: 12,
            eval_count: 7,
          },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OllamaProvider(
      "http://localhost:11434",
      5_000,
      {
        clientId: "access-client",
        clientSecret: "access-secret",
      },
      {
        numCtx: 16_384,
        numPredict: 4_096,
        topP: 0.9,
        seed: 42,
      },
    );
    const schema = z.object({ answer: z.string() });

    const result = await provider.generateObject({
      model: "test-model",
      schema,
      messages: [{ role: "user", content: "Draft safely" }],
    });

    expect(result.value).toEqual({ answer: "grounded" });
    expect(result).toMatchObject({ inputTokens: 12, outputTokens: 7 });
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const headers = new Headers(init.headers);
    const body = JSON.parse(String(init.body));
    expect(headers.get("CF-Access-Client-Id")).toBe("access-client");
    expect(headers.get("CF-Access-Client-Secret")).toBe("access-secret");
    expect(body).toMatchObject({
      model: "test-model",
      stream: true,
      think: false,
    });
    expect(body.format).toMatchObject({ type: "object" });
    expect(body.options).toMatchObject({
      num_ctx: 16_384,
      num_predict: 4_096,
      top_p: 0.9,
      seed: 42,
    });
  });

  it("classifies a connection failure without exposing request data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const provider = new OllamaProvider("http://localhost:11434", 5_000);

    const result = provider.generateObject({
      model: "missing",
      schema: z.object({ answer: z.string() }),
      messages: [{ role: "user", content: "Draft" }],
    });

    await expect(result).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      status: 503,
    });
    await expect(result).rejects.toThrow(/could not connect/);
  });

  it("distinguishes request timeouts from connection failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")),
    );
    const provider = new OllamaProvider("https://ollama.example.com", 120_000);

    const result = provider.generateObject({
      model: "slow-model",
      schema: z.object({ answer: z.string() }),
      messages: [{ role: "user", content: "Draft" }],
    });

    await expect(result).rejects.toMatchObject({
      code: "AI_TIMEOUT",
      status: 504,
    });
    await expect(result).rejects.toThrow(/120 seconds/);
  });

  it("reports Cloudflare Access rejection separately", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 })),
    );
    const provider = new OllamaProvider("https://ollama.example.com", 5_000);

    await expect(
      provider.generateObject({
        model: "missing",
        schema: z.object({ answer: z.string() }),
        messages: [{ role: "user", content: "Draft" }],
      }),
    ).rejects.toMatchObject({
      code: "AI_AUTHORIZATION_FAILED",
      status: 403,
    } satisfies Partial<AppError>);
  });

  it("reports invalid structured JSON separately", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        ndjsonResponse(
          lines({
            model: "test-model",
            message: { content: "not-json" },
            done: true,
          }),
        ),
      ),
    );
    const provider = new OllamaProvider("https://ollama.example.com", 5_000);

    await expect(provider.generateObject(request)).rejects.toMatchObject({
      code: "AI_RESPONSE_INVALID",
    });
  });

  it("reassembles NDJSON lines split across network chunks", async () => {
    const [first, last] = lines(
      { message: { content: '{"answer":"split"}' }, done: false },
      { model: "test-model", done: true, done_reason: "stop" },
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          ndjsonResponse([
            first.slice(0, 10),
            first.slice(10) + last.slice(0, 5),
            last.slice(5),
          ]),
        ),
    );
    const provider = new OllamaProvider("https://ollama.example.com", 5_000);

    await expect(provider.generateObject(request)).resolves.toMatchObject({
      value: { answer: "split" },
      model: "test-model",
    });
  });

  it("surfaces an error line emitted mid-stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          ndjsonResponse(
            lines(
              { message: { content: '{"ans' }, done: false },
              { error: "model runner has unexpectedly stopped" },
            ),
          ),
        ),
    );
    const provider = new OllamaProvider("https://ollama.example.com", 5_000);

    const result = provider.generateObject(request);
    await expect(result).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      status: 503,
    });
    await expect(result).rejects.not.toThrow(/runner/);
  });

  it("reports output truncated by the token limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          ndjsonResponse(
            lines({
              message: { content: '{"answer":"cut' },
              done: true,
              done_reason: "length",
            }),
          ),
        ),
    );
    const provider = new OllamaProvider("https://ollama.example.com", 5_000);

    await expect(provider.generateObject(request)).rejects.toThrow(
      /AI_NUM_PREDICT/,
    );
  });

  it("rejects a stream that closes without a final chunk", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          ndjsonResponse(
            lines({ message: { content: '{"answer":"x"}' }, done: false }),
          ),
        ),
    );
    const provider = new OllamaProvider("https://ollama.example.com", 5_000);

    await expect(provider.generateObject(request)).rejects.toMatchObject({
      code: "AI_RESPONSE_INVALID",
    });
  });

  it("classifies a timeout while reading the stream as AI_TIMEOUT", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.error(new DOMException("timed out", "TimeoutError"));
            },
          }),
        ),
      ),
    );
    const provider = new OllamaProvider("https://ollama.example.com", 300_000);

    const result = provider.generateObject(request);
    await expect(result).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    await expect(result).rejects.toThrow(/300 seconds/);
  });

  it("forwards caller cancellation to the request", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new DOMException("aborted", "AbortError"));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OllamaProvider("https://ollama.example.com", 5_000);
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.generateObject({ ...request, signal: controller.signal }),
    ).rejects.toBeInstanceOf(AppError);
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(init.signal?.aborted).toBe(true);
  });
});
