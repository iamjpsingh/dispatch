ALTER TABLE "suppression_list" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "sender_company_name" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "postal_address" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "postal_address_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "suppression_list" ADD COLUMN "email_hash" text;--> statement-breakpoint
ALTER TABLE "suppression_list" ADD CONSTRAINT "uq_suppress_user_hash" UNIQUE("user_id","email_hash");