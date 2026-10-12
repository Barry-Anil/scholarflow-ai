import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { agentRuns } from "./agents";
import { assignments } from "./assignments";
import { courses } from "./core";
import { assignmentDrafts } from "./drafts";
import { agentName, exportFormat, jobStatus } from "./enums";
import { draftApprovals } from "./reviews";

export const usageRecords = pgTable(
  "usage_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    courseId: uuid("course_id").references(() => courses.id, {
      onDelete: "set null",
    }),
    assignmentId: uuid("assignment_id").references(() => assignments.id, {
      onDelete: "set null",
    }),
    runId: uuid("run_id").references(() => agentRuns.id, {
      onDelete: "set null",
    }),
    agent: agentName("agent").notNull(),
    provider: varchar("provider", { length: 80 }).notNull(),
    model: varchar("model", { length: 160 }).notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    estimatedCostUsd: numeric("estimated_cost_usd", {
      precision: 12,
      scale: 6,
    }),
    latencyMs: integer("latency_ms"),
    status: varchar("status", { length: 60 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("usage_records_owner_created_idx").on(table.ownerId, table.createdAt),
  ],
);

export const exportRecords = pgTable(
  "export_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => assignmentDrafts.id, { onDelete: "restrict" }),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => draftApprovals.id, { onDelete: "restrict" }),
    ownerId: uuid("owner_id").notNull(),
    format: exportFormat("format").notNull(),
    filename: varchar("filename", { length: 500 }),
    mimeType: varchar("mime_type", { length: 160 }),
    sizeBytes: integer("size_bytes"),
    storagePath: text("storage_path"),
    status: jobStatus("status").default("queued").notNull(),
    errorMessage: text("error_message"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("export_records_assignment_idx").on(
      table.assignmentId,
      table.createdAt,
    ),
  ],
);
