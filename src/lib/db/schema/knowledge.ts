import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  vector,
} from "drizzle-orm/pg-core";

import { assignments } from "./assignments";
import { timestamps } from "./common";
import { courses } from "./core";
import { documentStatus, jobStatus } from "./enums";

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    assignmentId: uuid("assignment_id").references(() => assignments.id, {
      onDelete: "set null",
    }),
    originalFilename: varchar("original_filename", { length: 500 }).notNull(),
    mimeType: varchar("mime_type", { length: 160 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storagePath: text("storage_path").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    status: documentStatus("status").default("uploaded").notNull(),
    extractedText: text("extracted_text"),
    extractionMetadata: jsonb("extraction_metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    errorMessage: text("error_message"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    index("documents_course_status_idx").on(table.courseId, table.status),
    uniqueIndex("documents_owner_hash_uidx").on(table.ownerId, table.sha256),
  ],
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id").notNull(),
    courseId: uuid("course_id").notNull(),
    assignmentId: uuid("assignment_id"),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count"),
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
    sectionTitle: text("section_title"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    embedding: vector("embedding", { dimensions: 768 }),
    embeddingModel: varchar("embedding_model", { length: 160 }),
    embeddedAt: timestamp("embedded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("document_chunks_document_index_uidx").on(
      table.documentId,
      table.chunkIndex,
    ),
    index("document_chunks_course_idx").on(table.courseId),
    index("document_chunks_embedding_hnsw_idx")
      .using("hnsw", table.embedding.op("vector_cosine_ops"))
      .with({ m: 16, ef_construction: 64 }),
  ],
);

export const processingJobs = pgTable(
  "processing_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    courseId: uuid("course_id").references(() => courses.id, {
      onDelete: "cascade",
    }),
    assignmentId: uuid("assignment_id").references(() => assignments.id, {
      onDelete: "cascade",
    }),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "cascade",
    }),
    type: varchar("type", { length: 80 }).notNull(),
    status: jobStatus("status").default("queued").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: varchar("locked_by", { length: 160 }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 100 }),
    lastError: text("last_error"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    index("processing_jobs_claim_idx").on(table.status, table.availableAt),
    index("processing_jobs_lease_idx").on(table.status, table.leaseExpiresAt),
    index("processing_jobs_owner_idx").on(table.ownerId),
  ],
);

export const processingJobDiagnostics = pgTable(
  "processing_job_diagnostics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => processingJobs.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    errorCode: varchar("error_code", { length: 100 }).notNull(),
    detail: text("detail").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("processing_job_diagnostics_job_idx").on(table.jobId)],
);

export type Document = typeof documents.$inferSelect;
