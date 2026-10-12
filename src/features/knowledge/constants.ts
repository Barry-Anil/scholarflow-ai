export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const MAX_PDF_PAGES = 500;
export const DOCUMENT_JOB_TYPE = "extract_document";
export const EMBEDDING_JOB_TYPE = "knowledge.embedding.backfill";

export const acceptedDocumentTypes = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "DOCX",
  "text/plain": "TXT",
  "text/markdown": "Markdown",
  "text/csv": "CSV",
} as const;

export type AcceptedDocumentMime = keyof typeof acceptedDocumentTypes;

export function isAcceptedDocumentMime(
  mimeType: string,
): mimeType is AcceptedDocumentMime {
  return mimeType in acceptedDocumentTypes;
}

const mimeByExtension: Record<string, AcceptedDocumentMime> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
};

export function resolveAcceptedDocumentMime(
  filename: string,
  reportedMime: string,
) {
  if (isAcceptedDocumentMime(reportedMime)) return reportedMime;
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  return mimeByExtension[extension] ?? null;
}
