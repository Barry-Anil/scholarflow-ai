import "server-only";

import { extractText, getDocumentProxy } from "unpdf";

import {
  normalizeExtractedText,
  type TextPage,
} from "@/features/knowledge/chunking";
import { extractDocxText } from "@/features/knowledge/docx";
import { AppError } from "@/lib/errors";
import { MAX_STUDY_PDF_PAGES, type StudyMimeType } from "./constants";
import { extractPptxText } from "./pptx";

export type StudyExtraction = {
  text: string;
  pages: TextPage[];
  metadata: Record<string, unknown>;
};

export function validateStudyFileSignature(
  bytes: Uint8Array,
  mime: StudyMimeType,
) {
  if (
    mime === "application/pdf" &&
    Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-"
  ) {
    throw new AppError(
      "INVALID_INPUT",
      "The file contents do not match a PDF.",
      { status: 422 },
    );
  }
  if (
    mime.includes("openxmlformats") &&
    !(bytes[0] === 0x50 && bytes[1] === 0x4b)
  ) {
    throw new AppError(
      "INVALID_INPUT",
      "The file contents do not match an Office document.",
      {
        status: 422,
      },
    );
  }
  if (mime === "text/plain" && bytes.includes(0)) {
    throw new AppError(
      "INVALID_INPUT",
      "The text file appears to contain binary data.",
      {
        status: 422,
      },
    );
  }
}

export async function extractStudyDocument(
  bytes: ArrayBuffer,
  mime: StudyMimeType,
): Promise<StudyExtraction> {
  validateStudyFileSignature(new Uint8Array(bytes), mime);
  if (mime === "application/pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    if (pdf.numPages > MAX_STUDY_PDF_PAGES) {
      throw new AppError(
        "INVALID_INPUT",
        `PDFs are limited to ${MAX_STUDY_PDF_PAGES} pages.`,
        {
          status: 413,
        },
      );
    }
    const result = await extractText(pdf, { mergePages: false });
    const texts = Array.isArray(result.text) ? result.text : [result.text];
    const pages = texts.map((text, index) => ({
      pageNumber: index + 1,
      text: normalizeExtractedText(text),
    }));
    const joined = pages
      .map((page) => page.text)
      .filter(Boolean)
      .join("\n\n");
    if (joined.replace(/\s/g, "").length < Math.min(80, pdf.numPages * 12)) {
      throw new AppError(
        "INVALID_INPUT",
        "Very little selectable text was found. This may be a scanned PDF and needs OCR first.",
        { status: 422 },
      );
    }
    return {
      text: joined,
      pages,
      metadata: { extractor: "unpdf", pageCount: pdf.numPages },
    };
  }
  if (mime.endsWith("wordprocessingml.document")) {
    const result = extractDocxText(bytes);
    return {
      text: result.text,
      pages: [{ text: result.text }],
      metadata: { extractor: "docx-xml", partCount: result.partCount },
    };
  }
  if (mime.endsWith("presentationml.presentation"))
    return extractPptxText(bytes);

  const text = normalizeExtractedText(Buffer.from(bytes).toString("utf8"));
  return { text, pages: [{ text }], metadata: { extractor: "utf8" } };
}
