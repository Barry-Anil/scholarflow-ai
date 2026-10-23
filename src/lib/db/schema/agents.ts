import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { assignments } from "./assignments";
import { timestamps } from "./common";
import { agentName, runStatus, workflowStatus } from "./enums";

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id").notNull(),
    agent: agentName("agent").notNull(),
    status: runStatus("status").default("queued").notNull(),
    workflowState: workflowStatus("workflow_state").notNull(),
    iteration: integer("iteration").default(0).notNull(),
    provider: varchar("provider", { length: 80 }),
    model: varchar("model", { length: 160 }),
    inputSnapshot: jsonb("input_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    output: jsonb("output").$type<Record<string, unknown>>(),
    errorCode: varchar("error_code", { length: 100 }),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    index("agent_runs_assignment_idx").on(table.assignmentId, table.createdAt),
  ],
);

export const agentRunEvents = pgTable(
  "agent_run_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    assignmentId: uuid("assignment_id").notNull(),
    ownerId: uuid("owner_id").notNull(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    message: text("message").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("agent_run_events_run_idx").on(table.runId, table.createdAt),
  ],
);

// One row per worker process. The worker id embeds the host name, so it is
// never returned to browsers; monitoring only exposes timestamps and status.
export const agentWorkerHeartbeats = pgTable(
  "agent_worker_heartbeats",
  {
    workerId: varchar("worker_id", { length: 160 }).primaryKey(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    currentJobId: uuid("current_job_id"),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  },
  (table) => [
    index("agent_worker_heartbeats_last_idx").on(table.lastHeartbeatAt),
  ],
);
