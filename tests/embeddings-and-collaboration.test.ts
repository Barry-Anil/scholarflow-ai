import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fuseKnowledgeResults } from "@/features/knowledge/hybrid-retrieval";
import { OllamaEmbeddingProvider } from "@/lib/ai/ollama-embeddings";
import { hasCoursePermission } from "@/lib/auth/course-access";

afterEach(() => vi.unstubAllGlobals());

describe("semantic retrieval", () => {
  it("calls Ollama's batch embed endpoint and validates dimensions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "nomic-embed-text",
          embeddings: [[1, 2, 3]],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OllamaEmbeddingProvider(
      "http://localhost:11434",
      5_000,
      3,
    );
    const result = await provider.embed("nomic-embed-text", [
      "grounded evidence",
    ]);

    expect(result.embeddings).toEqual([[1, 2, 3]]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/embed");
  });

  it("promotes evidence found by both keyword and semantic ranking", () => {
    const item = (id: string, score: number) => ({
      id,
      score,
      content: id,
      pageStart: null,
      pageEnd: null,
      filename: `${id}.pdf`,
    });
    const fused = fuseKnowledgeResults(
      [item("shared", 0.8), item("keyword", 0.7)],
      [item("semantic", 0.9), item("shared", 0.8)],
      3,
    );
    expect(fused[0]?.id).toBe("shared");
    expect(fused[0]).toMatchObject({ keywordRank: 1, semanticRank: 2 });
  });
});

describe("course collaboration", () => {
  it("maps owner/editor/viewer to manage/edit/read permissions", () => {
    expect(hasCoursePermission("owner", "manage")).toBe(true);
    expect(hasCoursePermission("editor", "edit")).toBe(true);
    expect(hasCoursePermission("editor", "manage")).toBe(false);
    expect(hasCoursePermission("viewer", "read")).toBe(true);
    expect(hasCoursePermission("viewer", "edit")).toBe(false);
  });

  it("ships role-aware RLS and embedding columns", () => {
    const migration = readFileSync(
      resolve("drizzle/0005_omniscient_doctor_faustus.sql"),
      "utf8",
    );
    expect(migration).toContain('ADD COLUMN "embedding_model"');
    expect(migration).toContain("private.can_edit_assignment");
    expect(migration).toContain("assignments_course_read");
    expect(migration).toContain("assignments_course_update");
    expect(migration).toContain("course_materials_member_read");
  });
});
