import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { OllamaProvider } from "@/lib/ai/ollama";

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
    const provider = new OllamaProvider("http://localhost:11434", 5_000, {
      clientId: "access-client",
      clientSecret: "access-secret",
    });
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
  });

  it("returns an actionable error when the local service is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const provider = new OllamaProvider("http://localhost:11434", 5_000);

    await expect(
      provider.generateObject({
        model: "missing",
        schema: z.object({ answer: z.string() }),
        messages: [{ role: "user", content: "Draft" }],
      }),
    ).rejects.toThrow(/Ollama is not reachable/);
  });
});
