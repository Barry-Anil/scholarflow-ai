import "server-only";

import { extractText, getDocumentProxy } from "unpdf";

import { AppError } from "@/lib/errors";
import { normalizeExtractedText, type TextPage } from "./chunking";
import { MAX_PDF_PAGES, type AcceptedDocumentMime } from "./constants";
import { extractDocxText } from "./docx";
import { extractIpynbText } from "./ipynb";

export type ExtractedDocument = {
  text: string;
  pages: TextPage[];
  metadata: Record<string, unknown>;
};

export async function extractDocumentText(
  bytes: ArrayBuffer,
  mimeType: AcceptedDocumentMime,
): Promise<ExtractedDocument> {
  if (mimeType === "application/pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new AppError(
        "INVALID_INPUT",
        `PDFs are limited to ${MAX_PDF_PAGES} pages.`,
        { status: 413 },
      );
    }
    const result = await extractText(pdf, { mergePages: false });
    const pageTexts = Array.isArray(result.text) ? result.text : [result.text];
    const pages = pageTexts.map((text, index) => ({
      pageNumber: index + 1,
      text: normalizeExtractedText(text),
    }));
    return {
      text: pages
        .map((page) => page.text)
        .filter(Boolean)
        .join("\n\n"),
      pages,
      metadata: { pageCount: result.totalPages, extractor: "unpdf" },
    };
  }

  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = extractDocxText(bytes);
    return {
      text: result.text,
      pages: [{ text: result.text }],
      metadata: {
        extractor: "docx-xml",
        partCount: result.partCount,
      },
    };
  }

  if (mimeType === "application/x-ipynb+json") {
    const result = extractIpynbText(bytes);
    return {
      text: result.text,
      pages: [{ text: result.text, preserveIndentation: true }],
      metadata: {
        extractor: "ipynb-json",
        cellCount: result.cellCount,
        language: result.language,
      },
    };
  }

  if (
    mimeType === "text/x-python" ||
    mimeType === "text/javascript" ||
    mimeType === "application/javascript" ||
    mimeType === "text/typescript" ||
    mimeType === "application/typescript" ||
    mimeType === "text/x-typescript"
  ) {
    const raw = Buffer.from(bytes).toString("utf8");
    const text = normalizeExtractedText(raw, { preserveIndentation: true });
    return {
      text,
      pages: [{ text, preserveIndentation: true }],
      metadata: {
        extractor: "code",
        mimeType,
      },
    };
  }

  const text = normalizeExtractedText(Buffer.from(bytes).toString("utf8"));
  return {
    text,
    pages: [{ text }],
    metadata: { extractor: "utf8" },
  };
}
