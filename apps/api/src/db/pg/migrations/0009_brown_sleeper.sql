CREATE TABLE "email_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"status" text NOT NULL,
	"message" text,
	"message_id" text,
	"first_name" text,
	"company" text,
	"subject" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_el_org_created" ON "email_logs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_el_status" ON "email_logs" USING btree ("status");