import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  vector,
} from "drizzle-orm/pg-core";

import { timestamps } from "./common";

export type StudySourceReference = {
  chunkId: string;
  sectionId: string;
  sectionTitle: string;
  pageStart?: number;
  pageEnd?: number;
  excerpt?: string;
};

export const studySessions = pgTable(
  "study_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    status: varchar("status", { length: 32 }).default("processing").notNull(),
    currentSectionId: uuid("current_section_id"),
    preferredTtsProvider: varchar("preferred_tts_provider", { length: 24 })
      .default("browser")
      .notNull(),
    preferredVoiceId: varchar("preferred_voice_id", { length: 160 }),
    playbackRate: numeric("playback_rate", { precision: 3, scale: 2 })
      .default("1.00")
      .notNull(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps(),
  },
  (table) => [
    index("study_sessions_owner_activity_idx").on(
      table.ownerId,
      table.lastActivityAt,
    ),
  ],
);

export const studyDocuments = pgTable(
  "study_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => studySessions.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id").notNull(),
    originalFilename: varchar("original_filename", { length: 500 }).notNull(),
    mimeType: varchar("mime_type", { length: 160 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storagePath: text("storage_path").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    status: varchar("status", { length: 32 }).default("uploaded").notNull(),
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
    uniqueIndex("study_documents_session_uidx").on(table.sessionId),
    uniqueIndex("study_documents_owner_hash_uidx").on(
      table.ownerId,
      table.sha256,
    ),
    index("study_documents_owner_status_idx").on(table.ownerId, table.status),
  ],
);

export const studySections = pgTable(
  "study_sections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => studySessions.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => studyDocuments.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id").notNull(),
    position: integer("position").notNull(),
    title: varchar("title", { length: 300 }).notNull(),
    content: text("content").notNull(),
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("study_sections_session_position_uidx").on(
      table.sessionId,
      table.position,
    ),
    index("study_sections_owner_session_idx").on(
      table.ownerId,
      table.sessionId,
    ),
  ],
);

export const studyChunks = pgTable(
  "study_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => studySessions.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => studyDocuments.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => studySections.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count"),
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
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
    uniqueIndex("study_chunks_document_index_uidx").on(
      table.documentId,
      table.chunkIndex,
    ),
    index("study_chunks_owner_session_idx").on(table.ownerId, table.sessionId),
    index("study_chunks_embedding_hnsw_idx")
      .using("hnsw", table.embedding.op("vector_cosine_ops"))
      .with({ m: 16, ef_construction: 64 }),
  ],
);

export const studyMessages = pgTable(
  "study_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => studySessions.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id").notNull(),
    role: varchar("role", { length: 16 }).notNull(),
    content: text("content").notNull(),
    supportLevel: varchar("support_level", { length: 24 }),
    references: jsonb("references")
      .$type<StudySourceReference[]>()
      .default([])
      .notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("study_messages_owner_session_created_idx").on(
      table.ownerId,
      table.sessionId,
      table.createdAt,
    ),
  ],
);

export const studyExplanations = pgTable(
  "study_explanations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => studySessions.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => studySections.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id").notNull(),
    mode: varchar("mode", { length: 32 }).notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    references: jsonb("references")
      .$type<StudySourceReference[]>()
      .default([])
      .notNull(),
    provider: varchar("provider", { length: 40 }).notNull(),
    model: varchar("model", { length: 160 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("study_explanations_owner_section_idx").on(
      table.ownerId,
      table.sectionId,
      table.createdAt,
    ),
  ],
);

export const studyProgress = pgTable(
  "study_progress",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => studySessions.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => studySections.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id").notNull(),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("study_progress_session_section_uidx").on(
      table.sessionId,
      table.sectionId,
    ),
    index("study_progress_owner_session_idx").on(
      table.ownerId,
      table.sessionId,
    ),
  ],
);

export type StudySession = typeof studySessions.$inferSelect;
export type StudySection = typeof studySections.$inferSelect;
export type StudyMessage = typeof studyMessages.$inferSelect;
