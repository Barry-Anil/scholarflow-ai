CREATE TABLE "draft_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"review_report_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"attestation" text NOT NULL,
	"attestation_version" varchar(60) DEFAULT 'student-approval-v1' NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "export_records" ADD COLUMN "approval_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "export_records" ADD COLUMN "filename" varchar(500);--> statement-breakpoint
ALTER TABLE "export_records" ADD COLUMN "mime_type" varchar(160);--> statement-breakpoint
ALTER TABLE "export_records" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
ALTER TABLE "draft_approvals" ADD CONSTRAINT "draft_approvals_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_approvals" ADD CONSTRAINT "draft_approvals_draft_id_assignment_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."assignment_drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_approvals" ADD CONSTRAINT "draft_approvals_review_report_id_review_reports_id_fk" FOREIGN KEY ("review_report_id") REFERENCES "public"."review_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draft_approvals_draft_uidx" ON "draft_approvals" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "draft_approvals_assignment_idx" ON "draft_approvals" USING btree ("assignment_id","approved_at");--> statement-breakpoint
ALTER TABLE "export_records" ADD CONSTRAINT "export_records_approval_id_draft_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."draft_approvals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE public.draft_approvals ADD CONSTRAINT draft_approvals_owner_id_auth_users_fk
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE public.draft_approvals ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY draft_approvals_own_read ON public.draft_approvals FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY draft_approvals_own_insert ON public.draft_approvals FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));--> statement-breakpoint
GRANT SELECT, INSERT ON public.draft_approvals TO authenticated;--> statement-breakpoint
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'assignment-exports',
  'assignment-exports',
  false,
  52428800,
  ARRAY[
    'text/markdown',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;--> statement-breakpoint
CREATE POLICY assignment_exports_owner_read ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'assignment-exports'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );--> statement-breakpoint
CREATE POLICY assignment_exports_owner_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'assignment-exports'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );--> statement-breakpoint
CREATE POLICY assignment_exports_owner_update ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'assignment-exports'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  ) WITH CHECK (
    bucket_id = 'assignment-exports'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );--> statement-breakpoint
CREATE POLICY assignment_exports_owner_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'assignment-exports'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
