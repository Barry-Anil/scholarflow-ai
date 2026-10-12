import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { agentRuns } from "./agents";
import { assignmentQuestions, assignments } from "./assignments";
import { timestamps } from "./common";
import { agentName, sourceType } from "./enums";

export const assignmentDrafts = pgTable(
  "assignment_drafts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id").notNull(),
    version: integer("version").notNull(),
    markdown: text("markdown").default("").notNull(),
    wordCount: integer("word_count").default(0).notNull(),
    createdByAgent: agentName("created_by_agent"),
    sourceRunId: uuid("source_run_id").references(() => agentRuns.id, {
      onDelete: "set null",
    }),
    isApproved: boolean("is_approved").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("assignment_drafts_version_uidx").on(
      table.assignmentId,
      table.version,
    ),
  ],
);

export const draftAnswers = pgTable(
  "draft_answers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => assignmentDrafts.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => assignmentQuestions.id, { onDelete: "cascade" }),
    markdown: text("markdown").default("").notNull(),
    confidenceScore: integer("confidence_score").notNull(),
    confidenceReasons: jsonb("confidence_reasons")
      .$type<string[]>()
      .default([])
      .notNull(),
    wordCount: integer("word_count").default(0).notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("draft_answers_draft_question_uidx").on(
      table.draftId,
      table.questionId,
    ),
    check(
      "draft_answers_confidence_check",
      sql`${table.confidenceScore} between 0 and 100`,
    ),
  ],
);

export const researchFindings = pgTable(
  "research_findings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    questionId: uuid("question_id").references(() => assignmentQuestions.id, {
      onDelete: "cascade",
    }),
    runId: uuid("run_id").references(() => agentRuns.id, {
      onDelete: "set null",
    }),
    ownerId: uuid("owner_id").notNull(),
    claim: text("claim").notNull(),
    evidence: text("evidence").notNull(),
    sourceType: sourceType("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    citationMetadata: jsonb("citation_metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    relevanceScore: real("relevance_score").notNull(),
    limitations: text("limitations"),
    conflicts: jsonb("conflicts").$type<string[]>().default([]).notNull(),
    nextSteps: jsonb("next_steps").$type<string[]>().default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("research_findings_assignment_idx").on(table.assignmentId)],
);

export const answerCitations = pgTable(
  "answer_citations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => draftAnswers.id, { onDelete: "cascade" }),
    researchFindingId: uuid("research_finding_id").references(
      () => researchFindings.id,
      { onDelete: "set null" },
    ),
    sourceType: sourceType("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    claimText: text("claim_text").notNull(),
    locator: text("locator"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    verified: boolean("verified").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("answer_citations_answer_idx").on(table.answerId)],
);
