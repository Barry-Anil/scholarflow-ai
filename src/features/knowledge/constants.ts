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
  "application/x-ipynb+json": "IPYNB",
  "text/x-python": "Python",
  "text/javascript": "JavaScript",
  "application/javascript": "JavaScript",
  "text/typescript": "TypeScript",
  "application/typescript": "TypeScript",
  "text/x-typescript": "TypeScript",
} as const;

export const acceptedDocumentLabels = Array.from(
  new Set(Object.values(acceptedDocumentTypes)),
);

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
  ipynb: "application/x-ipynb+json",
  py: "text/x-python",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  jsx: "text/javascript",
  ts: "text/typescript",
  tsx: "text/typescript",
  mts: "text/typescript",
  cts: "text/typescript",
};

export function resolveAcceptedDocumentMime(
  filename: string,
  reportedMime: string,
) {
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  if (extension && extension in mimeByExtension) {
    return mimeByExtension[extension];
  }
  if (isAcceptedDocumentMime(reportedMime)) return reportedMime;
  return null;
}
