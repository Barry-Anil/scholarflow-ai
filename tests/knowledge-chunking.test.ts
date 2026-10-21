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
import { extractIpynbText } from "@/features/knowledge/ipynb";
import { extractDocumentText } from "@/features/knowledge/extract";

describe("knowledge document validation", () => {
  it("accepts declared course-material MIME types", () => {
    expect(isAcceptedDocumentMime("application/pdf")).toBe(true);
    expect(isAcceptedDocumentMime("application/x-ipynb+json")).toBe(true);
    expect(isAcceptedDocumentMime("text/x-python")).toBe(true);
    expect(isAcceptedDocumentMime("text/javascript")).toBe(true);
    expect(isAcceptedDocumentMime("application/javascript")).toBe(true);
    expect(isAcceptedDocumentMime("text/typescript")).toBe(true);
    expect(isAcceptedDocumentMime("application/typescript")).toBe(true);
    expect(isAcceptedDocumentMime("application/zip")).toBe(false);
    expect(isAcceptedDocumentMime("image/png")).toBe(false);
  });

  it("falls back to a safe extension when browsers omit or misreport the MIME type", () => {
    expect(resolveAcceptedDocumentMime("lecture-notes.DOCX", "")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(
      resolveAcceptedDocumentMime("analysis.ipynb", "application/json"),
    ).toBe("application/x-ipynb+json");
    expect(resolveAcceptedDocumentMime("model.py", "text/plain")).toBe(
      "text/x-python",
    );
    expect(resolveAcceptedDocumentMime("handler.js", "")).toBe(
      "text/javascript",
    );
    // Windows frequently maps .ts files to video/mp2t in browser file picker
    expect(resolveAcceptedDocumentMime("types.ts", "video/mp2t")).toBe(
      "text/typescript",
    );
    expect(resolveAcceptedDocumentMime("component.tsx", "")).toBe(
      "text/typescript",
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

describe("IPYNB extraction", () => {
  it("extracts markdown, code, and outputs from a Jupyter notebook", () => {
    const notebook = {
      nbformat: 4,
      nbformat_minor: 2,
      metadata: {
        language_info: { name: "python" },
      },
      cells: [
        {
          cell_type: "markdown",
          source: ["# Machine Learning Notes\n", "Introductory concepts."],
        },
        {
          cell_type: "code",
          execution_count: 1,
          source: ["def train_model(data):\n", "    return len(data) * 2\n"],
          outputs: [
            {
              output_type: "stream",
              text: ["Model initialized.\n"],
            },
            {
              output_type: "execute_result",
              data: {
                "text/plain": ["42"],
              },
            },
          ],
        },
      ],
    };

    const bytes = new TextEncoder().encode(JSON.stringify(notebook))
      .buffer as ArrayBuffer;
    const result = extractIpynbText(bytes);

    expect(result.cellCount).toBe(2);
    expect(result.language).toBe("python");
    expect(result.text).toContain(
      "# Machine Learning Notes\nIntroductory concepts.",
    );
    expect(result.text).toContain(
      "```python\ndef train_model(data):\n    return len(data) * 2\n```",
    );
    expect(result.text).toContain("Output:\n```\nModel initialized.\n42\n```");
  });

  it("handles notebooks with error tracebacks by stripping ANSI escape sequences", () => {
    const notebook = {
      cells: [
        {
          cell_type: "code",
          source: "1 / 0",
          outputs: [
            {
              output_type: "error",
              ename: "ZeroDivisionError",
              evalue: "division by zero",
              traceback: [
                "\u001b[0;31mZeroDivisionError\u001b[0m: division by zero",
              ],
            },
          ],
        },
      ],
    };

    const bytes = new TextEncoder().encode(JSON.stringify(notebook))
      .buffer as ArrayBuffer;
    const result = extractIpynbText(bytes);
    expect(result.text).toContain("ZeroDivisionError: division by zero");
    expect(result.text).not.toContain("\u001b[0;31m");
  });

  it("rejects invalid JSON notebook uploads", () => {
    const bytes = new TextEncoder().encode("{ invalid-json ")
      .buffer as ArrayBuffer;
    expect(() => extractIpynbText(bytes)).toThrow(
      "The Jupyter Notebook is not valid JSON.",
    );
  });
});

describe("Code document extraction & chunking", () => {
  it("extracts Python code and preserves block indentation", async () => {
    const pythonCode = [
      "class Evaluator:",
      "    def __init__(self, weights):",
      "        self.weights = weights",
      "",
      "    def evaluate(self, items):",
      "        for item in items:",
      "            if item > 0:",
      "                yield item * 2",
    ].join("\n");

    const bytes = new TextEncoder().encode(pythonCode).buffer as ArrayBuffer;
    const result = await extractDocumentText(bytes, "text/x-python");

    expect(result.metadata.extractor).toBe("code");
    expect(result.text).toContain("    def __init__(self, weights):");
    expect(result.text).toContain("            if item > 0:");

    const chunks = chunkExtractedPages(result.pages);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.content).toContain("        self.weights = weights");
  });

  it("extracts JavaScript / TypeScript code and preserves indentation", async () => {
    const tsCode = [
      "interface AgentConfig {",
      "  readonly id: string;",
      "  readonly maxTokens: number;",
      "}",
      "",
      "export function runAgent(config: AgentConfig) {",
      "  return config.maxTokens * 2;",
      "}",
    ].join("\n");

    const bytes = new TextEncoder().encode(tsCode).buffer as ArrayBuffer;
    const result = await extractDocumentText(bytes, "text/typescript");

    expect(result.metadata.extractor).toBe("code");
    expect(result.text).toContain("  readonly id: string;");
    expect(result.text).toContain("  return config.maxTokens * 2;");

    const chunks = chunkExtractedPages(result.pages);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.content).toContain("  readonly id: string;");
  });
});
