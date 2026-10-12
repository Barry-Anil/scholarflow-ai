import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { agentRuns } from "./agents";
import { assignments, rubricCriteria } from "./assignments";
import { timestamps } from "./common";
import { assignmentDrafts, draftAnswers } from "./drafts";
import { findingResolution, reviewSeverity } from "./enums";

export const reviewReports = pgTable(
  "review_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => assignmentDrafts.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => agentRuns.id, {
      onDelete: "set null",
    }),
    ownerId: uuid("owner_id").notNull(),
    overallStatus: varchar("overall_status", { length: 80 }).notNull(),
    estimatedScore: real("estimated_score"),
    requiresAnotherCycle: boolean("requires_another_cycle").notNull(),
    unresolvedConcerns: jsonb("unresolved_concerns")
      .$type<string[]>()
      .default([])
      .notNull(),
    qualityGateResults: jsonb("quality_gate_results")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("review_reports_assignment_idx").on(
      table.assignmentId,
      table.createdAt,
    ),
  ],
);

export const draftApprovals = pgTable(
  "draft_approvals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => assignmentDrafts.id, { onDelete: "restrict" }),
    reviewReportId: uuid("review_report_id")
      .notNull()
      .references(() => reviewReports.id, { onDelete: "restrict" }),
    ownerId: uuid("owner_id").notNull(),
    attestation: text("attestation").notNull(),
    attestationVersion: varchar("attestation_version", { length: 60 })
      .default("student-approval-v1")
      .notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("draft_approvals_draft_uidx").on(table.draftId),
    index("draft_approvals_assignment_idx").on(
      table.assignmentId,
      table.approvedAt,
    ),
  ],
);

export const reviewFindings = pgTable(
  "review_findings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reviewReports.id, { onDelete: "cascade" }),
    rubricCriterionId: uuid("rubric_criterion_id").references(
      () => rubricCriteria.id,
      { onDelete: "set null" },
    ),
    answerId: uuid("answer_id").references(() => draftAnswers.id, {
      onDelete: "set null",
    }),
    severity: reviewSeverity("severity").notNull(),
    required: boolean("required").default(true).notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    explanation: text("explanation").notNull(),
    location: text("location"),
    evidence: text("evidence"),
    recommendedCorrection: text("recommended_correction").notNull(),
    resolution: findingResolution("resolution").default("open").notNull(),
    decisionNote: text("decision_note"),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    index("review_findings_report_idx").on(table.reportId, table.severity),
  ],
);

export const revisionHistory = pgTable(
  "revision_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    fromDraftId: uuid("from_draft_id").references(() => assignmentDrafts.id, {
      onDelete: "restrict",
    }),
    toDraftId: uuid("to_draft_id")
      .notNull()
      .references(() => assignmentDrafts.id, { onDelete: "restrict" }),
    reportId: uuid("report_id").references(() => reviewReports.id, {
      onDelete: "set null",
    }),
    ownerId: uuid("owner_id").notNull(),
    iteration: integer("iteration").notNull(),
    changeSummary: jsonb("change_summary")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("revision_history_assignment_idx").on(
      table.assignmentId,
      table.iteration,
    ),
  ],
);
