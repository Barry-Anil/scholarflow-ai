CREATE TABLE "agent_worker_heartbeats" (
	"worker_id" varchar(160) PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"current_job_id" uuid,
	"stopped_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "agent_worker_heartbeats_last_idx" ON "agent_worker_heartbeats" USING btree ("last_heartbeat_at");--> statement-breakpoint
ALTER TABLE public.agent_worker_heartbeats ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.agent_worker_heartbeats FROM anon, authenticated;
