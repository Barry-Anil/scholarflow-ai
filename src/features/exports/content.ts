import {
  citationIdentity,
  citationLocator,
  formatReference,
  type CitationLike,
} from "./citation-format";

export const AI_USE_DISCLOSURE =
  "This document was prepared with AI-assisted research, drafting, and review. The student inspected and explicitly approved the exported draft. AI review reduces risk but does not guarantee academic accuracy, originality, or compliance with institutional requirements.";

export type ExportAnswer = {
  position: number;
  prompt: string;
  markdown: string;
  citations: CitationLike[];
};

export type AssignmentExportModel = {
  assignmentTitle: string;
  courseLabel: string;
  draftVersion: number;
  approvedAt: Date;
  reviewStatus: string;
  answers: ExportAnswer[];
};

export type NumberedReference = {
  number: number;
  identity: string;
  text: string;
  citation: CitationLike;
};

export function numberedReferences(model: AssignmentExportModel) {
  const references: NumberedReference[] = [];
  const numberByIdentity = new Map<string, number>();
  for (const citation of model.answers.flatMap((answer) => answer.citations)) {
    const identity = citationIdentity(citation);
    if (numberByIdentity.has(identity)) continue;
    const number = references.length + 1;
    numberByIdentity.set(identity, number);
    references.push({
      number,
      identity,
      text: formatReference(citation),
      citation,
    });
  }
  return { references, numberByIdentity };
}

export function buildMarkdownExport(model: AssignmentExportModel) {
  const { references, numberByIdentity } = numberedReferences(model);
  const lines = [
    `# ${model.assignmentTitle}`,
    "",
    `**Course:** ${model.courseLabel}`,
    `**Approved draft:** Version ${model.draftVersion}`,
    `**Approved at:** ${model.approvedAt.toISOString()}`,
    `**Review status:** ${reviewStatusLabel(model.reviewStatus)}`,
    "",
  ];

  for (const answer of model.answers) {
    lines.push(
      `## Question ${answer.position + 1}`,
      "",
      answer.prompt,
      "",
      answer.markdown.trim() || "_No answer supplied._",
      "",
    );
    if (answer.citations.length) {
      lines.push("### Evidence citations", "");
      for (const citation of answer.citations) {
        const number = numberByIdentity.get(citationIdentity(citation));
        const locator = citationLocator(citation);
        lines.push(
          `- [${number}] ${citation.claimText}${locator ? ` - ${locator}` : ""} - ${citation.verified ? "Verified" : "Unverified"}`,
        );
      }
      lines.push("");
    }
  }

  lines.push("## References", "");
  references.forEach((reference) =>
    lines.push(`[${reference.number}] ${reference.text}`),
  );
  lines.push(
    "",
    "## Review and approval",
    "",
    `Agent A status: ${reviewStatusLabel(model.reviewStatus)}. Student approval applies only to draft version ${model.draftVersion}.`,
    "",
    "## AI use disclosure",
    "",
    AI_USE_DISCLOSURE,
    "",
  );
  return lines.join("\n");
}

export function reviewStatusLabel(status: string) {
  return status === "quality_gates_passed"
    ? "Defined quality gates passed"
    : status.replaceAll("_", " ");
}

export function plainMarkdownBlocks(markdown: string) {
  return markdown
    .replaceAll("\r\n", "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) =>
      block
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/^[-*+]\s+/gm, "- ")
        .replace(/^>\s?/gm, "")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)")
        .replace(/(\*\*|__)(.*?)\1/g, "$2")
        .replace(/(\*|_)(.*?)\1/g, "$2")
        .replace(new RegExp("\\x60([^\\x60]+)\\x60", "g"), "$1"),
    );
}
