CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "login" text DEFAULT 'demo' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text DEFAULT 'scrypt$16384$8$1$bXRyLWRlbW8tYXV0aC12MQ$GcR_B-AFou6BJpPfLHVa0afwkfnOh5_ehbSyTSL2TFn7UARDrszHNcwtC19lk40LVfg7sGA_roL4NX7hUkexBA' NOT NULL;--> statement-breakpoint
UPDATE "users" SET "display_name" = 'Демо-пользователь 1', "login" = 'demo' WHERE "id" = 'demo-user-001';--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_hash_uq" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_expiry_idx" ON "auth_sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_login_unique" UNIQUE("login");
