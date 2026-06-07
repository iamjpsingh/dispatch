ALTER TABLE "scheduled_jobs" ADD COLUMN "cron_pattern" text;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD COLUMN "is_repeating" integer DEFAULT 0 NOT NULL;