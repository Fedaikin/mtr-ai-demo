CREATE TABLE IF NOT EXISTS "business_project_deadlines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"business_project_id" text NOT NULL,
	"kind" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"days_from_scenario_today" integer NOT NULL,
	"status" text NOT NULL,
	"dataset_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "business_project_deadlines_kind_check" CHECK ("business_project_deadlines"."kind" in ('DESIGN_FREEZE','MATERIAL_NEED','START_UP')),
	CONSTRAINT "business_project_deadlines_status_check" CHECK ("business_project_deadlines"."status" in ('UPCOMING','AT_RISK','MET'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "business_project_positions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"access_project_id" text NOT NULL,
	"business_project_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"specification_link_id" text NOT NULL,
	"position_id" text NOT NULL,
	"catalog_item_id" text NOT NULL,
	"operational_material_view_id" text NOT NULL,
	"mapping_kind" text NOT NULL,
	"project_association_confidence_percent" integer NOT NULL,
	"equipment_type" text NOT NULL,
	"source_required_quantity" numeric(18, 3) NOT NULL,
	"source_unit" text NOT NULL,
	"required_quantity" numeric(18, 3) NOT NULL,
	"unit" text NOT NULL,
	"dataset_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "business_project_positions_mapping_kind_check" CHECK ("business_project_positions"."mapping_kind" in ('DIRECT_CATALOG_CODE','NORMALIZED_LEGACY')),
	CONSTRAINT "business_project_positions_confidence_check" CHECK ("business_project_positions"."project_association_confidence_percent" between 0 and 100),
	CONSTRAINT "business_project_positions_source_quantity_check" CHECK ("business_project_positions"."source_required_quantity" > 0),
	CONSTRAINT "business_project_positions_quantity_check" CHECK ("business_project_positions"."required_quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "business_project_specifications" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"access_project_id" text NOT NULL,
	"business_project_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"specification_id" text NOT NULL,
	"current_version_id" text NOT NULL,
	"source_project_code" text NOT NULL,
	"purpose" text NOT NULL,
	"name" text NOT NULL,
	"dataset_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "business_project_specifications_scope_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "business_project_specifications_purpose_check" CHECK ("business_project_specifications"."purpose" in ('CONSTRUCTION','MAINTENANCE','REPAIR','SPARES'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "business_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"access_project_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_project_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"phase" text NOT NULL,
	"need_date" timestamp with time zone NOT NULL,
	"dataset_version" text NOT NULL,
	"scenario_time_zone" text DEFAULT 'Europe/Moscow' NOT NULL,
	"is_synthetic_demo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "business_projects_scope_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "business_projects_status_check" CHECK ("business_projects"."status" in ('PLANNED','ACTIVE','ON_HOLD','COMPLETED')),
	CONSTRAINT "business_projects_phase_check" CHECK ("business_projects"."phase" in ('DESIGN','PROCUREMENT','CONSTRUCTION','COMMISSIONING','OPERATIONS')),
	CONSTRAINT "business_projects_aliases_json_check" CHECK (jsonb_typeof("business_projects"."aliases") = 'array'),
	CONSTRAINT "business_projects_external_codes_json_check" CHECK (jsonb_typeof("business_projects"."external_project_codes") = 'array'),
	CONSTRAINT "business_projects_timezone_check" CHECK ("business_projects"."scenario_time_zone" = 'Europe/Moscow')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "operational_material_views" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"access_project_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"catalog_scope_id" text NOT NULL,
	"source_scope_id" text NOT NULL,
	"catalog_item_id" text NOT NULL,
	"material_code" text NOT NULL,
	"source_kind" text NOT NULL,
	"equipment_type" text NOT NULL,
	"item_kind" text NOT NULL,
	"family_id" text,
	"unit" text NOT NULL,
	"pack_size" integer NOT NULL,
	"lead_time_days" integer NOT NULL,
	"safety_stock" integer NOT NULL,
	"stock" jsonb NOT NULL,
	"inbound_supplies" jsonb NOT NULL,
	"weekly_movements" jsonb NOT NULL,
	"reliability" jsonb NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"dataset_version" text NOT NULL,
	"is_synthetic_demo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "operational_material_views_scope_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "operational_material_views_source_kind_check" CHECK ("operational_material_views"."source_kind" in ('SAP_BASE','CATALOG_NORMALIZED')),
	CONSTRAINT "operational_material_views_item_kind_check" CHECK ("operational_material_views"."item_kind" in ('COMPONENT','ASSEMBLY')),
	CONSTRAINT "operational_material_views_pack_size_check" CHECK ("operational_material_views"."pack_size" > 0),
	CONSTRAINT "operational_material_views_lead_time_check" CHECK ("operational_material_views"."lead_time_days" > 0),
	CONSTRAINT "operational_material_views_safety_stock_check" CHECK ("operational_material_views"."safety_stock" >= 0),
	CONSTRAINT "operational_material_views_stock_json_check" CHECK (jsonb_typeof("operational_material_views"."stock") = 'object'),
	CONSTRAINT "operational_material_views_inbound_json_check" CHECK (jsonb_typeof("operational_material_views"."inbound_supplies") = 'array'),
	CONSTRAINT "operational_material_views_movements_json_check" CHECK (jsonb_typeof("operational_material_views"."weekly_movements") = 'array' and jsonb_array_length("operational_material_views"."weekly_movements") = 52),
	CONSTRAINT "operational_material_views_reliability_json_check" CHECK (jsonb_typeof("operational_material_views"."reliability") = 'object')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_material_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"access_project_id" text NOT NULL,
	"business_project_id" text NOT NULL,
	"operational_material_view_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"material_code" text NOT NULL,
	"quantity" numeric(18, 3) NOT NULL,
	"unit" text NOT NULL,
	"allocation_version" text NOT NULL,
	"dataset_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "project_material_allocations_quantity_check" CHECK ("project_material_allocations"."quantity" > 0),
	CONSTRAINT "project_material_allocations_version_check" CHECK ("project_material_allocations"."allocation_version" = 'project-allocation-v1')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "specification_intake_items" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"access_project_id" text NOT NULL,
	"business_project_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"specification_link_id" text NOT NULL,
	"specification_id" text NOT NULL,
	"version_id" text NOT NULL,
	"file_id" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"validation_started_at" timestamp with time zone,
	"validation_finished_at" timestamp with time zone,
	"queued_at" timestamp with time zone,
	"processing_started_at" timestamp with time zone,
	"processing_finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"current_step" text NOT NULL,
	"assigned_actor_id" text,
	"task_id" text,
	"run_id" text,
	"event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"safe_error_category" text,
	"sla_deadline" timestamp with time zone NOT NULL,
	"intake_version" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"audit_correlation_id" text NOT NULL,
	"dataset_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "specification_intake_items_status_check" CHECK ("specification_intake_items"."status" in ('RECEIVED','VALIDATING','QUEUED','PROCESSING','NEEDS_REVIEW','COMPLETED','FAILED','CANCELLED')),
	CONSTRAINT "specification_intake_items_version_check" CHECK ("specification_intake_items"."intake_version" > 0),
	CONSTRAINT "specification_intake_items_events_json_check" CHECK (jsonb_typeof("specification_intake_items"."event_ids") = 'array' and jsonb_array_length("specification_intake_items"."event_ids") > 0)
);
--> statement-breakpoint
ALTER TABLE "business_project_deadlines" ADD CONSTRAINT "business_project_deadlines_project_fk" FOREIGN KEY ("tenant_id","business_project_id") REFERENCES "public"."business_projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_project_positions" ADD CONSTRAINT "business_project_positions_project_fk" FOREIGN KEY ("tenant_id","business_project_id") REFERENCES "public"."business_projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_project_positions" ADD CONSTRAINT "business_project_positions_specification_fk" FOREIGN KEY ("tenant_id","specification_link_id") REFERENCES "public"."business_project_specifications"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_project_positions" ADD CONSTRAINT "business_project_positions_material_fk" FOREIGN KEY ("tenant_id","operational_material_view_id") REFERENCES "public"."operational_material_views"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_project_specifications" ADD CONSTRAINT "business_project_specifications_project_fk" FOREIGN KEY ("tenant_id","business_project_id") REFERENCES "public"."business_projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_material_views" ADD CONSTRAINT "operational_material_views_catalog_item_fk" FOREIGN KEY ("owner_user_id","catalog_item_id") REFERENCES "public"."catalog_items"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_material_allocations" ADD CONSTRAINT "project_material_allocations_project_fk" FOREIGN KEY ("tenant_id","business_project_id") REFERENCES "public"."business_projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_material_allocations" ADD CONSTRAINT "project_material_allocations_material_fk" FOREIGN KEY ("tenant_id","operational_material_view_id") REFERENCES "public"."operational_material_views"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_intake_items" ADD CONSTRAINT "specification_intake_items_project_fk" FOREIGN KEY ("tenant_id","business_project_id") REFERENCES "public"."business_projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_intake_items" ADD CONSTRAINT "specification_intake_items_specification_fk" FOREIGN KEY ("tenant_id","specification_link_id") REFERENCES "public"."business_project_specifications"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_projects" ADD CONSTRAINT "business_projects_access_project_fk" FOREIGN KEY ("access_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_project_specifications" ADD CONSTRAINT "business_project_specifications_access_project_fk" FOREIGN KEY ("access_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_project_specifications" ADD CONSTRAINT "business_project_specifications_owner_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_project_specifications" ADD CONSTRAINT "business_project_specifications_source_fk" FOREIGN KEY ("specification_id") REFERENCES "public"."specifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_project_specifications" ADD CONSTRAINT "business_project_specifications_version_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."specification_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_material_views" ADD CONSTRAINT "operational_material_views_access_project_fk" FOREIGN KEY ("access_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_material_views" ADD CONSTRAINT "operational_material_views_catalog_scope_fk" FOREIGN KEY ("catalog_scope_id") REFERENCES "public"."catalog_scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_material_views" ADD CONSTRAINT "operational_material_views_source_scope_fk" FOREIGN KEY ("source_scope_id") REFERENCES "public"."source_scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_project_positions" ADD CONSTRAINT "business_project_positions_access_project_fk" FOREIGN KEY ("access_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_project_positions" ADD CONSTRAINT "business_project_positions_owner_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_project_positions" ADD CONSTRAINT "business_project_positions_source_fk" FOREIGN KEY ("position_id") REFERENCES "public"."specification_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_project_positions" ADD CONSTRAINT "business_project_positions_catalog_item_fk" FOREIGN KEY ("owner_user_id","catalog_item_id") REFERENCES "public"."catalog_items"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_intake_items" ADD CONSTRAINT "specification_intake_items_access_project_fk" FOREIGN KEY ("access_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_intake_items" ADD CONSTRAINT "specification_intake_items_owner_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_intake_items" ADD CONSTRAINT "specification_intake_items_source_fk" FOREIGN KEY ("specification_id") REFERENCES "public"."specifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_intake_items" ADD CONSTRAINT "specification_intake_items_version_fk" FOREIGN KEY ("version_id") REFERENCES "public"."specification_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_material_allocations" ADD CONSTRAINT "project_material_allocations_access_project_fk" FOREIGN KEY ("access_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_project_deadlines_kind_uq" ON "business_project_deadlines" USING btree ("tenant_id","business_project_id","dataset_version","kind");--> statement-breakpoint
CREATE INDEX "business_project_deadlines_due_idx" ON "business_project_deadlines" USING btree ("tenant_id","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "business_project_positions_dataset_position_uq" ON "business_project_positions" USING btree ("tenant_id","dataset_version","position_id");--> statement-breakpoint
CREATE INDEX "business_project_positions_project_type_idx" ON "business_project_positions" USING btree ("tenant_id","business_project_id","equipment_type");--> statement-breakpoint
CREATE UNIQUE INDEX "business_project_specifications_dataset_spec_uq" ON "business_project_specifications" USING btree ("tenant_id","dataset_version","specification_id");--> statement-breakpoint
CREATE INDEX "business_project_specifications_project_idx" ON "business_project_specifications" USING btree ("tenant_id","business_project_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "business_projects_dataset_code_uq" ON "business_projects" USING btree ("tenant_id","dataset_version","code");--> statement-breakpoint
CREATE INDEX "business_projects_access_status_idx" ON "business_projects" USING btree ("tenant_id","access_project_id","status");--> statement-breakpoint
CREATE INDEX "business_projects_need_date_idx" ON "business_projects" USING btree ("tenant_id","need_date");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_material_views_dataset_material_uq" ON "operational_material_views" USING btree ("tenant_id","dataset_version","material_code");--> statement-breakpoint
CREATE INDEX "operational_material_views_catalog_idx" ON "operational_material_views" USING btree ("tenant_id","catalog_item_id");--> statement-breakpoint
CREATE INDEX "operational_material_views_type_idx" ON "operational_material_views" USING btree ("tenant_id","equipment_type","item_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "project_material_allocations_snapshot_need_uq" ON "project_material_allocations" USING btree ("tenant_id","snapshot_id","business_project_id","material_code");--> statement-breakpoint
CREATE INDEX "project_material_allocations_material_idx" ON "project_material_allocations" USING btree ("tenant_id","operational_material_view_id","snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "specification_intake_items_idempotency_uq" ON "specification_intake_items" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "specification_intake_items_project_status_idx" ON "specification_intake_items" USING btree ("tenant_id","business_project_id","status","received_at");
