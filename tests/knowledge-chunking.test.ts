import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";

import {
  chunkExtractedPages,
  normalizeExtractedText,
} from "@/features/knowledge/chunking";
import {
  isAcceptedDocumentMime,
  resolveAcceptedDocumentMime,
} from "@/features/knowledge/constants";
import { extractDocxText } from "@/features/knowledge/docx";

describe("knowledge document validation", () => {
  it("accepts declared course-material MIME types", () => {
    expect(isAcceptedDocumentMime("application/pdf")).toBe(true);
    expect(isAcceptedDocumentMime("application/javascript")).toBe(false);
  });

  it("falls back to a safe extension when browsers omit the MIME type", () => {
    expect(resolveAcceptedDocumentMime("lecture-notes.DOCX", "")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(resolveAcceptedDocumentMime("payload.exe", "")).toBeNull();
  });
});

describe("knowledge chunking", () => {
  it("normalizes control characters and excessive whitespace", () => {
    expect(
      normalizeExtractedText(" First\u0000  line\r\n\r\n\r\nSecond "),
    ).toBe("First line\n\nSecond");
  });

  it("preserves page attribution while assigning stable indexes", () => {
    const chunks = chunkExtractedPages([
      { pageNumber: 3, text: "Evidence on page three." },
      { pageNumber: 4, text: "Evidence on page four." },
    ]);

    expect(chunks).toMatchObject([
      { chunkIndex: 0, pageStart: 3, pageEnd: 3 },
      { chunkIndex: 1, pageStart: 4, pageEnd: 4 },
    ]);
  });

  it("splits long text into overlapping searchable chunks", () => {
    const text = Array.from(
      { length: 180 },
      (_, index) => `Sentence ${index} contains useful academic evidence.`,
    ).join(" ");
    const chunks = chunkExtractedPages([{ pageNumber: 1, text }]);

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.content.length <= 1_600)).toBe(true);
    expect(chunks.every((chunk) => chunk.tokenCount > 0)).toBe(true);
  });
});

describe("DOCX extraction", () => {
  it("extracts paragraphs and decodes entities from the document XML", () => {
    const archive = zipSync({
      "word/document.xml": strToU8(
        '<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>Research &amp; evidence</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body></w:document>',
      ),
    });
    const bytes = archive.buffer.slice(
      archive.byteOffset,
      archive.byteOffset + archive.byteLength,
    ) as ArrayBuffer;

    expect(extractDocxText(bytes)).toEqual({
      text: "Research & evidence\n\nSecond paragraph",
      partCount: 1,
    });
  });

  it("rejects archives without a Word document body", () => {
    const archive = zipSync({ "notes.txt": strToU8("not a docx") });
    const bytes = archive.buffer.slice(
      archive.byteOffset,
      archive.byteOffset + archive.byteLength,
    ) as ArrayBuffer;

    expect(() => extractDocxText(bytes)).toThrow(
      "The DOCX has no readable document body.",
    );
  });
});
