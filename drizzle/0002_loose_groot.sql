ALTER TABLE "review_findings" ADD COLUMN "decision_note" text;--> statement-breakpoint
ALTER TABLE "review_findings" ADD COLUMN "decided_by" uuid;--> statement-breakpoint
ALTER TABLE "review_findings" ADD COLUMN "decided_at" timestamp with time zone;