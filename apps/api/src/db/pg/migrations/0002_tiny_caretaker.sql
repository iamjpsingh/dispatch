CREATE TABLE "ab_variants" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"variant_label" text NOT NULL,
	"subject" text,
	"template_id" text,
	"sender_name" text,
	"sender_email" text,
	"percentage" integer NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"open_count" integer DEFAULT 0 NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"is_winner" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'one_time' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"template_id" text,
	"list_id" text,
	"segment_id" text,
	"subject" text NOT NULL,
	"from_name" text NOT NULL,
	"from_email" text NOT NULL,
	"reply_to" text,
	"tags" text DEFAULT '[]' NOT NULL,
	"folder" text,
	"draft_data" text,
	"ab_config" text,
	"rotation_config" text,
	"batch_size" integer DEFAULT 20 NOT NULL,
	"email_delay" integer DEFAULT 45 NOT NULL,
	"batch_delay" integer DEFAULT 60 NOT NULL,
	"total_recipients" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"open_count" integer DEFAULT 0 NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"bounce_count" integer DEFAULT 0 NOT NULL,
	"unsubscribe_count" integer DEFAULT 0 NOT NULL,
	"job_id" text,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"html_content" text NOT NULL,
	"thumbnail" text,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'general' NOT NULL,
	"subject" text,
	"html_content" text NOT NULL,
	"text_content" text,
	"variables" text DEFAULT '[]' NOT NULL,
	"mjml_source" text,
	"is_starter" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"parent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ab_variants" ADD CONSTRAINT "ab_variants_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_sections" ADD CONSTRAINT "template_sections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ab_campaign" ON "ab_variants" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_camp_org" ON "campaigns" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_camp_user" ON "campaigns" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_camp_status" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_camp_type" ON "campaigns" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_camp_scheduled" ON "campaigns" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "idx_ts_org" ON "template_sections" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_ts_category" ON "template_sections" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_tpl_org" ON "templates" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_tpl_user" ON "templates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_tpl_category" ON "templates" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_tpl_starter" ON "templates" USING btree ("is_starter");--> statement-breakpoint
CREATE INDEX "idx_tpl_parent" ON "templates" USING btree ("parent_id");