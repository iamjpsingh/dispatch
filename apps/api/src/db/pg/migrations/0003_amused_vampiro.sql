CREATE TABLE "dead_letters" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"recipient_email" text NOT NULL,
	"recipient_name" text,
	"error_message" text,
	"error_code" text,
	"error_type" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"preference" text DEFAULT 'subscribed' NOT NULL,
	"pause_until" timestamp with time zone,
	"reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_pref_org_email" UNIQUE("org_id","email")
);
--> statement-breakpoint
CREATE TABLE "frequency_config" (
	"org_id" text PRIMARY KEY NOT NULL,
	"max_per_window" integer DEFAULT 5 NOT NULL,
	"window_hours" integer DEFAULT 168 NOT NULL,
	"enabled" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frequency_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "frequency_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"campaign_id" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graymail_config" (
	"org_id" text PRIMARY KEY NOT NULL,
	"enabled" integer DEFAULT 0 NOT NULL,
	"threshold" integer DEFAULT 11 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graymail_tracker" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "graymail_tracker_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"sends_since_engagement" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone,
	"last_engaged_at" timestamp with time zone,
	"is_graymail" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "uq_graymail_org_email" UNIQUE("org_id","email")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text,
	"org_id" text,
	"user_id" text NOT NULL,
	"type" text DEFAULT 'batch' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"config_id" text,
	"config_json" text NOT NULL,
	"contacts_json" text NOT NULL,
	"html_content" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"from_email" text DEFAULT '' NOT NULL,
	"from_name" text DEFAULT '' NOT NULL,
	"config_name" text,
	"notify_email" text,
	"total_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"last_processed_index" integer DEFAULT 0 NOT NULL,
	"batch_size" integer DEFAULT 20,
	"email_delay_sec" integer DEFAULT 45,
	"batch_delay_min" integer DEFAULT 60,
	"scheduled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"retry_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"email_job" text NOT NULL,
	"batch_config" text,
	"scheduled_time" timestamp with time zone NOT NULL,
	"notify_email" text,
	"notify_browser" integer DEFAULT 0,
	"status" text DEFAULT 'scheduled',
	"created_at" timestamp with time zone DEFAULT now(),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"contact_count" integer,
	"subject" text,
	"use_batch" integer DEFAULT 0,
	"config_name" text
);
--> statement-breakpoint
CREATE TABLE "suppression_list" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"reason" text NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_suppress_user_email" UNIQUE("user_id","email")
);
--> statement-breakpoint
ALTER TABLE "dead_letters" ADD CONSTRAINT "dead_letters_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frequency_config" ADD CONSTRAINT "frequency_config_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frequency_log" ADD CONSTRAINT "frequency_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graymail_config" ADD CONSTRAINT "graymail_config_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graymail_tracker" ADD CONSTRAINT "graymail_tracker_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression_list" ADD CONSTRAINT "suppression_list_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dl_job" ON "dead_letters" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_pref_org_email" ON "email_preferences" USING btree ("org_id","email");--> statement-breakpoint
CREATE INDEX "idx_pref_preference" ON "email_preferences" USING btree ("preference");--> statement-breakpoint
CREATE INDEX "idx_freqlog_org_email" ON "frequency_log" USING btree ("org_id","email");--> statement-breakpoint
CREATE INDEX "idx_jobs_status" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_jobs_user" ON "jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_jobs_priority" ON "jobs" USING btree ("priority","created_at");--> statement-breakpoint
CREATE INDEX "idx_jobs_scheduled" ON "jobs" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "idx_sched_user" ON "scheduled_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sched_time" ON "scheduled_jobs" USING btree ("scheduled_time");--> statement-breakpoint
CREATE INDEX "idx_suppress_user" ON "suppression_list" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_suppress_email" ON "suppression_list" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_suppress_org_email" ON "suppression_list" USING btree ("org_id","email");