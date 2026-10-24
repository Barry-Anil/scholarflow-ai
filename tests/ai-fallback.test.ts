import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { OpenAiCompatibleProvider } from "@/lib/ai/openai-compatible";
import {
  createGenerationProvider,
  effectiveAiProvider,
  withFallback,
} from "@/lib/ai/provider";
import { parseAiProviderChoice } from "@/lib/ai/provider-choice";
import type { StructuredAiProvider } from "@/lib/ai/types";
import { AppError } from "@/lib/errors";

const schema = z.object({ answer: z.string() });
const request = {
  model: "qwen3:8b",
  schema,
  messages: [
    { role: "system" as const, content: "You are a tutor." },
    { role: "user" as const, content: "Explain pixels." },
  ],
};

function completion(content: string, status = 200) {
  return new Response(
    JSON.stringify({
      model: "groq/gpt-oss-120b",
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 40, completion_tokens: 12 },
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function provider(fetcher: typeof fetch) {
  return new OpenAiCompatibleProvider(
    {
      baseUrl: "https://router.example.test/v1",
      apiKey: "secret-key",
      timeoutMs: 10_000,
    },
    fetcher,
  );
}

describe("OpenAI-compatible provider", () => {
  it("sends JSON-mode chat completions with the schema and validates the reply", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        completion('```json\n{"answer":"A grid of values"}\n```'),
      );
    const result = await provider(fetcher).generateObject({
      ...request,
      model: "auto:study",
    });
    expect(result).toMatchObject({
      value: { answer: "A grid of values" },
      provider: "openai-compatible",
      model: "groq/gpt-oss-120b",
      inputTokens: 40,
      outputTokens: 12,
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe("https://router.example.test/v1/chat/completions");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer secret-key",
    );
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "auto:study",
      response_format: { type: "json_object" },
      stream: false,
    });
    expect(body.messages[0].content).toContain("You are a tutor.");
    expect(body.messages[0].content).toContain('"answer"');
  });

  it("rejects output that does not match the schema", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(completion('{"wrong":true}'));
    await expect(
      provider(fetcher).generateObject(request),
    ).rejects.toMatchObject({ code: "AI_RESPONSE_INVALID" });
  });

  it("maps authorization and availability failures to app error codes", async () => {
    await expect(
      provider(
        vi.fn<typeof fetch>().mockResolvedValue(completion("{}", 401)),
      ).generateObject(request),
    ).rejects.toMatchObject({ code: "AI_AUTHORIZATION_FAILED" });
    await expect(
      provider(
        vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed")),
      ).generateObject(request),
    ).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
  });
});

describe("Ollama fallback", () => {
  const ok = {
    value: { answer: "fallback" },
    provider: "openai-compatible",
    model: "auto:study",
    inputTokens: null,
    outputTokens: null,
    latencyMs: 5,
  };

  function failing(error: unknown): StructuredAiProvider {
    return { generateObject: vi.fn().mockRejectedValue(error) };
  }

  it("uses the fallback model when Ollama is unreachable or times out", async () => {
    for (const code of ["AI_UNAVAILABLE", "AI_TIMEOUT"] as const) {
      const fallback = { generateObject: vi.fn().mockResolvedValue(ok) };
      const result = await withFallback(
        failing(new AppError(code, "Ollama failed.")),
        fallback,
        "auto:study",
      ).generateObject(request);
      expect(result).toBe(ok);
      expect(fallback.generateObject).toHaveBeenCalledWith(
        expect.objectContaining({ model: "auto:study", schema }),
      );
    }
  });

  it("does not mask invalid output, auth errors, or a cancelled request", async () => {
    const fallback = { generateObject: vi.fn().mockResolvedValue(ok) };
    for (const error of [
      new AppError("AI_RESPONSE_INVALID", "Bad JSON."),
      new AppError("AI_AUTHORIZATION_FAILED", "Denied."),
    ]) {
      await expect(
        withFallback(failing(error), fallback, "auto:study").generateObject(
          request,
        ),
      ).rejects.toBe(error);
    }
    const controller = new AbortController();
    controller.abort();
    await expect(
      withFallback(
        failing(new AppError("AI_UNAVAILABLE", "Aborted.")),
        fallback,
        "auto:study",
      ).generateObject({ ...request, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(fallback.generateObject).not.toHaveBeenCalled();
  });
});

describe("User-selected generation provider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function configureFreeLlm() {
    vi.stubEnv("OLLAMA_URL", "http://ollama.example.test");
    vi.stubEnv("AI_FALLBACK_BASE_URL", "https://router.example.test/v1");
    vi.stubEnv("AI_FALLBACK_API_KEY", "secret-key");
    vi.stubEnv("AI_FALLBACK_MODEL", "auto:study");
  }

  function ollamaStream(content: string) {
    return new Response(
      [
        JSON.stringify({ message: { content }, done: false }),
        JSON.stringify({ model: "qwen3:8b", done: true, done_reason: "stop" }),
      ].join("\n"),
    );
  }

  /** Routes fetches by host; returns the mock so calls can be asserted. */
  function stubServices(handlers: {
    ollama: () => Promise<Response>;
    router: () => Promise<Response>;
  }) {
    const fetchMock = vi.fn<typeof fetch>((url) =>
      new URL(String(url)).hostname === "ollama.example.test"
        ? handlers.ollama()
        : handlers.router(),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function hosts(fetchMock: ReturnType<typeof stubServices>) {
    return fetchMock.mock.calls.map(([url]) => new URL(String(url)).hostname);
  }

  it("sends FreeLLM users to the router with the FreeLLM model", async () => {
    configureFreeLlm();
    const fetchMock = stubServices({
      ollama: () => Promise.resolve(ollamaStream('{"answer":"local"}')),
      router: () => Promise.resolve(completion('{"answer":"cloud"}')),
    });

    const result =
      await createGenerationProvider("freellm").generateObject(request);

    expect(result.value).toEqual({ answer: "cloud" });
    expect(hosts(fetchMock)).toEqual(["router.example.test"]);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.model).toBe("auto:study");
  });

  it("falls back from FreeLLM to Ollama with the role model", async () => {
    configureFreeLlm();
    const fetchMock = stubServices({
      ollama: () => Promise.resolve(ollamaStream('{"answer":"local"}')),
      router: () => Promise.reject(new TypeError("fetch failed")),
    });

    const result =
      await createGenerationProvider("freellm").generateObject(request);

    expect(result.value).toEqual({ answer: "local" });
    expect(hosts(fetchMock)).toEqual([
      "router.example.test",
      "ollama.example.test",
    ]);
    const body = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body));
    expect(body.model).toBe("qwen3:8b");
  });

  it("keeps Ollama users on Ollama while it is healthy", async () => {
    configureFreeLlm();
    const fetchMock = stubServices({
      ollama: () => Promise.resolve(ollamaStream('{"answer":"local"}')),
      router: () => Promise.resolve(completion('{"answer":"cloud"}')),
    });

    await expect(
      createGenerationProvider("ollama").generateObject(request),
    ).resolves.toMatchObject({ value: { answer: "local" } });
    expect(hosts(fetchMock)).toEqual(["ollama.example.test"]);
  });

  it("uses Ollama when FreeLLM is chosen but not configured", async () => {
    vi.stubEnv("OLLAMA_URL", "http://ollama.example.test");
    vi.stubEnv("AI_FALLBACK_BASE_URL", "");
    const fetchMock = stubServices({
      ollama: () => Promise.resolve(ollamaStream('{"answer":"local"}')),
      router: () => Promise.resolve(completion('{"answer":"cloud"}')),
    });

    expect(effectiveAiProvider("freellm")).toBe("ollama");
    await createGenerationProvider("freellm").generateObject(request);
    expect(hosts(fetchMock)).toEqual(["ollama.example.test"]);
  });

  it("treats missing or unknown stored choices as Ollama", () => {
    expect(parseAiProviderChoice(undefined)).toBe("ollama");
    expect(parseAiProviderChoice("gpt")).toBe("ollama");
    expect(parseAiProviderChoice("freellm")).toBe("freellm");
  });
});
