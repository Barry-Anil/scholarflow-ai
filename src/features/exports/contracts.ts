export const EXPORT_JOB_TYPE = "assignment_export";
export const EXPORT_BUCKET = "assignment-exports";
export const EXPORT_FORMATS = ["markdown", "docx", "pdf"] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type ExportJobPayload = {
  exportRecordId: string;
  draftId: string;
  approvalId: string;
  format: ExportFormat;
};
