CREATE TABLE "contact_lists" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"contact_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"list_id" text NOT NULL,
	"email" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"company" text,
	"phone" text,
	"tags" text DEFAULT '[]' NOT NULL,
	"custom_fields" text DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"engagement_score" integer DEFAULT 50 NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_contacts_list_email" UNIQUE("list_id","email")
);
--> statement-breakpoint
CREATE TABLE "import_history" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"list_id" text NOT NULL,
	"filename" text NOT NULL,
	"format" text NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"imported" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"invalid" integer DEFAULT 0 NOT NULL,
	"field_mapping" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segment_contacts" (
	"segment_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "segment_contacts_segment_id_contact_id_pk" PRIMARY KEY("segment_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'dynamic' NOT NULL,
	"rules_json" text,
	"contact_count" integer DEFAULT 0 NOT NULL,
	"last_calculated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_lists" ADD CONSTRAINT "contact_lists_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_lists" ADD CONSTRAINT "contact_lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_list_id_contact_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."contact_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_history" ADD CONSTRAINT "import_history_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_history" ADD CONSTRAINT "import_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_contacts" ADD CONSTRAINT "segment_contacts_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cl_org" ON "contact_lists" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_cl_user" ON "contact_lists" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_c_org" ON "contacts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_c_user" ON "contacts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_c_list" ON "contacts" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "idx_c_email" ON "contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_c_status" ON "contacts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_c_score" ON "contacts" USING btree ("engagement_score");--> statement-breakpoint
CREATE INDEX "idx_ih_org" ON "import_history" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_ih_user" ON "import_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sc_segment" ON "segment_contacts" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "idx_sc_contact" ON "segment_contacts" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_seg_org" ON "segments" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_seg_user" ON "segments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_seg_type" ON "segments" USING btree ("type");