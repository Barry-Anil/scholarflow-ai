export type TextPage = {
  pageNumber?: number;
  text: string;
  preserveIndentation?: boolean;
};

export type KnowledgeChunk = {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageStart: number | null;
  pageEnd: number | null;
};

const TARGET_CHARACTERS = 1_600;
const OVERLAP_CHARACTERS = 240;

export function normalizeExtractedText(
  value: string,
  options?: { preserveIndentation?: boolean },
) {
  if (options?.preserveIndentation) {
    return value
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findChunkEnd(text: string, start: number) {
  const target = Math.min(start + TARGET_CHARACTERS, text.length);
  if (target === text.length) return target;

  const minimum = start + Math.floor(TARGET_CHARACTERS * 0.65);
  const candidates = [
    text.lastIndexOf("\n\n", target),
    text.lastIndexOf(". ", target),
    text.lastIndexOf("\n", target),
    text.lastIndexOf(" ", target),
  ];
  return candidates.find((candidate) => candidate >= minimum) ?? target;
}

export function chunkExtractedPages(pages: TextPage[]): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];

  for (const page of pages) {
    const text = normalizeExtractedText(page.text, {
      preserveIndentation: page.preserveIndentation,
    });
    if (!text) continue;

    let start = 0;
    while (start < text.length) {
      const end = findChunkEnd(text, start);
      const content = text.slice(start, end).trim();
      if (content) {
        chunks.push({
          chunkIndex: chunks.length,
          content,
          tokenCount: Math.ceil(content.length / 4),
          pageStart: page.pageNumber ?? null,
          pageEnd: page.pageNumber ?? null,
        });
      }
      if (end >= text.length) break;
      start = Math.max(end - OVERLAP_CHARACTERS, start + 1);
    }
  }

  return chunks;
}
