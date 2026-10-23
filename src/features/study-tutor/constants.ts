export const STUDY_STORAGE_BUCKET = "study-notes";
export const STUDY_DOCUMENT_JOB_TYPE = "study_document_process";
export const MAX_STUDY_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const MAX_STUDY_PDF_PAGES = 500;

export const STUDY_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
] as const;

export type StudyMimeType = (typeof STUDY_MIME_TYPES)[number];

const extensionMime: Record<string, StudyMimeType> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
};

export function resolveStudyMime(filename: string, reportedMime: string) {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const expected = extensionMime[extension];
  if (!expected) return null;
  if (!reportedMime || reportedMime === "application/octet-stream")
    return expected;
  return reportedMime === expected ? expected : null;
}

export function safeStudyFilename(filename: string) {
  const normalized = filename
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
  return normalized || "notes";
}
