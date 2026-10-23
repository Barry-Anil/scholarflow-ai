CREATE TABLE "study_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"token_count" integer,
	"page_start" integer,
	"page_end" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector(768),
	"embedding_model" varchar(160),
	"embedded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"original_filename" varchar(500) NOT NULL,
	"mime_type" varchar(160) NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_path" text NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'uploaded' NOT NULL,
	"extracted_text" text,
	"extraction_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_explanations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"mode" varchar(32) NOT NULL,
	"content" jsonb NOT NULL,
	"references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" varchar(40) NOT NULL,
	"model" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"role" varchar(16) NOT NULL,
	"content" text NOT NULL,
	"support_level" varchar(24),
	"references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"last_viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" varchar(300) NOT NULL,
	"content" text NOT NULL,
	"page_start" integer,
	"page_end" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" varchar(240) NOT NULL,
	"status" varchar(32) DEFAULT 'processing' NOT NULL,
	"current_section_id" uuid,
	"preferred_tts_provider" varchar(24) DEFAULT 'browser' NOT NULL,
	"preferred_voice_id" varchar(160),
	"playback_rate" numeric(3, 2) DEFAULT '1.00' NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "study_chunks" ADD CONSTRAINT "study_chunks_session_id_study_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."study_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_chunks" ADD CONSTRAINT "study_chunks_document_id_study_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."study_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_chunks" ADD CONSTRAINT "study_chunks_section_id_study_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."study_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_documents" ADD CONSTRAINT "study_documents_session_id_study_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."study_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_explanations" ADD CONSTRAINT "study_explanations_session_id_study_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."study_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_explanations" ADD CONSTRAINT "study_explanations_section_id_study_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."study_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_messages" ADD CONSTRAINT "study_messages_session_id_study_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."study_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_progress" ADD CONSTRAINT "study_progress_session_id_study_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."study_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_progress" ADD CONSTRAINT "study_progress_section_id_study_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."study_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sections" ADD CONSTRAINT "study_sections_session_id_study_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."study_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sections" ADD CONSTRAINT "study_sections_document_id_study_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."study_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "study_chunks_document_index_uidx" ON "study_chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "study_chunks_owner_session_idx" ON "study_chunks" USING btree ("owner_id","session_id");--> statement-breakpoint
CREATE INDEX "study_chunks_embedding_hnsw_idx" ON "study_chunks" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
CREATE UNIQUE INDEX "study_documents_session_uidx" ON "study_documents" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "study_documents_owner_hash_uidx" ON "study_documents" USING btree ("owner_id","sha256");--> statement-breakpoint
CREATE INDEX "study_documents_owner_status_idx" ON "study_documents" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "study_explanations_owner_section_idx" ON "study_explanations" USING btree ("owner_id","section_id","created_at");--> statement-breakpoint
CREATE INDEX "study_messages_owner_session_created_idx" ON "study_messages" USING btree ("owner_id","session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "study_progress_session_section_uidx" ON "study_progress" USING btree ("session_id","section_id");--> statement-breakpoint
CREATE INDEX "study_progress_owner_session_idx" ON "study_progress" USING btree ("owner_id","session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "study_sections_session_position_uidx" ON "study_sections" USING btree ("session_id","position");--> statement-breakpoint
CREATE INDEX "study_sections_owner_session_idx" ON "study_sections" USING btree ("owner_id","session_id");--> statement-breakpoint
CREATE INDEX "study_sessions_owner_activity_idx" ON "study_sessions" USING btree ("owner_id","last_activity_at");
--> statement-breakpoint
ALTER TABLE public.study_sessions ADD CONSTRAINT study_sessions_owner_id_auth_users_fk
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.study_documents ADD CONSTRAINT study_documents_owner_id_auth_users_fk
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.study_sections ADD CONSTRAINT study_sections_owner_id_auth_users_fk
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.study_chunks ADD CONSTRAINT study_chunks_owner_id_auth_users_fk
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.study_messages ADD CONSTRAINT study_messages_owner_id_auth_users_fk
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.study_explanations ADD CONSTRAINT study_explanations_owner_id_auth_users_fk
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.study_progress ADD CONSTRAINT study_progress_owner_id_auth_users_fk
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE TRIGGER study_sessions_set_updated_at BEFORE UPDATE ON public.study_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER study_documents_set_updated_at BEFORE UPDATE ON public.study_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER study_progress_set_updated_at BEFORE UPDATE ON public.study_progress
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
ALTER TABLE public.study_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_explanations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_progress ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY study_sessions_own_all ON public.study_sessions FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY study_documents_own_all ON public.study_documents FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY study_sections_own_all ON public.study_sections FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY study_chunks_own_all ON public.study_chunks FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY study_messages_own_all ON public.study_messages FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY study_explanations_own_all ON public.study_explanations FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY study_progress_own_all ON public.study_progress FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.study_sessions,
  public.study_documents,
  public.study_sections,
  public.study_chunks,
  public.study_messages,
  public.study_explanations,
  public.study_progress
TO authenticated;
--> statement-breakpoint
CREATE INDEX study_chunks_content_fts_idx
  ON public.study_chunks
  USING gin (to_tsvector('english', content));
--> statement-breakpoint
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'study-notes',
  'study-notes',
  false,
  26214400,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
--> statement-breakpoint
CREATE POLICY study_notes_owner_read ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'study-notes'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
CREATE POLICY study_notes_owner_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'study-notes'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
CREATE POLICY study_notes_owner_update ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'study-notes'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  ) WITH CHECK (
    bucket_id = 'study-notes'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
CREATE POLICY study_notes_owner_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'study-notes'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
