import { strFromU8, unzipSync } from "fflate";

import { AppError } from "@/lib/errors";
import { normalizeExtractedText } from "./chunking";

const MAX_XML_PART_BYTES = 20 * 1024 * 1024;
const textPartPattern =
  /^word\/(document|footnotes|endnotes|header\d+|footer\d+)\.xml$/;

function decodeXmlEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function textFromWordXml(xml: string) {
  return normalizeExtractedText(
    decodeXmlEntities(
      xml
        .replace(/<w:tab\s*\/?\s*>/gi, "\t")
        .replace(/<w:br\b[^>]*\/?\s*>/gi, "\n")
        .replace(/<\/w:p>/gi, "\n\n")
        .replace(/<[^>]+>/g, ""),
    ),
  );
}

export function extractDocxText(bytes: ArrayBuffer) {
  let oversizedPart = false;
  let archive: ReturnType<typeof unzipSync>;
  try {
    archive = unzipSync(new Uint8Array(bytes), {
      filter(file) {
        if (!textPartPattern.test(file.name)) return false;
        if (file.originalSize > MAX_XML_PART_BYTES) {
          oversizedPart = true;
          return false;
        }
        return true;
      },
    });
  } catch (error) {
    throw new AppError("INVALID_INPUT", "The DOCX file is invalid.", {
      cause: error,
    });
  }

  if (oversizedPart) {
    throw new AppError(
      "INVALID_INPUT",
      "The DOCX contains an unusually large text section.",
      { status: 413 },
    );
  }
  if (!archive["word/document.xml"]) {
    throw new AppError(
      "INVALID_INPUT",
      "The DOCX has no readable document body.",
    );
  }

  const partNames = Object.keys(archive).sort((left, right) => {
    if (left === "word/document.xml") return -1;
    if (right === "word/document.xml") return 1;
    return left.localeCompare(right);
  });
  const text = partNames
    .map((name) => textFromWordXml(strFromU8(archive[name]!)))
    .filter(Boolean)
    .join("\n\n");

  return { text, partCount: partNames.length };
}
