CREATE TABLE IF NOT EXISTS "agent_action_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"case_id" text NOT NULL,
	"plan_execution_id" text,
	"proposed_by_user_id" text NOT NULL,
	"action_type" text NOT NULL,
	"status" text NOT NULL,
	"resource_descriptor" jsonb NOT NULL,
	"required_permission" text NOT NULL,
	"summary" text NOT NULL,
	"consequences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"idempotency_key" text NOT NULL,
	"authorization_version" integer NOT NULL,
	"role_assignment_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmation_authorization_version" integer,
	"confirmation_role_assignment_snapshot" jsonb,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"execution_started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"safe_error_code" text,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retention_until" timestamp with time zone DEFAULT now() + interval '1 year' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agent_actions_type_check" CHECK ("agent_action_proposals"."action_type" in ('RUN_SCENARIO','RETRY_SCENARIO','CREATE_REVIEW_TASK','PREPARE_REPORT_DRAFT','PREPARE_EXPORT_DRAFT')),
	CONSTRAINT "agent_actions_status_check" CHECK ("agent_action_proposals"."status" in ('PROPOSED','CONFIRMED','EXECUTING','SUCCEEDED','FAILED','EXPIRED','CANCELLED')),
	CONSTRAINT "agent_actions_auth_version_check" CHECK ("agent_action_proposals"."authorization_version" > 0),
	CONSTRAINT "agent_actions_confirm_auth_version_check" CHECK ("agent_action_proposals"."confirmation_authorization_version" is null or "agent_action_proposals"."confirmation_authorization_version" > 0),
	CONSTRAINT "agent_actions_resource_json_check" CHECK (jsonb_typeof("agent_action_proposals"."resource_descriptor") = 'object'),
	CONSTRAINT "agent_actions_consequences_json_check" CHECK (jsonb_typeof("agent_action_proposals"."consequences") = 'array'),
	CONSTRAINT "agent_actions_parameters_json_check" CHECK (jsonb_typeof("agent_action_proposals"."parameters") = 'object'),
	CONSTRAINT "agent_actions_result_json_check" CHECK ("agent_action_proposals"."result" is null or jsonb_typeof("agent_action_proposals"."result") = 'object'),
	CONSTRAINT "agent_actions_role_snapshot_json_check" CHECK (jsonb_typeof("agent_action_proposals"."role_assignment_snapshot") = 'array'),
	CONSTRAINT "agent_actions_confirm_role_json_check" CHECK ("agent_action_proposals"."confirmation_role_assignment_snapshot" is null or jsonb_typeof("agent_action_proposals"."confirmation_role_assignment_snapshot") = 'array'),
	CONSTRAINT "agent_actions_expiry_check" CHECK ("agent_action_proposals"."expires_at" > "agent_action_proposals"."proposed_at"),
	CONSTRAINT "agent_actions_confirmation_check" CHECK ("agent_action_proposals"."status" in ('PROPOSED','CANCELLED','EXPIRED') or ("agent_action_proposals"."confirmed_at" is not null and "agent_action_proposals"."confirmation_authorization_version" is not null and "agent_action_proposals"."confirmation_role_assignment_snapshot" is not null)),
	CONSTRAINT "agent_actions_retention_check" CHECK ("agent_action_proposals"."retention_until" >= "agent_action_proposals"."created_at" + interval '1 year')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"thread_id" text,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"context_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"authorization_version" integer NOT NULL,
	"role_assignment_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retention_until" timestamp with time zone DEFAULT now() + interval '1 year' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agent_cases_scope_uq" UNIQUE("id","tenant_id","project_id"),
	CONSTRAINT "agent_cases_status_check" CHECK ("agent_cases"."status" in ('DRAFT','GATHERING_DATA','ANALYZED','NEEDS_REVIEW','READY','BLOCKED','CLOSED')),
	CONSTRAINT "agent_cases_auth_version_check" CHECK ("agent_cases"."authorization_version" > 0),
	CONSTRAINT "agent_cases_context_json_check" CHECK (jsonb_typeof("agent_cases"."context_snapshot") = 'object'),
	CONSTRAINT "agent_cases_role_snapshot_json_check" CHECK (jsonb_typeof("agent_cases"."role_assignment_snapshot") = 'array'),
	CONSTRAINT "agent_cases_retention_check" CHECK ("agent_cases"."retention_until" >= "agent_cases"."created_at" + interval '1 year')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_event_inbox" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"actor_user_id" text,
	"source_system" text NOT NULL,
	"source_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"safe_error_code" text,
	"correlation_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"authorization_version" integer,
	"role_assignment_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retention_until" timestamp with time zone DEFAULT now() + interval '1 year' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agent_inbox_status_check" CHECK ("agent_event_inbox"."status" in ('PENDING','PROCESSING','PROCESSED','FAILED','DEAD_LETTER')),
	CONSTRAINT "agent_inbox_attempts_check" CHECK ("agent_event_inbox"."max_attempts" between 1 and 25 and "agent_event_inbox"."attempts" between 0 and "agent_event_inbox"."max_attempts"),
	CONSTRAINT "agent_inbox_auth_version_check" CHECK ("agent_event_inbox"."authorization_version" is null or "agent_event_inbox"."authorization_version" > 0),
	CONSTRAINT "agent_inbox_payload_json_check" CHECK (jsonb_typeof("agent_event_inbox"."payload") = 'object'),
	CONSTRAINT "agent_inbox_role_snapshot_json_check" CHECK (jsonb_typeof("agent_event_inbox"."role_assignment_snapshot") = 'array'),
	CONSTRAINT "agent_inbox_processed_time_check" CHECK ("agent_event_inbox"."processed_at" is null or "agent_event_inbox"."processed_at" >= "agent_event_inbox"."received_at"),
	CONSTRAINT "agent_inbox_retention_check" CHECK ("agent_event_inbox"."retention_until" >= "agent_event_inbox"."created_at" + interval '1 year')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_evidence_facts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"case_id" text NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"source_system" text NOT NULL,
	"entity_id" text NOT NULL,
	"version_or_snapshot" text NOT NULL,
	"clause_id" text,
	"observed_at" timestamp with time zone NOT NULL,
	"source_snapshot_at" timestamp with time zone NOT NULL,
	"freshness" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"access_attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"authorization_version" integer NOT NULL,
	"role_assignment_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retention_until" timestamp with time zone DEFAULT now() + interval '1 year' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agent_evidence_freshness_check" CHECK ("agent_evidence_facts"."freshness" in ('FRESH','AGING','STALE','UNKNOWN')),
	CONSTRAINT "agent_evidence_auth_version_check" CHECK ("agent_evidence_facts"."authorization_version" > 0),
	CONSTRAINT "agent_evidence_payload_json_check" CHECK (jsonb_typeof("agent_evidence_facts"."payload") = 'object'),
	CONSTRAINT "agent_evidence_access_json_check" CHECK (jsonb_typeof("agent_evidence_facts"."access_attributes") = 'object'),
	CONSTRAINT "agent_evidence_role_snapshot_json_check" CHECK (jsonb_typeof("agent_evidence_facts"."role_assignment_snapshot") = 'array'),
	CONSTRAINT "agent_evidence_snapshot_time_check" CHECK ("agent_evidence_facts"."source_snapshot_at" <= "agent_evidence_facts"."observed_at"),
	CONSTRAINT "agent_evidence_retention_check" CHECK ("agent_evidence_facts"."retention_until" >= "agent_evidence_facts"."created_at" + interval '1 year')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_metric_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"actor_user_id" text,
	"event_type" text NOT NULL,
	"event_version" integer NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"specification_id" text,
	"run_id" text,
	"task_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"correlation_id" text NOT NULL,
	"source_version" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"authorization_version" integer,
	"role_assignment_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retention_until" timestamp with time zone DEFAULT now() + interval '1 year' NOT NULL,
	CONSTRAINT "agent_metric_event_type_check" CHECK ("agent_metric_events"."event_type" in ('SPECIFICATION_UPLOADED','ANALYSIS_STARTED','ANALYSIS_STEP_STARTED','ANALYSIS_STEP_COMPLETED','ANALYSIS_COMPLETED','EXPERT_TASK_ASSIGNED','EXPERT_DECISION_RECORDED','SHORTAGE_DETECTED','SHORTAGE_ACTION_ACCEPTED','REPORT_PUBLISHED','PROCESS_FAILED')),
	CONSTRAINT "agent_metric_aggregate_type_check" CHECK ("agent_metric_events"."aggregate_type" in ('SPECIFICATION','RUN','ANALYSIS_STEP','EXPERT_TASK','SHORTAGE','REPORT')),
	CONSTRAINT "agent_metric_event_version_check" CHECK ("agent_metric_events"."event_version" > 0),
	CONSTRAINT "agent_metric_auth_version_check" CHECK ("agent_metric_events"."authorization_version" is null or "agent_metric_events"."authorization_version" > 0),
	CONSTRAINT "agent_metric_attributes_json_check" CHECK (jsonb_typeof("agent_metric_events"."attributes") = 'object'),
	CONSTRAINT "agent_metric_role_snapshot_json_check" CHECK (jsonb_typeof("agent_metric_events"."role_assignment_snapshot") = 'array'),
	CONSTRAINT "agent_metric_retention_check" CHECK ("agent_metric_events"."retention_until" >= "agent_metric_events"."ingested_at" + interval '1 year')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_plan_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"case_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"intent" text NOT NULL,
	"command_key" text,
	"status" text NOT NULL,
	"plan_version" text NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"max_steps" integer DEFAULT 8 NOT NULL,
	"correlation_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"authorization_version" integer NOT NULL,
	"role_assignment_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"safe_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retention_until" timestamp with time zone DEFAULT now() + interval '1 year' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agent_plan_scope_uq" UNIQUE("id","tenant_id","project_id"),
	CONSTRAINT "agent_plan_status_check" CHECK ("agent_plan_executions"."status" in ('PLANNED','RUNNING','SUCCEEDED','PARTIAL','FAILED','CANCELLED','EXPIRED')),
	CONSTRAINT "agent_plan_step_bounds_check" CHECK ("agent_plan_executions"."max_steps" between 1 and 20 and "agent_plan_executions"."current_step" between 0 and "agent_plan_executions"."max_steps"),
	CONSTRAINT "agent_plan_auth_version_check" CHECK ("agent_plan_executions"."authorization_version" > 0),
	CONSTRAINT "agent_plan_steps_json_check" CHECK (jsonb_typeof("agent_plan_executions"."steps") = 'array'),
	CONSTRAINT "agent_plan_role_snapshot_json_check" CHECK (jsonb_typeof("agent_plan_executions"."role_assignment_snapshot") = 'array'),
	CONSTRAINT "agent_plan_completion_time_check" CHECK ("agent_plan_executions"."completed_at" is null or "agent_plan_executions"."started_at" is null or "agent_plan_executions"."completed_at" >= "agent_plan_executions"."started_at"),
	CONSTRAINT "agent_plan_retention_check" CHECK ("agent_plan_executions"."retention_until" >= "agent_plan_executions"."created_at" + interval '1 year')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_proactive_insights" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"case_id" text,
	"subject_user_id" text,
	"trigger_type" text NOT NULL,
	"state_version" text NOT NULL,
	"level" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"recommended_action" text NOT NULL,
	"evidence_fact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deduplication_key" text NOT NULL,
	"rule_version" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cooldown_until" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"authorization_version" integer NOT NULL,
	"role_assignment_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retention_until" timestamp with time zone DEFAULT now() + interval '1 year' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agent_insights_trigger_check" CHECK ("agent_proactive_insights"."trigger_type" in ('APPIUS_VERSION_PUBLISHED','SAP_SNAPSHOT_RECEIVED','RISK_LEVEL_RAISED','DUE_DATE_APPROACHING','SLA_BREACHED','SCENARIO_COMPLETED','SCENARIO_FAILED','INTEGRATION_RECOVERED')),
	CONSTRAINT "agent_insights_level_check" CHECK ("agent_proactive_insights"."level" in ('LOW','MEDIUM','HIGH','CRITICAL')),
	CONSTRAINT "agent_insights_status_check" CHECK ("agent_proactive_insights"."status" in ('ACTIVE','ACKNOWLEDGED','RESOLVED','EXPIRED','SUPPRESSED')),
	CONSTRAINT "agent_insights_auth_version_check" CHECK ("agent_proactive_insights"."authorization_version" > 0),
	CONSTRAINT "agent_insights_evidence_json_check" CHECK (jsonb_typeof("agent_proactive_insights"."evidence_fact_ids") = 'array'),
	CONSTRAINT "agent_insights_role_snapshot_json_check" CHECK (jsonb_typeof("agent_proactive_insights"."role_assignment_snapshot") = 'array'),
	CONSTRAINT "agent_insights_seen_time_check" CHECK ("agent_proactive_insights"."last_seen_at" >= "agent_proactive_insights"."first_seen_at"),
	CONSTRAINT "agent_insights_retention_check" CHECK ("agent_proactive_insights"."retention_until" >= "agent_proactive_insights"."created_at" + interval '1 year')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"case_id" text,
	"review_decision_id" text REFERENCES "analysis_review_decisions"("id") ON DELETE SET NULL,
	"assignee_user_id" text NOT NULL,
	"assigned_by_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"priority" text NOT NULL,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"allowed_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assignment_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"due_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"authorization_version" integer NOT NULL,
	"role_assignment_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retention_until" timestamp with time zone DEFAULT now() + interval '1 year' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agent_tasks_kind_check" CHECK ("agent_tasks"."kind" in ('ANALYSIS_REVIEW','EXPERT_REVIEW','DATA_CLARIFICATION','TECHNICAL')),
	CONSTRAINT "agent_tasks_status_check" CHECK ("agent_tasks"."status" in ('AWAITING_ACCEPTANCE','IN_PROGRESS','REQUIRES_DECISION','RETURNED_FOR_CLARIFICATION','COMPLETED','CANCELLED')),
	CONSTRAINT "agent_tasks_priority_check" CHECK ("agent_tasks"."priority" in ('LOW','NORMAL','HIGH','CRITICAL')),
	CONSTRAINT "agent_tasks_auth_version_check" CHECK ("agent_tasks"."authorization_version" > 0),
	CONSTRAINT "agent_tasks_allowed_actions_json_check" CHECK (jsonb_typeof("agent_tasks"."allowed_actions") = 'array'),
	CONSTRAINT "agent_tasks_assignment_history_json_check" CHECK (jsonb_typeof("agent_tasks"."assignment_history") = 'array'),
	CONSTRAINT "agent_tasks_role_snapshot_json_check" CHECK (jsonb_typeof("agent_tasks"."role_assignment_snapshot") = 'array'),
	CONSTRAINT "agent_tasks_completion_time_check" CHECK ("agent_tasks"."completed_at" is null or "agent_tasks"."completed_at" >= "agent_tasks"."created_at"),
	CONSTRAINT "agent_tasks_retention_check" CHECK ("agent_tasks"."retention_until" >= "agent_tasks"."created_at" + interval '1 year')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "material_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_scope_id" text NOT NULL,
	"material_code" text NOT NULL,
	"plant" text NOT NULL,
	"storage_location" text NOT NULL,
	"movement_type" text NOT NULL,
	"quantity" numeric(18, 3) NOT NULL,
	"unit" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source_document_id" text NOT NULL,
	"snapshot_version" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"authorization_version" integer,
	"role_assignment_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retention_until" timestamp with time zone DEFAULT now() + interval '1 year' NOT NULL,
	CONSTRAINT "material_movements_type_check" CHECK ("material_movements"."movement_type" in ('RECEIPT','CONSUMPTION','TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT')),
	CONSTRAINT "material_movements_quantity_check" CHECK ("material_movements"."movement_type" = 'ADJUSTMENT' or "material_movements"."quantity" >= 0),
	CONSTRAINT "material_movements_auth_version_check" CHECK ("material_movements"."authorization_version" is null or "material_movements"."authorization_version" > 0),
	CONSTRAINT "material_movements_attributes_json_check" CHECK (jsonb_typeof("material_movements"."attributes") = 'object'),
	CONSTRAINT "material_movements_role_snapshot_json_check" CHECK (jsonb_typeof("material_movements"."role_assignment_snapshot") = 'array'),
	CONSTRAINT "material_movements_retention_check" CHECK ("material_movements"."retention_until" >= "material_movements"."ingested_at" + interval '1 year')
);
--> statement-breakpoint
ALTER TABLE "agent_cases" ADD CONSTRAINT "agent_cases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_evidence_facts" ADD CONSTRAINT "agent_evidence_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_plan_executions" ADD CONSTRAINT "agent_plan_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_action_proposals" ADD CONSTRAINT "agent_actions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_event_inbox" ADD CONSTRAINT "agent_inbox_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proactive_insights" ADD CONSTRAINT "agent_insights_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_metric_events" ADD CONSTRAINT "agent_metrics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_movements" ADD CONSTRAINT "material_movements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_movements" ADD CONSTRAINT "material_movements_source_scope_id_fk" FOREIGN KEY ("source_scope_id") REFERENCES "public"."source_scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_action_proposals" ADD CONSTRAINT "agent_action_proposals_proposed_by_user_id_users_id_fk" FOREIGN KEY ("proposed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_action_proposals" ADD CONSTRAINT "agent_actions_case_scope_fk" FOREIGN KEY ("case_id","tenant_id","project_id") REFERENCES "public"."agent_cases"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_action_proposals" ADD CONSTRAINT "agent_actions_plan_scope_fk" FOREIGN KEY ("plan_execution_id","tenant_id","project_id") REFERENCES "public"."agent_plan_executions"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_cases" ADD CONSTRAINT "agent_cases_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_cases" ADD CONSTRAINT "agent_cases_thread_id_agent_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."agent_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_cases" ADD CONSTRAINT "agent_cases_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_event_inbox" ADD CONSTRAINT "agent_event_inbox_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_evidence_facts" ADD CONSTRAINT "agent_evidence_facts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_evidence_facts" ADD CONSTRAINT "agent_evidence_case_scope_fk" FOREIGN KEY ("case_id","tenant_id","project_id") REFERENCES "public"."agent_cases"("id","tenant_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_metric_events" ADD CONSTRAINT "agent_metric_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_plan_executions" ADD CONSTRAINT "agent_plan_executions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_plan_executions" ADD CONSTRAINT "agent_plan_case_scope_fk" FOREIGN KEY ("case_id","tenant_id","project_id") REFERENCES "public"."agent_cases"("id","tenant_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proactive_insights" ADD CONSTRAINT "agent_proactive_insights_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proactive_insights" ADD CONSTRAINT "agent_proactive_insights_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proactive_insights" ADD CONSTRAINT "agent_insights_case_scope_fk" FOREIGN KEY ("case_id","tenant_id","project_id") REFERENCES "public"."agent_cases"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_case_scope_fk" FOREIGN KEY ("case_id","tenant_id","project_id") REFERENCES "public"."agent_cases"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_actions_idempotency_uq" ON "agent_action_proposals" USING btree ("tenant_id","project_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_actions_actor_status_idx" ON "agent_action_proposals" USING btree ("tenant_id","proposed_by_user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "agent_actions_project_status_idx" ON "agent_action_proposals" USING btree ("tenant_id","project_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "agent_actions_retention_idx" ON "agent_action_proposals" USING btree ("retention_until");--> statement-breakpoint
CREATE INDEX "agent_cases_tenant_project_status_idx" ON "agent_cases" USING btree ("tenant_id","project_id","status");--> statement-breakpoint
CREATE INDEX "agent_cases_owner_updated_idx" ON "agent_cases" USING btree ("owner_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "agent_cases_retention_idx" ON "agent_cases" USING btree ("retention_until");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_inbox_source_event_uq" ON "agent_event_inbox" USING btree ("tenant_id","source_system","source_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_inbox_idempotency_uq" ON "agent_event_inbox" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_inbox_dispatch_idx" ON "agent_event_inbox" USING btree ("status","available_at","attempts");--> statement-breakpoint
CREATE INDEX "agent_inbox_project_event_idx" ON "agent_event_inbox" USING btree ("tenant_id","project_id","event_type","received_at");--> statement-breakpoint
CREATE INDEX "agent_inbox_retention_idx" ON "agent_event_inbox" USING btree ("retention_until");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_evidence_case_fingerprint_uq" ON "agent_evidence_facts" USING btree ("tenant_id","case_id","fingerprint");--> statement-breakpoint
CREATE INDEX "agent_evidence_tenant_project_case_idx" ON "agent_evidence_facts" USING btree ("tenant_id","project_id","case_id");--> statement-breakpoint
CREATE INDEX "agent_evidence_source_entity_idx" ON "agent_evidence_facts" USING btree ("tenant_id","source_system","entity_id");--> statement-breakpoint
CREATE INDEX "agent_evidence_retention_idx" ON "agent_evidence_facts" USING btree ("retention_until");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_metric_event_idempotency_uq" ON "agent_metric_events" USING btree ("tenant_id","project_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_metric_aggregate_version_uq" ON "agent_metric_events" USING btree ("tenant_id","project_id","aggregate_type","aggregate_id","event_version");--> statement-breakpoint
CREATE INDEX "agent_metric_project_event_time_idx" ON "agent_metric_events" USING btree ("tenant_id","project_id","event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "agent_metric_correlation_idx" ON "agent_metric_events" USING btree ("tenant_id","correlation_id");--> statement-breakpoint
CREATE INDEX "agent_metric_retention_idx" ON "agent_metric_events" USING btree ("retention_until");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_plan_idempotency_uq" ON "agent_plan_executions" USING btree ("tenant_id","project_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_plan_status_created_idx" ON "agent_plan_executions" USING btree ("tenant_id","project_id","status","created_at");--> statement-breakpoint
CREATE INDEX "agent_plan_correlation_idx" ON "agent_plan_executions" USING btree ("tenant_id","correlation_id");--> statement-breakpoint
CREATE INDEX "agent_plan_retention_idx" ON "agent_plan_executions" USING btree ("retention_until");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_insights_deduplication_uq" ON "agent_proactive_insights" USING btree ("tenant_id","project_id","deduplication_key");--> statement-breakpoint
CREATE INDEX "agent_insights_subject_status_idx" ON "agent_proactive_insights" USING btree ("tenant_id","subject_user_id","status","level");--> statement-breakpoint
CREATE INDEX "agent_insights_project_last_seen_idx" ON "agent_proactive_insights" USING btree ("tenant_id","project_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "agent_insights_retention_idx" ON "agent_proactive_insights" USING btree ("retention_until");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tasks_idempotency_uq" ON "agent_tasks" USING btree ("tenant_id","project_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_tasks_assignee_status_due_idx" ON "agent_tasks" USING btree ("tenant_id","assignee_user_id","status","due_at");--> statement-breakpoint
CREATE INDEX "agent_tasks_project_priority_idx" ON "agent_tasks" USING btree ("tenant_id","project_id","priority","status");--> statement-breakpoint
CREATE INDEX "agent_tasks_retention_idx" ON "agent_tasks" USING btree ("retention_until");--> statement-breakpoint
CREATE UNIQUE INDEX "material_movements_idempotency_uq" ON "material_movements" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "material_movements_project_material_idx" ON "material_movements" USING btree ("tenant_id","project_id","material_code","occurred_at");--> statement-breakpoint
CREATE INDEX "material_movements_warehouse_time_idx" ON "material_movements" USING btree ("tenant_id","source_scope_id","plant","storage_location","occurred_at");--> statement-breakpoint
CREATE INDEX "material_movements_retention_idx" ON "material_movements" USING btree ("retention_until");
