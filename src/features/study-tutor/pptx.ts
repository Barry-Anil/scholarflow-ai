import { strFromU8, unzipSync } from "fflate";

import { AppError } from "@/lib/errors";
import {
  normalizeExtractedText,
  type TextPage,
} from "@/features/knowledge/chunking";

const MAX_ARCHIVE_ENTRIES = 2_000;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

export function extractPptxText(bytes: ArrayBuffer) {
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(new Uint8Array(bytes));
  } catch (error) {
    throw new AppError(
      "INVALID_INPUT",
      "This PowerPoint file is damaged or invalid.",
      {
        cause: error,
        status: 422,
      },
    );
  }
  const entries = Object.entries(archive);
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new AppError(
      "INVALID_INPUT",
      "This PowerPoint archive contains too many files.",
      {
        status: 413,
      },
    );
  }
  const totalBytes = entries.reduce(
    (total, [, value]) => total + value.byteLength,
    0,
  );
  if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
    throw new AppError(
      "INVALID_INPUT",
      "This PowerPoint expands beyond the processing limit.",
      {
        status: 413,
      },
    );
  }

  const slides = entries
    .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort(([left], [right]) => {
      const number = (name: string) =>
        Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      return number(left) - number(right);
    });
  if (!slides.length) {
    throw new AppError(
      "INVALID_INPUT",
      "No readable slides were found in this PowerPoint.",
      {
        status: 422,
      },
    );
  }

  const pages: TextPage[] = slides.map(([, data], index) => {
    const xml = strFromU8(data);
    const runs = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map(
      (match) => decodeXml(match[1] ?? ""),
    );
    return {
      pageNumber: index + 1,
      text: normalizeExtractedText(runs.join("\n")),
    };
  });
  return {
    text: pages
      .map((page) => page.text)
      .filter(Boolean)
      .join("\n\n"),
    pages,
    metadata: { extractor: "pptx-xml", slideCount: pages.length },
  };
}
