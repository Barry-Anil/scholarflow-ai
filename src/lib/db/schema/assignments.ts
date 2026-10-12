import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { timestamps } from "./common";
import { courses } from "./core";
import { workflowStatus } from "./enums";

export const assignments = pgTable(
  "assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id").notNull(),
    title: varchar("title", { length: 280 }).notNull(),
    briefMarkdown: text("brief_markdown").default("").notNull(),
    status: workflowStatus("status").default("CREATED").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    externalResearchAllowed: boolean("external_research_allowed")
      .default(false)
      .notNull(),
    maxIterations: integer("max_iterations").default(5).notNull(),
    currentIteration: integer("current_iteration").default(0).notNull(),
    budgetUsd: numeric("budget_usd", { precision: 10, scale: 4 })
      .default("0")
      .notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    index("assignments_course_idx").on(table.courseId),
    index("assignments_owner_status_idx").on(table.ownerId, table.status),
    check(
      "assignments_iteration_limit_check",
      sql`${table.maxIterations} between 1 and 20`,
    ),
  ],
);

export const assignmentQuestions = pgTable(
  "assignment_questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    prompt: text("prompt").notNull(),
    requirements: jsonb("requirements").$type<string[]>().default([]).notNull(),
    wordLimit: integer("word_limit"),
    required: boolean("required").default(true).notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("assignment_questions_position_uidx").on(
      table.assignmentId,
      table.position,
    ),
  ],
);

export const rubricCriteria = pgTable(
  "rubric_criteria",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 240 }).notNull(),
    description: text("description").notNull(),
    weight: real("weight"),
    minimumThreshold: real("minimum_threshold"),
    position: integer("position").notNull(),
    ...timestamps(),
  },
  (table) => [index("rubric_criteria_assignment_idx").on(table.assignmentId)],
);

export type Assignment = typeof assignments.$inferSelect;
