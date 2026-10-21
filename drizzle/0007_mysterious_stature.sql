CREATE TABLE "processing_job_diagnostics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"error_code" varchar(100) NOT NULL,
	"detail" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD COLUMN "last_error_code" varchar(100);--> statement-breakpoint
ALTER TABLE "processing_job_diagnostics" ADD CONSTRAINT "processing_job_diagnostics_job_id_processing_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."processing_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "processing_job_diagnostics_job_idx" ON "processing_job_diagnostics" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "processing_jobs_lease_idx" ON "processing_jobs" USING btree ("status","lease_expires_at");
--> statement-breakpoint
ALTER TABLE public.processing_job_diagnostics ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.processing_job_diagnostics FROM anon, authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS processing_jobs_course_write ON public.processing_jobs;
