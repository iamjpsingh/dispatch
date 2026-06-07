CREATE TABLE "campaign_analytics" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"user_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"campaign_name" text DEFAULT '' NOT NULL,
	"total_sent" integer DEFAULT 0 NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"opened" integer DEFAULT 0 NOT NULL,
	"clicked" integer DEFAULT 0 NOT NULL,
	"bounced" integer DEFAULT 0 NOT NULL,
	"unsubscribed" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_ca_user_campaign" UNIQUE("user_id","campaign_id")
);
--> statement-breakpoint
CREATE TABLE "engagement_events" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"user_id" text NOT NULL,
	"campaign_id" text,
	"event_type" text NOT NULL,
	"points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_analytics" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"user_id" text NOT NULL,
	"campaign_id" text,
	"event_type" text NOT NULL,
	"recipient_email" text,
	"user_agent" text,
	"client_name" text,
	"device_type" text DEFAULT 'unknown',
	"geo_country" text,
	"geo_city" text,
	"event_hour" integer,
	"event_day" integer,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "failover_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"from_config_id" text NOT NULL,
	"to_config_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "link_analytics" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"user_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"url" text NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"unique_clicks" integer DEFAULT 0 NOT NULL,
	"first_clicked_at" timestamp with time zone,
	"last_clicked_at" timestamp with time zone,
	CONSTRAINT "uq_la_user_campaign_url" UNIQUE("user_id","campaign_id","url")
);
--> statement-breakpoint
CREATE TABLE "provider_stats" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"config_id" text NOT NULL,
	"provider_type" text NOT NULL,
	"config_name" text DEFAULT '' NOT NULL,
	"date" text NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"bounce_count" integer DEFAULT 0 NOT NULL,
	"avg_send_time_ms" real DEFAULT 0 NOT NULL,
	"daily_limit" integer DEFAULT 500 NOT NULL,
	"cost_per_email" real DEFAULT 0 NOT NULL,
	"is_healthy" integer DEFAULT 1 NOT NULL,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_ps_user_config_date" UNIQUE("user_id","config_id","date")
);
--> statement-breakpoint
CREATE TABLE "routing_config" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"weights_json" text DEFAULT '{}' NOT NULL,
	"failover_enabled" integer DEFAULT 1 NOT NULL,
	"min_success_rate" real DEFAULT 0.8 NOT NULL,
	"max_avg_send_time_ms" integer DEFAULT 30000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routing_config_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "sending_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"domain" text NOT NULL,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"dkim_selector" text,
	"dkim_record" text,
	"spf_included" integer DEFAULT 0 NOT NULL,
	"return_path" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_sd_org_domain" UNIQUE("org_id","domain")
);
--> statement-breakpoint
CREATE TABLE "sending_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"domain_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"is_default" integer DEFAULT 0 NOT NULL,
	"assigned_to" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_se_org_email" UNIQUE("org_id","email")
);
--> statement-breakpoint
CREATE TABLE "warmup_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"day" integer NOT NULL,
	"date" text NOT NULL,
	"target" integer NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"bounce_rate" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warmup_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"config_id" text NOT NULL,
	"config_name" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"schedule_json" text NOT NULL,
	"current_day" integer DEFAULT 1 NOT NULL,
	"total_days" integer NOT NULL,
	"emails_sent_today" integer DEFAULT 0 NOT NULL,
	"daily_target" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_analytics" ADD CONSTRAINT "campaign_analytics_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_analytics" ADD CONSTRAINT "event_analytics_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_analytics" ADD CONSTRAINT "link_analytics_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sending_domains" ADD CONSTRAINT "sending_domains_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sending_emails" ADD CONSTRAINT "sending_emails_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sending_emails" ADD CONSTRAINT "sending_emails_domain_id_sending_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."sending_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warmup_logs" ADD CONSTRAINT "warmup_logs_plan_id_warmup_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."warmup_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ca_org" ON "campaign_analytics" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_ee_contact" ON "engagement_events" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_ee_user" ON "engagement_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_ea_org" ON "event_analytics" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_ea_user_campaign" ON "event_analytics" USING btree ("user_id","campaign_id");--> statement-breakpoint
CREATE INDEX "idx_ea_type" ON "event_analytics" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_fl_user" ON "failover_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_la_org" ON "link_analytics" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_sd_org" ON "sending_domains" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_se_org" ON "sending_emails" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_se_domain" ON "sending_emails" USING btree ("domain_id");--> statement-breakpoint
CREATE INDEX "idx_se_assigned" ON "sending_emails" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "idx_wl_plan" ON "warmup_logs" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "idx_wp_user" ON "warmup_plans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_wp_config" ON "warmup_plans" USING btree ("config_id");