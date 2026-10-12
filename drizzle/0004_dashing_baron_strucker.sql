CREATE TABLE "rate_limit_counters" (
	"actor_key" varchar(96) NOT NULL,
	"scope" varchar(80) NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limit_counters_pk" PRIMARY KEY("actor_key","scope","window_start")
);
--> statement-breakpoint
CREATE INDEX "rate_limit_counters_expiry_idx" ON "rate_limit_counters" USING btree ("expires_at");
--> statement-breakpoint
ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.rate_limit_counters FROM anon, authenticated;
--> statement-breakpoint
COMMENT ON TABLE public.rate_limit_counters IS 'Server-only atomic request counters; actor keys are one-way hashes.';
