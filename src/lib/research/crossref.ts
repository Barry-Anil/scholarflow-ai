import "server-only";

import { z } from "zod";

import { AppError } from "@/lib/errors";

const crossrefResponseSchema = z.object({
  message: z.object({
    items: z.array(
      z.object({
        DOI: z.string().optional(),
        URL: z.url().optional(),
        title: z.array(z.string()).default([]),
        abstract: z.string().optional(),
        author: z
          .array(
            z.object({
              given: z.string().optional(),
              family: z.string().optional(),
            }),
          )
          .default([]),
        published: z
          .object({
            "date-parts": z.array(z.array(z.number().int())).default([]),
          })
          .optional(),
        "container-title": z.array(z.string()).default([]),
      }),
    ),
  }),
});

export type ExternalResearchSource = {
  title: string;
  url: string;
  sourceId: string;
  evidence: string;
  metadata: Record<string, unknown>;
};

export async function searchCrossref(
  query: string,
  timeoutMs: number,
  contactEmail?: string,
): Promise<ExternalResearchSource[]> {
  const url = new URL("https://api.crossref.org/v1/works");
  url.searchParams.set("query.bibliographic", query.trim().slice(0, 600));
  url.searchParams.set("rows", "10");
  if (contactEmail) url.searchParams.set("mailto", contactEmail);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ScholarFlowAI/0.1 (academic-research-assistant)",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(Math.min(timeoutMs, 30_000)),
    });
  } catch (error) {
    throw new AppError(
      "UNEXPECTED_ERROR",
      "External scholarly search is temporarily unavailable.",
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new AppError(
      "UNEXPECTED_ERROR",
      response.status === 429
        ? "External scholarly search has reached its request limit."
        : "External scholarly search could not be completed.",
      { status: response.status },
    );
  }
  const payload = crossrefResponseSchema.safeParse(await response.json());
  if (!payload.success) {
    throw new AppError(
      "UNEXPECTED_ERROR",
      "External scholarly search returned an unexpected response.",
    );
  }

  return payload.data.message.items
    .flatMap((item) => {
      const title = item.title[0]?.trim();
      const abstract = item.abstract ? cleanAbstract(item.abstract) : "";
      const doi = item.DOI?.trim();
      const rawUrl = doi ? `https://doi.org/${doi}` : item.URL;
      if (!title || !abstract || !rawUrl) return [];
      const parsedUrl = new URL(rawUrl);
      if (
        !["http:", "https:"].includes(parsedUrl.protocol) ||
        parsedUrl.username ||
        parsedUrl.password
      ) {
        return [];
      }
      const authors = item.author
        .map((author) =>
          [author.given, author.family].filter(Boolean).join(" "),
        )
        .filter(Boolean)
        .slice(0, 8);
      const year = item.published?.["date-parts"]?.[0]?.[0];
      const sourceId = doi ? `doi:${doi.toLowerCase()}` : parsedUrl.toString();
      return [
        {
          title,
          url: parsedUrl.toString(),
          sourceId,
          evidence: abstract.slice(0, 6_000),
          metadata: {
            provider: "Crossref",
            doi: doi ?? null,
            authors,
            year: year ?? null,
            containerTitle: item["container-title"][0] ?? null,
          },
        },
      ];
    })
    .slice(0, 3);
}

function cleanAbstract(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}
