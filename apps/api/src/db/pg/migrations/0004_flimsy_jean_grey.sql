CREATE TABLE "automation_enrollments" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"current_step_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now(),
	"next_action_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"exit_reason" text,
	"waiting_for_event" text,
	"wait_true_step_id" text,
	CONSTRAINT "uq_enroll_automation_contact" UNIQUE("automation_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "automation_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"step_order" integer NOT NULL,
	"step_type" text NOT NULL,
	"config_json" text DEFAULT '{}' NOT NULL,
	"next_step_id" text,
	"true_step_id" text,
	"false_step_id" text
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger_type" text NOT NULL,
	"trigger_config" text DEFAULT '{}' NOT NULL,
	"entry_list_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"enrolled_count" integer DEFAULT 0 NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"flow_json" text DEFAULT '{"nodes":[],"edges":[]}' NOT NULL,
	"goal_condition" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_enrollments" ADD CONSTRAINT "automation_enrollments_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_steps" ADD CONSTRAINT "automation_steps_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ae_automation" ON "automation_enrollments" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "idx_ae_next" ON "automation_enrollments" USING btree ("next_action_at");--> statement-breakpoint
CREATE INDEX "idx_ae_contact" ON "automation_enrollments" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_as_automation" ON "automation_steps" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "idx_auto_org" ON "automations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_auto_user" ON "automations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_auto_status" ON "automations" USING btree ("status");