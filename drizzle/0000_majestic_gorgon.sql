CREATE TABLE "agent_citations" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"user_id" text NOT NULL,
	"source_system" text NOT NULL,
	"entity_id" text NOT NULL,
	"version_or_snapshot" text NOT NULL,
	"clause_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"structured_output" jsonb,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analogue_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"normative_document_id" text NOT NULL,
	"clause_id" text NOT NULL,
	"equipment_types" jsonb NOT NULL,
	"allowed_standard_pairs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_material_pairs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dimension_tolerances" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rule_text" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"actor_display_name" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"outcome" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retention_until" timestamp with time zone NOT NULL,
	"request_id" text
);
--> statement-breakpoint
CREATE TABLE "dictionaries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"dictionary_type" text NOT NULL,
	"key" text NOT NULL,
	"values" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_states" (
	"user_id" text NOT NULL,
	"system" text NOT NULL,
	"state" text NOT NULL,
	"delay_ms" integer DEFAULT 0 NOT NULL,
	"snapshot_at" timestamp with time zone,
	"last_synchronized_at" timestamp with time zone,
	"safe_message" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "integration_states_user_id_system_pk" PRIMARY KEY("user_id","system")
);
--> statement-breakpoint
CREATE TABLE "normative_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"normative_document_id" text NOT NULL,
	"clause_id" text NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"language" text NOT NULL,
	"equipment_types" jsonb NOT NULL,
	"applicability" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allowed_deviations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"access_attributes" jsonb NOT NULL,
	"is_synthetic_demo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "normative_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"document_id" text NOT NULL,
	"title" text NOT NULL,
	"document_version" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"access_attributes" jsonb NOT NULL,
	"is_synthetic_demo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position_analysis_results" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"user_id" text NOT NULL,
	"position_id" text NOT NULL,
	"responsibility" text NOT NULL,
	"responsibility_confidence" numeric(5, 4) NOT NULL,
	"responsibility_citation" jsonb NOT NULL,
	"match_category" text NOT NULL,
	"match_score" integer NOT NULL,
	"matched_material_code" text,
	"status" text NOT NULL,
	"requires_human_review" boolean NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"prompt_version" text NOT NULL,
	"content" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"checksum" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "responsibility_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"normative_document_id" text NOT NULL,
	"clause_id" text NOT NULL,
	"equipment_types" jsonb NOT NULL,
	"responsibility" text NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rule_text" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sap_materials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"material_code" text NOT NULL,
	"name_ru" text NOT NULL,
	"name_en" text,
	"synonyms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"legacy_code" text,
	"equipment_type" text NOT NULL,
	"standard" text,
	"material_grade" text,
	"dimensions" jsonb NOT NULL,
	"tolerances" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"unit" text NOT NULL,
	"card_url" text NOT NULL,
	"source_position_id" text,
	"fixture_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_synthetic_demo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sap_stock_balances" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"material_id" text NOT NULL,
	"plant" text NOT NULL,
	"storage_location" text NOT NULL,
	"batch" text,
	"available_quantity" numeric(18, 3) NOT NULL,
	"unit" text NOT NULL,
	"snapshot_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_run_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"label" text NOT NULL,
	"outcome" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"scenario_id" text NOT NULL,
	"specification_id" text NOT NULL,
	"retry_of_run_id" text,
	"status" text NOT NULL,
	"current_step" text NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"mode" text DEFAULT 'NORMAL' NOT NULL,
	"seed" text DEFAULT 'base' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"input_snapshot" jsonb NOT NULL,
	"output_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "specification_positions" (
	"id" text PRIMARY KEY NOT NULL,
	"specification_id" text NOT NULL,
	"version_id" text NOT NULL,
	"user_id" text NOT NULL,
	"internal_code" text NOT NULL,
	"name_ru" text NOT NULL,
	"name_en" text,
	"synonyms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"equipment_type" text NOT NULL,
	"standard" text,
	"material_grade" text,
	"dimensions" jsonb NOT NULL,
	"required_quantity" numeric(18, 3) NOT NULL,
	"unit" text NOT NULL,
	"classification" jsonb NOT NULL,
	"access_attributes" jsonb NOT NULL,
	"fixture_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_synthetic_demo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "specification_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"specification_id" text NOT NULL,
	"user_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"position_count" integer NOT NULL,
	"historic_snapshot" jsonb,
	"access_attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "specifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_code" text NOT NULL,
	"name" text NOT NULL,
	"latest_version_id" text NOT NULL,
	"latest_version_number" integer NOT NULL,
	"position_count" integer NOT NULL,
	"access_attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploaded_files" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"original_name" text NOT NULL,
	"safe_name" text NOT NULL,
	"extension" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum_sha256" text NOT NULL,
	"storage_url" text NOT NULL,
	"parse_status" text NOT NULL,
	"normalized_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"roles" jsonb NOT NULL,
	"locale" text DEFAULT 'ru-RU' NOT NULL,
	"is_synthetic_demo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "users_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "agent_citations" ADD CONSTRAINT "agent_citations_message_id_agent_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."agent_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_citations" ADD CONSTRAINT "agent_citations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_thread_id_agent_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."agent_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_threads" ADD CONSTRAINT "agent_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analogue_rules" ADD CONSTRAINT "analogue_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analogue_rules" ADD CONSTRAINT "analogue_rules_normative_document_id_normative_documents_id_fk" FOREIGN KEY ("normative_document_id") REFERENCES "public"."normative_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictionaries" ADD CONSTRAINT "dictionaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_states" ADD CONSTRAINT "integration_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normative_chunks" ADD CONSTRAINT "normative_chunks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normative_chunks" ADD CONSTRAINT "normative_chunks_normative_document_id_normative_documents_id_fk" FOREIGN KEY ("normative_document_id") REFERENCES "public"."normative_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normative_documents" ADD CONSTRAINT "normative_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_analysis_results" ADD CONSTRAINT "position_analysis_results_run_id_scenario_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scenario_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_analysis_results" ADD CONSTRAINT "position_analysis_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_analysis_results" ADD CONSTRAINT "position_analysis_results_position_id_specification_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."specification_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responsibility_rules" ADD CONSTRAINT "responsibility_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responsibility_rules" ADD CONSTRAINT "responsibility_rules_normative_document_id_normative_documents_id_fk" FOREIGN KEY ("normative_document_id") REFERENCES "public"."normative_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sap_materials" ADD CONSTRAINT "sap_materials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sap_stock_balances" ADD CONSTRAINT "sap_stock_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sap_stock_balances" ADD CONSTRAINT "sap_stock_balances_material_id_sap_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."sap_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_run_steps" ADD CONSTRAINT "scenario_run_steps_run_id_scenario_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scenario_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_run_steps" ADD CONSTRAINT "scenario_run_steps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD CONSTRAINT "scenario_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD CONSTRAINT "scenario_runs_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD CONSTRAINT "scenario_runs_specification_id_specifications_id_fk" FOREIGN KEY ("specification_id") REFERENCES "public"."specifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_positions" ADD CONSTRAINT "specification_positions_specification_id_specifications_id_fk" FOREIGN KEY ("specification_id") REFERENCES "public"."specifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_positions" ADD CONSTRAINT "specification_positions_version_id_specification_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."specification_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_positions" ADD CONSTRAINT "specification_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_versions" ADD CONSTRAINT "specification_versions_specification_id_specifications_id_fk" FOREIGN KEY ("specification_id") REFERENCES "public"."specifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_versions" ADD CONSTRAINT "specification_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specifications" ADD CONSTRAINT "specifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploaded_files" ADD CONSTRAINT "uploaded_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_citations_user_message_idx" ON "agent_citations" USING btree ("user_id","message_id");--> statement-breakpoint
CREATE INDEX "agent_messages_user_thread_idx" ON "agent_messages" USING btree ("user_id","thread_id");--> statement-breakpoint
CREATE INDEX "agent_threads_user_idx" ON "agent_threads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "analogue_rules_user_idx" ON "analogue_rules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_user_occurred_idx" ON "audit_logs" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dictionary_key_uq" ON "dictionaries" USING btree ("user_id","dictionary_type","key");--> statement-breakpoint
CREATE INDEX "normative_chunks_user_doc_idx" ON "normative_chunks" USING btree ("user_id","normative_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "normative_document_uq" ON "normative_documents" USING btree ("user_id","document_id","document_version");--> statement-breakpoint
CREATE UNIQUE INDEX "position_result_run_position_uq" ON "position_analysis_results" USING btree ("run_id","position_id");--> statement-breakpoint
CREATE INDEX "position_result_user_run_idx" ON "position_analysis_results" USING btree ("user_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_version_uq" ON "prompt_versions" USING btree ("user_id","name","prompt_version");--> statement-breakpoint
CREATE INDEX "responsibility_rules_user_idx" ON "responsibility_rules" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sap_material_code_uq" ON "sap_materials" USING btree ("user_id","material_code");--> statement-breakpoint
CREATE INDEX "sap_material_type_idx" ON "sap_materials" USING btree ("user_id","equipment_type");--> statement-breakpoint
CREATE INDEX "sap_stock_material_idx" ON "sap_stock_balances" USING btree ("user_id","material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_step_idempotency_uq" ON "scenario_run_steps" USING btree ("run_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "scenario_steps_user_run_idx" ON "scenario_run_steps" USING btree ("user_id","run_id");--> statement-breakpoint
CREATE INDEX "scenario_runs_user_created_idx" ON "scenario_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "scenario_runs_status_idx" ON "scenario_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scenarios_user_idx" ON "scenarios" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "positions_user_spec_idx" ON "specification_positions" USING btree ("user_id","specification_id");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_internal_code_uq" ON "specification_positions" USING btree ("user_id","internal_code");--> statement-breakpoint
CREATE UNIQUE INDEX "spec_versions_number_uq" ON "specification_versions" USING btree ("specification_id","version_number");--> statement-breakpoint
CREATE INDEX "spec_versions_user_idx" ON "specification_versions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "specifications_user_idx" ON "specifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "uploaded_files_user_idx" ON "uploaded_files" USING btree ("user_id");