import type { TextPage } from "@/features/knowledge/chunking";

export type DetectedStudySection = {
  position: number;
  title: string;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
};

const MAX_SECTION_CHARS = 6_000;

function looksLikeHeading(line: string) {
  const value = line.trim().replace(/^#{1,6}\s+/, "");
  if (value.length < 3 || value.length > 120 || /[.!?]$/.test(value))
    return false;
  if (/^(chapter|section|unit|part)\s+[\divxlc]+\b/i.test(value)) return true;
  if (/^\d+(?:\.\d+)*[.)]?\s+\S/.test(value)) return true;
  const letters = value.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3 && value === value.toUpperCase();
}

function readableTitle(value: string, fallback: string) {
  return (
    value
      .replace(/^#{1,6}\s+/, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300) || fallback
  );
}

function splitLongSection(section: Omit<DetectedStudySection, "position">) {
  if (section.content.length <= MAX_SECTION_CHARS) return [section];
  const parts: Omit<DetectedStudySection, "position">[] = [];
  let remaining = section.content;
  while (remaining.length) {
    let end = Math.min(MAX_SECTION_CHARS, remaining.length);
    if (end < remaining.length) {
      end = Math.max(
        3_500,
        remaining.lastIndexOf("\n\n", end),
        remaining.lastIndexOf(". ", end),
      );
    }
    const content = remaining.slice(0, end).trim();
    if (content) {
      parts.push({
        ...section,
        title: parts.length
          ? `${section.title} (${parts.length + 1})`
          : section.title,
        content,
      });
    }
    remaining = remaining.slice(end).trim();
  }
  return parts;
}

export function detectStudySections(pages: TextPage[], documentTitle: string) {
  const detected: Omit<DetectedStudySection, "position">[] = [];
  for (const page of pages) {
    if (!page.text.trim()) continue;
    const lines = page.text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const headingIndexes = lines.flatMap((line, index) =>
      looksLikeHeading(line) ? [index] : [],
    );
    if (!headingIndexes.length) {
      detected.push({
        title: page.pageNumber ? `Page ${page.pageNumber}` : documentTitle,
        content: page.text.trim(),
        pageStart: page.pageNumber ?? null,
        pageEnd: page.pageNumber ?? null,
      });
      continue;
    }
    const preface = lines.slice(0, headingIndexes[0]).join("\n").trim();
    if (preface) {
      detected.push({
        title: page.pageNumber
          ? `Page ${page.pageNumber} overview`
          : `${documentTitle} overview`,
        content: preface,
        pageStart: page.pageNumber ?? null,
        pageEnd: page.pageNumber ?? null,
      });
    }
    headingIndexes.forEach((start, headingIndex) => {
      const end = headingIndexes[headingIndex + 1] ?? lines.length;
      const content = lines
        .slice(start + 1, end)
        .join("\n")
        .trim();
      if (!content) return;
      detected.push({
        title: readableTitle(
          lines[start] ?? "",
          `Section ${detected.length + 1}`,
        ),
        content,
        pageStart: page.pageNumber ?? null,
        pageEnd: page.pageNumber ?? null,
      });
    });
  }
  return detected.flatMap(splitLongSection).map((section, position) => ({
    ...section,
    position,
  }));
}
