CREATE TABLE "agent_learning_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"response_message_id" text NOT NULL,
	"case_id" text,
	"feedback_kind" text NOT NULL,
	"status" text DEFAULT 'QUARANTINED' NOT NULL,
	"sanitized_summary" text,
	"source_prompt_version" text NOT NULL,
	"source_model_version" text NOT NULL,
	"source_rule_versions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_evidence_version" text NOT NULL,
	"applicability" jsonb,
	"regression_case_id" text,
	"validation_checksum" text,
	"validation_summary" text,
	"idempotency_key" text NOT NULL,
	"authorization_version" integer NOT NULL,
	"role_assignment_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_by_user_id" text,
	"promoted_by_user_id" text,
	"rejected_by_user_id" text,
	"revoked_by_user_id" text,
	"approved_at" timestamp with time zone,
	"promoted_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retention_until" timestamp with time zone DEFAULT now() + interval '1 year' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agent_learning_feedback_kind_check" CHECK ("agent_learning_candidates"."feedback_kind" in ('USEFUL','INCORRECT_FACT','INCORRECT_CAUSE','MISSING_FACTOR','INCORRECT_FORECAST','UNSUITABLE_RECOMMENDATION','MISSING_SOURCE','MISUNDERSTOOD_QUESTION','UNSAFE_ACTION')),
	CONSTRAINT "agent_learning_status_check" CHECK ("agent_learning_candidates"."status" in ('QUARANTINED','APPROVED','PROMOTED','REJECTED','REVOKED')),
	CONSTRAINT "agent_learning_auth_version_check" CHECK ("agent_learning_candidates"."authorization_version" > 0),
	CONSTRAINT "agent_learning_rules_json_check" CHECK (jsonb_typeof("agent_learning_candidates"."source_rule_versions") = 'array'),
	CONSTRAINT "agent_learning_role_snapshot_json_check" CHECK (jsonb_typeof("agent_learning_candidates"."role_assignment_snapshot") = 'array'),
	CONSTRAINT "agent_learning_applicability_json_check" CHECK ("agent_learning_candidates"."applicability" is null or jsonb_typeof("agent_learning_candidates"."applicability") = 'object'),
	CONSTRAINT "agent_learning_approval_bundle_check" CHECK ("agent_learning_candidates"."status" in ('QUARANTINED','REJECTED') or ("agent_learning_candidates"."applicability" is not null and "agent_learning_candidates"."regression_case_id" is not null and "agent_learning_candidates"."validation_checksum" ~ '^[a-f0-9]{64}$' and "agent_learning_candidates"."approved_by_user_id" is not null and "agent_learning_candidates"."approved_at" is not null)),
	CONSTRAINT "agent_learning_promotion_check" CHECK ("agent_learning_candidates"."status" not in ('PROMOTED','REVOKED') or ("agent_learning_candidates"."promoted_by_user_id" is not null and "agent_learning_candidates"."promoted_at" is not null)),
	CONSTRAINT "agent_learning_retention_check" CHECK ("agent_learning_candidates"."retention_until" >= "agent_learning_candidates"."created_at" + interval '1 year')
);
--> statement-breakpoint
ALTER TABLE "agent_learning_candidates" ADD CONSTRAINT "agent_learning_candidates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_candidates" ADD CONSTRAINT "agent_learning_candidates_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_candidates" ADD CONSTRAINT "agent_learning_candidates_response_message_id_agent_messages_id_fk" FOREIGN KEY ("response_message_id") REFERENCES "public"."agent_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_candidates" ADD CONSTRAINT "agent_learning_candidates_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_candidates" ADD CONSTRAINT "agent_learning_candidates_promoted_by_user_id_users_id_fk" FOREIGN KEY ("promoted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_candidates" ADD CONSTRAINT "agent_learning_candidates_rejected_by_user_id_users_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_candidates" ADD CONSTRAINT "agent_learning_candidates_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_learning_candidates" ADD CONSTRAINT "agent_learning_case_scope_fk" FOREIGN KEY ("case_id","tenant_id","project_id") REFERENCES "public"."agent_cases"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_learning_idempotency_uq" ON "agent_learning_candidates" USING btree ("tenant_id","project_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_learning_owner_message_uq" ON "agent_learning_candidates" USING btree ("tenant_id","project_id","owner_user_id","response_message_id");--> statement-breakpoint
CREATE INDEX "agent_learning_project_status_idx" ON "agent_learning_candidates" USING btree ("tenant_id","project_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "agent_learning_owner_created_idx" ON "agent_learning_candidates" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_learning_retention_idx" ON "agent_learning_candidates" USING btree ("retention_until");
