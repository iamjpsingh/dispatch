CREATE TABLE "form_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"list_id" text NOT NULL,
	"field_mapping" text DEFAULT '{}' NOT NULL,
	"required_fields" text DEFAULT '["email"]' NOT NULL,
	"allowed_domains" text DEFAULT '[]' NOT NULL,
	"redirect_url" text,
	"actions" text DEFAULT '[]' NOT NULL,
	"double_optin" integer DEFAULT 0 NOT NULL,
	"success_message" text DEFAULT 'Thank you for subscribing!' NOT NULL,
	"submission_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"data" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "landing_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"template" text DEFAULT 'lead_capture' NOT NULL,
	"html_content" text DEFAULT '' NOT NULL,
	"css_content" text DEFAULT '' NOT NULL,
	"meta_description" text,
	"meta_image" text,
	"form_id" text,
	"tracking_enabled" integer DEFAULT 1 NOT NULL,
	"published" integer DEFAULT 0 NOT NULL,
	"visit_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_lp_org_slug" UNIQUE("org_id","slug")
);
--> statement-breakpoint
CREATE TABLE "plugins" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"description" text,
	"author" text,
	"type" text NOT NULL,
	"status" text DEFAULT 'installed' NOT NULL,
	"manifest_json" text NOT NULL,
	"settings_json" text DEFAULT '{}' NOT NULL,
	"entry_path" text,
	"error_message" text,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rss_feeds" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"check_interval" integer DEFAULT 60 NOT NULL,
	"template_id" text,
	"list_id" text,
	"last_checked_at" timestamp with time zone,
	"last_item_guid" text,
	"status" text DEFAULT 'active' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"webhook_id" text NOT NULL,
	"event_type" text NOT NULL,
	"status" text NOT NULL,
	"status_code" integer,
	"response_body" text,
	"error" text,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text DEFAULT '[]' NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"last_triggered_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"actor_id" text NOT NULL,
	"actor_email" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"description" text,
	"metadata" text DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"actor_id" text NOT NULL,
	"actor_email" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"changes" text,
	"ip_address" text,
	"user_agent" text,
	"metadata" text DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" text DEFAULT 'meta' NOT NULL,
	"phone_number_id" text NOT NULL,
	"business_account_id" text,
	"access_token" text NOT NULL,
	"phone_display" text,
	"webhook_verify_token" text,
	"status" text DEFAULT 'active' NOT NULL,
	"daily_limit" integer DEFAULT 1000 NOT NULL,
	"sent_today" integer DEFAULT 0 NOT NULL,
	"last_reset_date" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"config_id" text NOT NULL,
	"campaign_id" text,
	"contact_id" text,
	"phone_number" text NOT NULL,
	"template_id" text,
	"message_type" text DEFAULT 'template' NOT NULL,
	"content_json" text DEFAULT '{}' NOT NULL,
	"wamid" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"error_message" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"config_id" text NOT NULL,
	"meta_template_name" text NOT NULL,
	"meta_template_id" text,
	"language" text DEFAULT 'en' NOT NULL,
	"category" text DEFAULT 'MARKETING' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"components_json" text DEFAULT '[]' NOT NULL,
	"example_json" text,
	"body_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form_endpoints" ADD CONSTRAINT "form_endpoints_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_form_endpoints_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rss_feeds" ADD CONSTRAINT "rss_feeds_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_logs" ADD CONSTRAINT "webhook_logs_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_configs" ADD CONSTRAINT "whatsapp_configs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_config_id_whatsapp_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."whatsapp_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fe_org" ON "form_endpoints" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_fs_form" ON "form_submissions" USING btree ("form_id");--> statement-breakpoint
CREATE INDEX "idx_lp_org" ON "landing_pages" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_plugin_user" ON "plugins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_rss_org" ON "rss_feeds" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_whl_webhook" ON "webhook_logs" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "idx_wh_org" ON "webhooks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_wh_user" ON "webhooks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_activity_org" ON "activity_logs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_audit_org" ON "audit_logs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_audit_actor" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "idx_wac_org" ON "whatsapp_configs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_wam_org" ON "whatsapp_messages" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_wam_campaign" ON "whatsapp_messages" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_wat_org" ON "whatsapp_templates" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_wat_config" ON "whatsapp_templates" USING btree ("config_id");