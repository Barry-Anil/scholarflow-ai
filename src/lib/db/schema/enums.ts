import { pgEnum } from "drizzle-orm/pg-core";

export const courseMemberRole = pgEnum("course_member_role", [
  "owner",
  "editor",
  "viewer",
]);
export const documentStatus = pgEnum("document_status", [
  "uploaded",
  "queued",
  "processing",
  "ready",
  "partially_processed",
  "failed",
]);
export const jobStatus = pgEnum("job_status", [
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);
export const workflowStatus = pgEnum("workflow_status", [
  "CREATED",
  "INGESTING",
  "READY",
  "PLANNING",
  "RESEARCHING",
  "DRAFTING",
  "REVIEWING",
  "REVISING",
  "FINAL_REVIEW",
  "READY_FOR_STUDENT_APPROVAL",
  "APPROVED",
  "NEEDS_INFORMATION",
  "PAUSED",
  "FAILED",
  "CANCELLED",
  "MAX_ITERATIONS_REACHED",
]);
export const agentName = pgEnum("agent_name", [
  "student",
  "researcher",
  "reviewer",
  "system",
]);
export const runStatus = pgEnum("agent_run_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export const sourceType = pgEnum("source_type", [
  "course_material",
  "assignment_material",
  "discussion",
  "external",
]);
export const reviewSeverity = pgEnum("review_severity", [
  "critical",
  "major",
  "minor",
  "suggestion",
]);
export const findingResolution = pgEnum("finding_resolution", [
  "open",
  "accepted",
  "rejected",
  "resolved",
]);
export const exportFormat = pgEnum("export_format", [
  "markdown",
  "docx",
  "pdf",
]);
