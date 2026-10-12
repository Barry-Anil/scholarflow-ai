export type CitationSourceType =
  "course_material" | "assignment_material" | "discussion" | "external";

export type CitationLike = {
  id?: string;
  sourceType: CitationSourceType;
  sourceId: string;
  claimText: string;
  locator: string | null;
  metadata: Record<string, unknown>;
  verified: boolean;
};

export function citationTitle(citation: CitationLike) {
  return textValue(citation.metadata.title) ?? citation.sourceId;
}

export function citationLocator(citation: CitationLike) {
  if (citation.locator?.trim()) return citation.locator.trim();
  const start = numberValue(citation.metadata.pageStart);
  const end = numberValue(citation.metadata.pageEnd);
  if (start !== null && end !== null && end !== start)
    return `Pages ${start}-${end}`;
  if (start !== null) return `Page ${start}`;
  return null;
}

export function citationVerificationLabel(citation: CitationLike) {
  return citation.verified ? "Verified by Agent A" : "Not yet verified";
}

export function citationUrl(citation: CitationLike) {
  return safeHttpUrl(citation.metadata.url);
}

export function formatReference(citation: CitationLike) {
  const title = citationTitle(citation);
  const locator = citationLocator(citation);
  if (citation.sourceType !== "external") {
    return [title, locator, sourceTypeLabel(citation.sourceType)]
      .filter(Boolean)
      .join(". ");
  }

  const authors = stringArray(citation.metadata.authors);
  const year = numberValue(citation.metadata.year);
  const container = textValue(citation.metadata.containerTitle);
  const doi = textValue(citation.metadata.doi);
  const url = safeHttpUrl(
    doi
      ? `https://doi.org/${doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")}`
      : citation.metadata.url,
  );
  const lead = authors.length ? formatAuthors(authors) : title;
  const parts = [
    year === null ? lead : `${lead} (${year})`,
    authors.length ? title : null,
    container,
    url,
  ];
  return parts.filter(Boolean).join(". ");
}

export function citationIdentity(citation: CitationLike) {
  return `${citation.sourceType}:${citation.sourceId}`;
}

function sourceTypeLabel(sourceType: CitationSourceType) {
  if (sourceType === "course_material") return "Course material";
  if (sourceType === "assignment_material") return "Assignment material";
  if (sourceType === "discussion") return "Course discussion";
  return "External source";
}

function formatAuthors(authors: string[]) {
  if (authors.length === 1) return authors[0];
  if (authors.length === 2) return `${authors[0]} & ${authors[1]}`;
  return `${authors.slice(0, -1).join(", ")}, & ${authors.at(-1)}`;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function safeHttpUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
