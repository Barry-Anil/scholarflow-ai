import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { OllamaProvider } from "@/lib/ai/ollama";
import { AppError } from "@/lib/errors";

afterEach(() => vi.unstubAllGlobals());

describe("Ollama structured provider", () => {
  it("sends a JSON schema and validates the returned object", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "test-model",
          message: { content: JSON.stringify({ answer: "grounded" }) },
          prompt_eval_count: 12,
          eval_count: 7,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
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
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const headers = new Headers(init.headers);
    const body = JSON.parse(String(init.body));
    expect(headers.get("CF-Access-Client-Id")).toBe("access-client");
    expect(headers.get("CF-Access-Client-Secret")).toBe("access-secret");
    expect(body).toMatchObject({
      model: "test-model",
      stream: false,
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
        Response.json({
          model: "test-model",
          message: { content: "not-json" },
        }),
      ),
    );
    const provider = new OllamaProvider("https://ollama.example.com", 5_000);

    await expect(
      provider.generateObject({
        model: "test-model",
        schema: z.object({ answer: z.string() }),
        messages: [{ role: "user", content: "Draft" }],
      }),
    ).rejects.toMatchObject({ code: "AI_RESPONSE_INVALID" });
  });
});
