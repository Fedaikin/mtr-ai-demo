CREATE TABLE "catalog_bom_components" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"assembly_item_id" text NOT NULL,
	"component_item_id" text NOT NULL,
	"position_number" text NOT NULL,
	"quantity" numeric(18, 3) NOT NULL,
	"unit" text NOT NULL,
	"is_critical" boolean DEFAULT false NOT NULL,
	"alternative_family_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "catalog_bom_positive_quantity_check" CHECK ("catalog_bom_components"."quantity" > 0),
	CONSTRAINT "catalog_bom_distinct_items_check" CHECK ("catalog_bom_components"."assembly_item_id" <> "catalog_bom_components"."component_item_id")
);
--> statement-breakpoint
CREATE TABLE "catalog_interchangeability_families" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code" text NOT NULL,
	"name_ru" text NOT NULL,
	"name_en" text,
	"equipment_type" text NOT NULL,
	"item_kind" text NOT NULL,
	"unit" text NOT NULL,
	"compatibility_signature" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_synthetic_demo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "catalog_families_user_id_uq" UNIQUE("user_id","id"),
	CONSTRAINT "catalog_families_item_kind_check" CHECK ("catalog_interchangeability_families"."item_kind" in ('COMPONENT', 'ASSEMBLY'))
);
--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"item_code" text NOT NULL,
	"legacy_code" text,
	"manufacturer_part_number" text,
	"name_ru" text NOT NULL,
	"name_en" text,
	"synonyms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"equipment_type" text NOT NULL,
	"item_kind" text NOT NULL,
	"family_id" text,
	"manufacturer" text,
	"standard" text,
	"material_grade" text,
	"characteristics" jsonb NOT NULL,
	"unit" text NOT NULL,
	"card_url" text NOT NULL,
	"fixture_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_synthetic_demo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "catalog_items_user_id_uq" UNIQUE("user_id","id"),
	CONSTRAINT "catalog_items_item_kind_check" CHECK ("catalog_items"."item_kind" in ('COMPONENT', 'ASSEMBLY'))
);
--> statement-breakpoint
CREATE TABLE "catalog_stock_balances" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"item_id" text NOT NULL,
	"plant" text NOT NULL,
	"storage_location" text NOT NULL,
	"batch" text,
	"available_quantity" numeric(18, 3) NOT NULL,
	"unit" text NOT NULL,
	"snapshot_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT 'demo-user-001' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "catalog_stock_available_quantity_check" CHECK ("catalog_stock_balances"."available_quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "catalog_bom_components" ADD CONSTRAINT "catalog_bom_components_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_bom_components" ADD CONSTRAINT "catalog_bom_user_assembly_fk" FOREIGN KEY ("user_id","assembly_item_id") REFERENCES "public"."catalog_items"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_bom_components" ADD CONSTRAINT "catalog_bom_user_component_fk" FOREIGN KEY ("user_id","component_item_id") REFERENCES "public"."catalog_items"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_bom_components" ADD CONSTRAINT "catalog_bom_user_alt_family_fk" FOREIGN KEY ("user_id","alternative_family_id") REFERENCES "public"."catalog_interchangeability_families"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_interchangeability_families" ADD CONSTRAINT "catalog_interchangeability_families_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_user_family_fk" FOREIGN KEY ("user_id","family_id") REFERENCES "public"."catalog_interchangeability_families"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_stock_balances" ADD CONSTRAINT "catalog_stock_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_stock_balances" ADD CONSTRAINT "catalog_stock_user_item_fk" FOREIGN KEY ("user_id","item_id") REFERENCES "public"."catalog_items"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_bom_assembly_position_uq" ON "catalog_bom_components" USING btree ("user_id","assembly_item_id","position_number");--> statement-breakpoint
CREATE INDEX "catalog_bom_user_component_idx" ON "catalog_bom_components" USING btree ("user_id","component_item_id");--> statement-breakpoint
CREATE INDEX "catalog_bom_user_alt_family_idx" ON "catalog_bom_components" USING btree ("user_id","alternative_family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_families_user_code_uq" ON "catalog_interchangeability_families" USING btree ("user_id","code");--> statement-breakpoint
CREATE INDEX "catalog_families_user_type_kind_idx" ON "catalog_interchangeability_families" USING btree ("user_id","equipment_type","item_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_user_code_uq" ON "catalog_items" USING btree ("user_id","item_code");--> statement-breakpoint
CREATE INDEX "catalog_items_user_code_prefix_idx" ON "catalog_items" USING btree ("user_id","item_code" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "catalog_items_user_name_ru_prefix_idx" ON "catalog_items" USING btree ("user_id","name_ru" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "catalog_items_user_type_kind_idx" ON "catalog_items" USING btree ("user_id","equipment_type","item_kind");--> statement-breakpoint
CREATE INDEX "catalog_items_user_kind_idx" ON "catalog_items" USING btree ("user_id","item_kind");--> statement-breakpoint
CREATE INDEX "catalog_items_user_family_idx" ON "catalog_items" USING btree ("user_id","family_id");--> statement-breakpoint
CREATE INDEX "catalog_items_characteristics_gin_idx" ON "catalog_items" USING gin ("characteristics");--> statement-breakpoint
CREATE INDEX "catalog_stock_user_item_idx" ON "catalog_stock_balances" USING btree ("user_id","item_id");--> statement-breakpoint
CREATE INDEX "catalog_stock_user_location_item_idx" ON "catalog_stock_balances" USING btree ("user_id","plant","storage_location","item_id");