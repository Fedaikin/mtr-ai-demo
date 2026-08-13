ALTER TABLE "specification_versions" ADD COLUMN IF NOT EXISTS "source_file_id" text;
--> statement-breakpoint
ALTER TABLE "specification_versions" ADD COLUMN IF NOT EXISTS "source_file_name" text;
--> statement-breakpoint
ALTER TABLE "specification_versions" ADD COLUMN IF NOT EXISTS "source_kind" text;
--> statement-breakpoint
ALTER TABLE "specification_versions" ADD COLUMN IF NOT EXISTS "published_by" text;
--> statement-breakpoint
ALTER TABLE "specification_versions" ADD COLUMN IF NOT EXISTS "published_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "specification_versions" ADD COLUMN IF NOT EXISTS "validation_summary" jsonb;
--> statement-breakpoint
DROP INDEX IF EXISTS "positions_internal_code_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "positions_version_internal_code_uq"
  ON "specification_positions" ("user_id", "version_id", "internal_code");
--> statement-breakpoint
ALTER TABLE "catalog_stock_balances"
  DROP CONSTRAINT IF EXISTS "catalog_stock_available_quantity_integer_check";
--> statement-breakpoint
UPDATE "catalog_stock_balances" SET "available_quantity" = round(GREATEST("available_quantity", 0));
--> statement-breakpoint
ALTER TABLE "catalog_stock_balances"
  ADD CONSTRAINT "catalog_stock_available_quantity_integer_check"
  CHECK ("available_quantity" = trunc("available_quantity"));
--> statement-breakpoint
ALTER TABLE "sap_stock_balances"
  DROP CONSTRAINT IF EXISTS "sap_stock_available_quantity_nonnegative_integer_check";
--> statement-breakpoint
UPDATE "sap_stock_balances" SET "available_quantity" = round(GREATEST("available_quantity", 0));
--> statement-breakpoint
ALTER TABLE "sap_stock_balances"
  ADD CONSTRAINT "sap_stock_available_quantity_nonnegative_integer_check"
  CHECK ("available_quantity" >= 0 AND "available_quantity" = trunc("available_quantity"));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analysis_review_decisions" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "run_id" text NOT NULL REFERENCES "scenario_runs"("id"),
  "result_id" text NOT NULL REFERENCES "position_analysis_results"("id"),
  "position_id" text NOT NULL,
  "doublecheck_outcome" text NOT NULL,
  "status" text NOT NULL,
  "agent_evidence" jsonb NOT NULL,
  "independent_evidence" jsonb NOT NULL,
  "decision_reason" text,
  "decided_by" text,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text DEFAULT 'demo-user-001' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "analysis_review_run_position_uq" ON "analysis_review_decisions" ("user_id", "run_id", "position_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analysis_review_user_status_idx" ON "analysis_review_decisions" ("user_id", "status");
