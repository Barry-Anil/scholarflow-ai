import type { TextPage } from "@/features/knowledge/chunking";

export type DetectedStudySection = {
  position: number;
  title: string;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
};

type SectionDraft = Omit<DetectedStudySection, "position">;
type Line = { text: string; page: number | null };

const MAX_SECTION_CHARS = 6_000;
const MAX_CHAPTER_CHARS = 16_000;
const MIN_CHAPTER_CONTENT_CHARS = 80;

// Chapter-level heading styles, strongest first. The first style that marks
// at least two real chapters decides how the whole document is divided.
const CHAPTER_PATTERNS = [
  /^\d{1,3}\s*\|\s*\S/, // "1 | Digital image fundamentals"
  /^(?:chapter|part|unit|module|week|lecture|topic)\s+(?:\d+|[ivxlc]+)\b/i,
  /^#{1,2}\s+[A-Za-z]/, // Markdown headings in plain-text notes
];
// Numbered headings inside a chapter, e.g. "1. Core concept" or "7-10. Memory".
const SUBHEADING = /^\d+(?:[.-]\d+)*[.)]?\s+\S/;

function looksLikeHeading(line: string) {
  const value = line.trim().replace(/^#{1,6}\s+/, "");
  if (value.length < 3 || value.length > 120 || /[.!?]$/.test(value))
    return false;
  if (/^(chapter|section|unit|part)\s+[\divxlc]+\b/i.test(value)) return true;
  if (/^\d+(?:\.\d+)*[.)]?\s+\S/.test(value)) return true;
  const letters = value.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3 && value === value.toUpperCase();
}

/** A short title line at the top of a page, such as "Contents and study method". */
function looksLikePageTitle(line: string) {
  const value = line.trim();
  if (value.length < 3 || value.length > 90) return false;
  if (!/^[A-Za-z]/.test(value) || /[.:;,!?]$/.test(value)) return false;
  if (value.includes(":")) return false;
  return value.split(/\s+/).length <= 10;
}

function readableTitle(value: string, fallback: string) {
  return (
    value
      .replace(/^#{1,6}\s+/, "")
      .replace(/^(\d{1,3})\s*\|\s*/, "$1. ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300) || fallback
  );
}

function splitLongSection(section: SectionDraft, maxChars: number) {
  if (section.content.length <= maxChars) return [section];
  const parts: SectionDraft[] = [];
  let remaining = section.content;
  while (remaining.length) {
    let end = Math.min(maxChars, remaining.length);
    if (end < remaining.length) {
      end = Math.max(
        Math.floor(maxChars * 0.6),
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

function pageLines(page: TextPage) {
  return page.text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Running headers and footers ("Course guide | Weeks 1-11 3") repeat at the
 * top or bottom of most pages; they are layout, not content.
 */
function runningLineKeys(pages: TextPage[]) {
  const keys = new Set<string>();
  if (pages.length < 3) return keys;
  const counts = new Map<string, number>();
  for (const page of pages) {
    const lines = pageLines(page);
    const edges = new Set(
      [...lines.slice(0, 2), ...lines.slice(-2)].map(runningKey),
    );
    for (const key of edges) {
      if (key.length >= 3) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.5));
  for (const [key, count] of counts) {
    if (count >= threshold) keys.add(key);
  }
  return keys;
}

function runningKey(line: string) {
  return line
    .replace(/\s*\d+\s*$/, "")
    .trim()
    .toLowerCase();
}

function documentLines(pages: TextPage[]): Line[] {
  const running = runningLineKeys(pages);
  return pages.flatMap((page) =>
    pageLines(page)
      .filter((line) => !running.has(runningKey(line)))
      .map((text) => ({ text, page: page.pageNumber ?? null })),
  );
}

function contentLength(lines: Line[], start: number, end: number) {
  return lines
    .slice(start, end)
    .reduce((total, line) => total + line.text.length, 0);
}

/** Headings of one style that introduce real content (not a contents list). */
function chapterStarts(lines: Line[], pattern: RegExp) {
  const candidates = lines.flatMap((line, index) =>
    pattern.test(line.text) ? [index] : [],
  );
  return candidates.filter(
    (start, index) =>
      contentLength(lines, start + 1, candidates[index + 1] ?? lines.length) >=
      MIN_CHAPTER_CONTENT_CHARS,
  );
}

/** Joins a heading that wrapped onto a second line, e.g. "(Week 7)". */
function chapterHeading(lines: Line[], start: number) {
  const heading = lines[start]!.text;
  const next = lines[start + 1]?.text;
  const after = lines[start + 2]?.text;
  const wrapped =
    next !== undefined &&
    next.length <= 40 &&
    !SUBHEADING.test(next) &&
    !CHAPTER_PATTERNS.some((pattern) => pattern.test(next)) &&
    (/^[a-z(]/.test(next) ||
      /^\d+\)/.test(next) ||
      (after !== undefined && SUBHEADING.test(after)));
  return wrapped
    ? { title: `${heading} ${next}`, bodyStart: start + 2 }
    : { title: heading, bodyStart: start + 1 };
}

function draftFrom(title: string, lines: Line[]): SectionDraft | null {
  const content = lines
    .map((line) => line.text)
    .join("\n")
    .trim();
  if (!content) return null;
  return {
    title,
    content,
    pageStart: lines[0]?.page ?? null,
    pageEnd: lines.at(-1)?.page ?? null,
  };
}

/**
 * Splits material outside the chapters (title page, contents, cheat sheets)
 * where a page opens with a title; other pages continue the previous part.
 */
function pageTitledSections(lines: Line[], fallbackTitle: string) {
  const sections: Array<{ title: string; lines: Line[] }> = [];
  lines.forEach((line, index) => {
    const startsPage = index === 0 || lines[index - 1]!.page !== line.page;
    if (startsPage && looksLikePageTitle(line.text)) {
      sections.push({ title: line.text, lines: [] });
    } else if (sections.length) {
      sections.at(-1)!.lines.push(line);
    } else {
      sections.push({ title: fallbackTitle, lines: [line] });
    }
  });
  return sections;
}

function detectChapterSections(
  lines: Line[],
  starts: number[],
  documentTitle: string,
) {
  const drafts: Array<SectionDraft | null> = [];
  for (const front of pageTitledSections(
    lines.slice(0, starts[0]),
    `${documentTitle} introduction`,
  )) {
    drafts.push(
      draftFrom(readableTitle(front.title, "Introduction"), front.lines),
    );
  }
  starts.forEach((start, index) => {
    const { title, bodyStart } = chapterHeading(lines, start);
    const isLast = index === starts.length - 1;
    let end = starts[index + 1] ?? lines.length;
    if (isLast) {
      // After the final chapter, a page opening with a title begins back
      // matter (cheat sheets, revision lists) rather than more chapter text.
      const headingPage = lines[start]!.page;
      const backMatter = lines.findIndex(
        (line, lineIndex) =>
          lineIndex > bodyStart &&
          line.page !== headingPage &&
          line.page !== lines[lineIndex - 1]!.page &&
          looksLikePageTitle(line.text),
      );
      if (backMatter !== -1) end = backMatter;
    }
    drafts.push(
      draftFrom(
        readableTitle(title, `Chapter ${index + 1}`),
        lines.slice(bodyStart, end),
      ),
    );
    if (isLast && end < lines.length) {
      for (const back of pageTitledSections(
        lines.slice(end),
        "Additional material",
      )) {
        drafts.push(draftFrom(readableTitle(back.title, "Notes"), back.lines));
      }
    }
  });
  return drafts.filter((draft): draft is SectionDraft => draft !== null);
}

/** Fallback for notes without chapter headings: split each page at headings. */
function detectPageSections(pages: TextPage[], documentTitle: string) {
  const detected: SectionDraft[] = [];
  for (const page of pages) {
    if (!page.text.trim()) continue;
    const lines = pageLines(page);
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
  return detected;
}

export function detectStudySections(pages: TextPage[], documentTitle: string) {
  const lines = documentLines(pages);
  for (const pattern of CHAPTER_PATTERNS) {
    const starts = chapterStarts(lines, pattern);
    if (starts.length >= 2) {
      return detectChapterSections(lines, starts, documentTitle)
        .flatMap((section) => splitLongSection(section, MAX_CHAPTER_CHARS))
        .map((section, position) => ({ ...section, position }));
    }
  }
  return detectPageSections(pages, documentTitle)
    .flatMap((section) => splitLongSection(section, MAX_SECTION_CHARS))
    .map((section, position) => ({ ...section, position }));
}
