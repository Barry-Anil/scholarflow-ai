import { afterEach, describe, expect, it, vi } from "vitest";

import { searchCrossref } from "@/lib/research/crossref";

afterEach(() => vi.unstubAllGlobals());

describe("Crossref scholarly search", () => {
  it("returns only traceable records with abstracts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: {
            items: [
              {
                DOI: "10.1000/example",
                URL: "https://example.test/article",
                title: ["Institutional meaning"],
                abstract: "<jats:p>Evidence &amp; analysis.</jats:p>",
                author: [{ given: "Ada", family: "Scholar" }],
                published: { "date-parts": [[2025, 3, 1]] },
                "container-title": ["Research Journal"],
              },
              {
                DOI: "10.1000/no-abstract",
                title: ["Metadata only"],
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchCrossref(
      "institutional theory",
      10_000,
      "researcher@example.com",
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      sourceId: "doi:10.1000/example",
      evidence: "Evidence & analysis.",
      metadata: { provider: "Crossref", year: 2025 },
    });
    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requested.origin).toBe("https://api.crossref.org");
    expect(requested.searchParams.get("mailto")).toBe("researcher@example.com");
  });
});
