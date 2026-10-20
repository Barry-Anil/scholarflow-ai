import { afterEach, describe, expect, it, vi } from "vitest";

import { checkOllamaHealth } from "@/lib/ai/ollama-health";

afterEach(() => vi.unstubAllGlobals());

describe("Ollama health check", () => {
  it("checks the protected tags endpoint and verifies the configured model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        models: [{ name: "nomic-embed-text:latest" }, { name: "qwen3:8b" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkOllamaHealth(
      "https://ollama.example.com",
      120_000,
      "qwen3:8b",
      { clientId: "access-client", clientSecret: "access-secret" },
    );

    expect(result).toMatchObject({ status: "ready", model: "qwen3:8b" });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const headers = new Headers(init.headers);
    expect(url.toString()).toBe("https://ollama.example.com/api/tags");
    expect(headers.get("CF-Access-Client-Id")).toBe("access-client");
    expect(headers.get("CF-Access-Client-Secret")).toBe("access-secret");
    expect(JSON.stringify(result)).not.toContain("access-secret");
  });

  it("fails when the configured chat model is not installed", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ models: [{ name: "another-model" }] }),
        ),
    );

    await expect(
      checkOllamaHealth("https://ollama.example.com", 120_000, "qwen3:8b"),
    ).rejects.toMatchObject({ code: "AI_UNAVAILABLE", status: 503 });
  });
});
