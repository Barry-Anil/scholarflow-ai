CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";--> statement-breakpoint
SET search_path TO public, extensions;--> statement-breakpoint
CREATE TYPE "public"."agent_name" AS ENUM('student', 'researcher', 'reviewer', 'system');--> statement-breakpoint
CREATE TYPE "public"."course_member_role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('uploaded', 'queued', 'processing', 'ready', 'partially_processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."export_format" AS ENUM('markdown', 'docx', 'pdf');--> statement-breakpoint
CREATE TYPE "public"."finding_resolution" AS ENUM('open', 'accepted', 'rejected', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'processing', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."review_severity" AS ENUM('critical', 'major', 'minor', 'suggestion');--> statement-breakpoint
CREATE TYPE "public"."agent_run_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('course_material', 'assignment_material', 'discussion', 'external');--> statement-breakpoint
CREATE TYPE "public"."workflow_status" AS ENUM('CREATED', 'INGESTING', 'READY', 'PLANNING', 'RESEARCHING', 'DRAFTING', 'REVIEWING', 'REVISING', 'FINAL_REVIEW', 'READY_FOR_STUDENT_APPROVAL', 'APPROVED', 'NEEDS_INFORMATION', 'PAUSED', 'FAILED', 'CANCELLED', 'MAX_ITERATIONS_REACHED');--> statement-breakpoint
CREATE TABLE "agent_run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"agent" "agent_name" NOT NULL,
	"status" "agent_run_status" DEFAULT 'queued' NOT NULL,
	"workflow_state" "workflow_status" NOT NULL,
	"iteration" integer DEFAULT 0 NOT NULL,
	"provider" varchar(80),
	"model" varchar(160),
	"input_snapshot" jsonb NOT NULL,
	"output" jsonb,
	"error_code" varchar(100),
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"format" "export_format" NOT NULL,
	"storage_path" text,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"error_message" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"course_id" uuid,
	"assignment_id" uuid,
	"run_id" uuid,
	"agent" "agent_name" NOT NULL,
	"provider" varchar(80) NOT NULL,
	"model" varchar(160) NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost_usd" numeric(12, 6),
	"latency_ms" integer,
	"status" varchar(60) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"prompt" text NOT NULL,
	"requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"word_limit" integer,
	"required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" varchar(280) NOT NULL,
	"brief_markdown" text DEFAULT '' NOT NULL,
	"status" "workflow_status" DEFAULT 'CREATED' NOT NULL,
	"due_at" timestamp with time zone,
	"external_research_allowed" boolean DEFAULT false NOT NULL,
	"max_iterations" integer DEFAULT 5 NOT NULL,
	"current_iteration" integer DEFAULT 0 NOT NULL,
	"budget_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignments_iteration_limit_check" CHECK ("assignments"."max_iterations" between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "rubric_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"title" varchar(240) NOT NULL,
	"description" text NOT NULL,
	"weight" real,
	"minimum_threshold" real,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "course_member_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"code" varchar(48),
	"title" varchar(240) NOT NULL,
	"description" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" varchar(160),
	"avatar_url" text,
	"timezone" varchar(80) DEFAULT 'UTC' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "answer_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" uuid NOT NULL,
	"research_finding_id" uuid,
	"source_type" "source_type" NOT NULL,
	"source_id" text NOT NULL,
	"claim_text" text NOT NULL,
	"locator" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"markdown" text DEFAULT '' NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"created_by_agent" "agent_name",
	"source_run_id" uuid,
	"is_approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"markdown" text DEFAULT '' NOT NULL,
	"confidence_score" integer NOT NULL,
	"confidence_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_answers_confidence_check" CHECK ("draft_answers"."confidence_score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "research_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"question_id" uuid,
	"run_id" uuid,
	"owner_id" uuid NOT NULL,
	"claim" text NOT NULL,
	"evidence" text NOT NULL,
	"source_type" "source_type" NOT NULL,
	"source_id" text NOT NULL,
	"citation_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"relevance_score" real NOT NULL,
	"limitations" text,
	"conflicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"assignment_id" uuid,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"token_count" integer,
	"page_start" integer,
	"page_end" integer,
	"section_title" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector(768),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"assignment_id" uuid,
	"original_filename" varchar(500) NOT NULL,
	"mime_type" varchar(160) NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_path" text NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"status" "document_status" DEFAULT 'uploaded' NOT NULL,
	"extracted_text" text,
	"extraction_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"course_id" uuid,
	"assignment_id" uuid,
	"document_id" uuid,
	"type" varchar(80) NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" varchar(160),
	"last_error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"rubric_criterion_id" uuid,
	"answer_id" uuid,
	"severity" "review_severity" NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"title" varchar(240) NOT NULL,
	"explanation" text NOT NULL,
	"location" text,
	"evidence" text,
	"recommended_correction" text NOT NULL,
	"resolution" "finding_resolution" DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"run_id" uuid,
	"owner_id" uuid NOT NULL,
	"overall_status" varchar(80) NOT NULL,
	"estimated_score" real,
	"requires_another_cycle" boolean NOT NULL,
	"unresolved_concerns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quality_gate_results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revision_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"from_draft_id" uuid,
	"to_draft_id" uuid NOT NULL,
	"report_id" uuid,
	"owner_id" uuid NOT NULL,
	"iteration" integer NOT NULL,
	"change_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_run_events" ADD CONSTRAINT "agent_run_events_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_records" ADD CONSTRAINT "export_records_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_records" ADD CONSTRAINT "export_records_draft_id_assignment_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."assignment_drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_questions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_members" ADD CONSTRAINT "course_members_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_citations" ADD CONSTRAINT "answer_citations_answer_id_draft_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."draft_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_citations" ADD CONSTRAINT "answer_citations_research_finding_id_research_findings_id_fk" FOREIGN KEY ("research_finding_id") REFERENCES "public"."research_findings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_drafts" ADD CONSTRAINT "assignment_drafts_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_drafts" ADD CONSTRAINT "assignment_drafts_source_run_id_agent_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_answers" ADD CONSTRAINT "draft_answers_draft_id_assignment_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."assignment_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_answers" ADD CONSTRAINT "draft_answers_question_id_assignment_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."assignment_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_findings" ADD CONSTRAINT "research_findings_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_findings" ADD CONSTRAINT "research_findings_question_id_assignment_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."assignment_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_findings" ADD CONSTRAINT "research_findings_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_findings" ADD CONSTRAINT "review_findings_report_id_review_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."review_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_findings" ADD CONSTRAINT "review_findings_rubric_criterion_id_rubric_criteria_id_fk" FOREIGN KEY ("rubric_criterion_id") REFERENCES "public"."rubric_criteria"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_findings" ADD CONSTRAINT "review_findings_answer_id_draft_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."draft_answers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_draft_id_assignment_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."assignment_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_history" ADD CONSTRAINT "revision_history_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_history" ADD CONSTRAINT "revision_history_from_draft_id_assignment_drafts_id_fk" FOREIGN KEY ("from_draft_id") REFERENCES "public"."assignment_drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_history" ADD CONSTRAINT "revision_history_to_draft_id_assignment_drafts_id_fk" FOREIGN KEY ("to_draft_id") REFERENCES "public"."assignment_drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_history" ADD CONSTRAINT "revision_history_report_id_review_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."review_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_run_events_run_idx" ON "agent_run_events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_assignment_idx" ON "agent_runs" USING btree ("assignment_id","created_at");--> statement-breakpoint
CREATE INDEX "export_records_assignment_idx" ON "export_records" USING btree ("assignment_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_records_owner_created_idx" ON "usage_records" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_questions_position_uidx" ON "assignment_questions" USING btree ("assignment_id","position");--> statement-breakpoint
CREATE INDEX "assignments_course_idx" ON "assignments" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "assignments_owner_status_idx" ON "assignments" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "rubric_criteria_assignment_idx" ON "rubric_criteria" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_members_course_user_uidx" ON "course_members" USING btree ("course_id","user_id");--> statement-breakpoint
CREATE INDEX "course_members_user_idx" ON "course_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "courses_owner_idx" ON "courses" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "answer_citations_answer_idx" ON "answer_citations" USING btree ("answer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_drafts_version_uidx" ON "assignment_drafts" USING btree ("assignment_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_answers_draft_question_uidx" ON "draft_answers" USING btree ("draft_id","question_id");--> statement-breakpoint
CREATE INDEX "research_findings_assignment_idx" ON "research_findings" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_chunks_document_index_uidx" ON "document_chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "document_chunks_course_idx" ON "document_chunks" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "document_chunks_embedding_hnsw_idx" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
CREATE INDEX "documents_course_status_idx" ON "documents" USING btree ("course_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_owner_hash_uidx" ON "documents" USING btree ("owner_id","sha256");--> statement-breakpoint
CREATE INDEX "processing_jobs_claim_idx" ON "processing_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "processing_jobs_owner_idx" ON "processing_jobs" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "review_findings_report_idx" ON "review_findings" USING btree ("report_id","severity");--> statement-breakpoint
CREATE INDEX "review_reports_assignment_idx" ON "review_reports" USING btree ("assignment_id","created_at");--> statement-breakpoint
CREATE INDEX "revision_history_assignment_idx" ON "revision_history" USING btree ("assignment_id","iteration");
