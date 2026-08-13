import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { ScenarioRunStatus } from "@/domain/models";

const mutableColumns = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  createdBy: text("created_by").notNull().default("demo-user-001"),
  version: integer("version").notNull().default(1),
};

const durableAgentColumns = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  retentionUntil: timestamp("retention_until", { withTimezone: true, mode: "string" })
    .notNull()
    .default(sql`now() + interval '1 year'`),
  version: integer("version").notNull().default(1),
};

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  login: text("login").notNull().default("demo").unique(),
  passwordHash: text("password_hash")
    .notNull()
    .default(
      "scrypt$16384$8$1$bXRyLWRlbW8tYXV0aC12MQ$GcR_B-AFou6BJpPfLHVa0afwkfnOh5_ehbSyTSL2TFn7UARDrszHNcwtC19lk40LVfg7sGA_roL4NX7hUkexBA",
    ),
  displayName: text("display_name").notNull(),
  roles: jsonb("roles").$type<string[]>().notNull(),
  locale: text("locale").notNull().default("ru-RU"),
  isSyntheticDemo: boolean("is_synthetic_demo").notNull().default(true),
  status: text("status").notNull().default("ACTIVE"),
  accountType: text("account_type").notNull().default("HUMAN"),
  authSource: text("auth_source").notNull().default("DEMO"),
  externalSubjectId: text("external_subject_id"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: "string" }),
  authorizationVersion: integer("authorization_version").notNull().default(1),
  ...mutableColumns,
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
    authorizationVersion: integer("authorization_version").notNull().default(1),
    activatedRoleAssignmentIds: jsonb("activated_role_assignment_ids").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_sessions_token_hash_uq").on(table.tokenHash),
    index("auth_sessions_user_expiry_idx").on(table.userId, table.expiresAt),
  ],
);

export const specifications = pgTable(
  "specifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    projectCode: text("project_code").notNull(),
    name: text("name").notNull(),
    latestVersionId: text("latest_version_id").notNull(),
    latestVersionNumber: integer("latest_version_number").notNull(),
    positionCount: integer("position_count").notNull(),
    accessAttributes: jsonb("access_attributes").$type<Record<string, unknown>>().notNull().default({}),
    ...mutableColumns,
  },
  (table) => [index("specifications_user_idx").on(table.userId)],
);

export const specificationVersions = pgTable(
  "specification_versions",
  {
    id: text("id").primaryKey(),
    specificationId: text("specification_id").notNull().references(() => specifications.id),
    userId: text("user_id").notNull().references(() => users.id),
    versionNumber: integer("version_number").notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
    status: text("status").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true, mode: "string" }).notNull(),
    positionCount: integer("position_count").notNull(),
    sourceFileId: text("source_file_id"),
    sourceFileName: text("source_file_name"),
    sourceKind: text("source_kind"),
    publishedBy: text("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }),
    validationSummary: jsonb("validation_summary").$type<Record<string, unknown>>(),
    historicSnapshot: jsonb("historic_snapshot").$type<Record<string, unknown>>(),
    accessAttributes: jsonb("access_attributes").$type<Record<string, unknown>>().notNull().default({}),
    ...mutableColumns,
  },
  (table) => [
    uniqueIndex("spec_versions_number_uq").on(table.specificationId, table.versionNumber),
    index("spec_versions_user_idx").on(table.userId),
  ],
);

export const specificationPositions = pgTable(
  "specification_positions",
  {
    id: text("id").primaryKey(),
    specificationId: text("specification_id").notNull().references(() => specifications.id),
    versionId: text("version_id").notNull().references(() => specificationVersions.id),
    userId: text("user_id").notNull().references(() => users.id),
    internalCode: text("internal_code").notNull(),
    nameRu: text("name_ru").notNull(),
    nameEn: text("name_en"),
    synonyms: jsonb("synonyms").$type<string[]>().notNull().default([]),
    equipmentType: text("equipment_type").notNull(),
    standard: text("standard"),
    materialGrade: text("material_grade"),
    dimensions: jsonb("dimensions").$type<Record<string, number | string | boolean | null>>().notNull(),
    requiredQuantity: numeric("required_quantity", { precision: 18, scale: 3 }).notNull(),
    unit: text("unit").notNull(),
    classification: jsonb("classification").$type<Record<string, string>>().notNull(),
    accessAttributes: jsonb("access_attributes").$type<Record<string, unknown>>().notNull(),
    fixtureTags: jsonb("fixture_tags").$type<string[]>().notNull().default([]),
    isSyntheticDemo: boolean("is_synthetic_demo").notNull().default(true),
    ...mutableColumns,
  },
  (table) => [
    index("positions_user_spec_idx").on(table.userId, table.specificationId),
    uniqueIndex("positions_version_internal_code_uq").on(
      table.userId,
      table.versionId,
      table.internalCode,
    ),
  ],
);

export const sapMaterials = pgTable(
  "sap_materials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    materialCode: text("material_code").notNull(),
    nameRu: text("name_ru").notNull(),
    nameEn: text("name_en"),
    synonyms: jsonb("synonyms").$type<string[]>().notNull().default([]),
    legacyCode: text("legacy_code"),
    equipmentType: text("equipment_type").notNull(),
    standard: text("standard"),
    materialGrade: text("material_grade"),
    dimensions: jsonb("dimensions").$type<Record<string, number | string | boolean | null>>().notNull(),
    tolerances: jsonb("tolerances").$type<Record<string, number | string | boolean | null>>().notNull().default({}),
    unit: text("unit").notNull(),
    cardUrl: text("card_url").notNull(),
    sourcePositionId: text("source_position_id"),
    fixtureTags: jsonb("fixture_tags").$type<string[]>().notNull().default([]),
    isSyntheticDemo: boolean("is_synthetic_demo").notNull().default(true),
    ...mutableColumns,
  },
  (table) => [
    uniqueIndex("sap_material_code_uq").on(table.userId, table.materialCode),
    index("sap_material_type_idx").on(table.userId, table.equipmentType),
  ],
);

export const sapStockBalances = pgTable(
  "sap_stock_balances",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    materialId: text("material_id").notNull().references(() => sapMaterials.id),
    plant: text("plant").notNull(),
    storageLocation: text("storage_location").notNull(),
    batch: text("batch"),
    availableQuantity: numeric("available_quantity", { precision: 18, scale: 3 }).notNull(),
    unit: text("unit").notNull(),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true, mode: "string" }).notNull(),
    ...mutableColumns,
  },
  (table) => [
    index("sap_stock_material_idx").on(table.userId, table.materialId),
    check("sap_stock_available_quantity_nonnegative_integer_check", sql`${table.availableQuantity} >= 0 AND ${table.availableQuantity} = trunc(${table.availableQuantity})`),
  ],
);

/**
 * Additive large-catalogue storage. These tables are deliberately separate
 * from the small golden Appius/SAP fixtures so catalogue growth cannot change
 * canonical scenario counts, reset semantics, or acceptance-test outcomes.
 */
export const catalogInterchangeabilityFamilies = pgTable(
  "catalog_interchangeability_families",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    code: text("code").notNull(),
    nameRu: text("name_ru").notNull(),
    nameEn: text("name_en"),
    equipmentType: text("equipment_type").notNull(),
    itemKind: text("item_kind").notNull(),
    unit: text("unit").notNull(),
    compatibilitySignature: jsonb("compatibility_signature")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull(),
    active: boolean("active").notNull().default(true),
    isSyntheticDemo: boolean("is_synthetic_demo").notNull().default(true),
    ...mutableColumns,
  },
  (table) => [
    unique("catalog_families_user_id_uq").on(table.userId, table.id),
    uniqueIndex("catalog_families_user_code_uq").on(table.userId, table.code),
    index("catalog_families_user_type_kind_idx").on(
      table.userId,
      table.equipmentType,
      table.itemKind,
    ),
    check(
      "catalog_families_item_kind_check",
      sql`${table.itemKind} in ('COMPONENT', 'ASSEMBLY')`,
    ),
  ],
);

export const catalogItems = pgTable(
  "catalog_items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    itemCode: text("item_code").notNull(),
    legacyCode: text("legacy_code"),
    manufacturerPartNumber: text("manufacturer_part_number"),
    nameRu: text("name_ru").notNull(),
    nameEn: text("name_en"),
    synonyms: jsonb("synonyms").$type<string[]>().notNull().default([]),
    equipmentType: text("equipment_type").notNull(),
    itemKind: text("item_kind").notNull(),
    familyId: text("family_id"),
    manufacturer: text("manufacturer"),
    standard: text("standard"),
    materialGrade: text("material_grade"),
    characteristics: jsonb("characteristics")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull(),
    unit: text("unit").notNull(),
    cardUrl: text("card_url").notNull(),
    fixtureTags: jsonb("fixture_tags").$type<string[]>().notNull().default([]),
    isSyntheticDemo: boolean("is_synthetic_demo").notNull().default(true),
    ...mutableColumns,
  },
  (table) => [
    unique("catalog_items_user_id_uq").on(table.userId, table.id),
    uniqueIndex("catalog_items_user_code_uq").on(table.userId, table.itemCode),
    index("catalog_items_user_code_prefix_idx").on(
      table.userId,
      table.itemCode.asc().op("text_pattern_ops"),
    ),
    index("catalog_items_user_name_ru_prefix_idx").on(
      table.userId,
      table.nameRu.asc().op("text_pattern_ops"),
    ),
    index("catalog_items_user_type_kind_idx").on(
      table.userId,
      table.equipmentType,
      table.itemKind,
    ),
    index("catalog_items_user_kind_idx").on(table.userId, table.itemKind),
    index("catalog_items_user_family_idx").on(table.userId, table.familyId),
    index("catalog_items_characteristics_gin_idx").using("gin", table.characteristics),
    foreignKey({
      columns: [table.userId, table.familyId],
      foreignColumns: [
        catalogInterchangeabilityFamilies.userId,
        catalogInterchangeabilityFamilies.id,
      ],
      name: "catalog_items_user_family_fk",
    }),
    check("catalog_items_item_kind_check", sql`${table.itemKind} in ('COMPONENT', 'ASSEMBLY')`),
  ],
);

export const catalogStockBalances = pgTable(
  "catalog_stock_balances",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    itemId: text("item_id").notNull(),
    plant: text("plant").notNull(),
    storageLocation: text("storage_location").notNull(),
    batch: text("batch"),
    availableQuantity: numeric("available_quantity", { precision: 18, scale: 3 }).notNull(),
    unit: text("unit").notNull(),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true, mode: "string" }).notNull(),
    ...mutableColumns,
  },
  (table) => [
    index("catalog_stock_user_item_idx").on(table.userId, table.itemId),
    index("catalog_stock_user_location_item_idx").on(
      table.userId,
      table.plant,
      table.storageLocation,
      table.itemId,
    ),
    foreignKey({
      columns: [table.userId, table.itemId],
      foreignColumns: [catalogItems.userId, catalogItems.id],
      name: "catalog_stock_user_item_fk",
    }),
    check(
      "catalog_stock_available_quantity_check",
      sql`${table.availableQuantity} >= 0`,
    ),
    check(
      "catalog_stock_available_quantity_integer_check",
      sql`${table.availableQuantity} = trunc(${table.availableQuantity})`,
    ),
  ],
);

export const catalogBomComponents = pgTable(
  "catalog_bom_components",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    assemblyItemId: text("assembly_item_id").notNull(),
    componentItemId: text("component_item_id").notNull(),
    positionNumber: text("position_number").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 3 }).notNull(),
    unit: text("unit").notNull(),
    isCritical: boolean("is_critical").notNull().default(false),
    alternativeFamilyId: text("alternative_family_id"),
    ...mutableColumns,
  },
  (table) => [
    uniqueIndex("catalog_bom_assembly_position_uq").on(
      table.userId,
      table.assemblyItemId,
      table.positionNumber,
    ),
    index("catalog_bom_user_component_idx").on(table.userId, table.componentItemId),
    index("catalog_bom_user_alt_family_idx").on(table.userId, table.alternativeFamilyId),
    foreignKey({
      columns: [table.userId, table.assemblyItemId],
      foreignColumns: [catalogItems.userId, catalogItems.id],
      name: "catalog_bom_user_assembly_fk",
    }),
    foreignKey({
      columns: [table.userId, table.componentItemId],
      foreignColumns: [catalogItems.userId, catalogItems.id],
      name: "catalog_bom_user_component_fk",
    }),
    foreignKey({
      columns: [table.userId, table.alternativeFamilyId],
      foreignColumns: [
        catalogInterchangeabilityFamilies.userId,
        catalogInterchangeabilityFamilies.id,
      ],
      name: "catalog_bom_user_alt_family_fk",
    }),
    check("catalog_bom_positive_quantity_check", sql`${table.quantity} > 0`),
    check(
      "catalog_bom_distinct_items_check",
      sql`${table.assemblyItemId} <> ${table.componentItemId}`,
    ),
  ],
);

export const normativeDocuments = pgTable(
  "normative_documents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    documentId: text("document_id").notNull(),
    title: text("title").notNull(),
    documentVersion: text("document_version").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true, mode: "string" }).notNull(),
    accessAttributes: jsonb("access_attributes").$type<Record<string, unknown>>().notNull(),
    isSyntheticDemo: boolean("is_synthetic_demo").notNull().default(true),
    ...mutableColumns,
  },
  (table) => [uniqueIndex("normative_document_uq").on(table.userId, table.documentId, table.documentVersion)],
);

export const normativeChunks = pgTable(
  "normative_chunks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    normativeDocumentId: text("normative_document_id").notNull().references(() => normativeDocuments.id),
    clauseId: text("clause_id").notNull(),
    title: text("title").notNull(),
    text: text("text").notNull(),
    language: text("language").notNull(),
    equipmentTypes: jsonb("equipment_types").$type<string[]>().notNull(),
    applicability: jsonb("applicability").$type<Record<string, unknown>>().notNull().default({}),
    allowedDeviations: jsonb("allowed_deviations").$type<Record<string, unknown>>().notNull().default({}),
    accessAttributes: jsonb("access_attributes").$type<Record<string, unknown>>().notNull(),
    isSyntheticDemo: boolean("is_synthetic_demo").notNull().default(true),
    ...mutableColumns,
  },
  (table) => [index("normative_chunks_user_doc_idx").on(table.userId, table.normativeDocumentId)],
);

export const responsibilityRules = pgTable(
  "responsibility_rules",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    normativeDocumentId: text("normative_document_id").notNull().references(() => normativeDocuments.id),
    clauseId: text("clause_id").notNull(),
    equipmentTypes: jsonb("equipment_types").$type<string[]>().notNull(),
    responsibility: text("responsibility").notNull(),
    conditions: jsonb("conditions").$type<Record<string, unknown>>().notNull().default({}),
    ruleText: text("rule_text").notNull(),
    active: boolean("active").notNull().default(true),
    ...mutableColumns,
  },
  (table) => [index("responsibility_rules_user_idx").on(table.userId)],
);

export const analogueRules = pgTable(
  "analogue_rules",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    normativeDocumentId: text("normative_document_id").notNull().references(() => normativeDocuments.id),
    clauseId: text("clause_id").notNull(),
    equipmentTypes: jsonb("equipment_types").$type<string[]>().notNull(),
    allowedStandardPairs: jsonb("allowed_standard_pairs").$type<Array<[string, string]>>().notNull().default([]),
    allowedMaterialPairs: jsonb("allowed_material_pairs").$type<Array<[string, string]>>().notNull().default([]),
    dimensionTolerances: jsonb("dimension_tolerances").$type<Record<string, number>>().notNull().default({}),
    ruleText: text("rule_text").notNull(),
    active: boolean("active").notNull().default(true),
    ...mutableColumns,
  },
  (table) => [index("analogue_rules_user_idx").on(table.userId)],
);

export const integrationStates = pgTable(
  "integration_states",
  {
    userId: text("user_id").notNull().references(() => users.id),
    system: text("system").notNull(),
    state: text("state").notNull(),
    delayMs: integer("delay_ms").notNull().default(0),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true, mode: "string" }),
    lastSynchronizedAt: timestamp("last_synchronized_at", { withTimezone: true, mode: "string" }),
    safeMessage: text("safe_message"),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    ...mutableColumns,
  },
  (table) => [primaryKey({ columns: [table.userId, table.system] })],
);

export const scenarios = pgTable(
  "scenarios",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    description: text("description").notNull(),
    kind: text("kind").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
    ...mutableColumns,
  },
  (table) => [index("scenarios_user_idx").on(table.userId)],
);

export const scenarioRuns = pgTable(
  "scenario_runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    projectId: text("project_id").default("demo-project-001"),
    scenarioId: text("scenario_id").notNull().references(() => scenarios.id),
    specificationId: text("specification_id").notNull().references(() => specifications.id),
    retryOfRunId: text("retry_of_run_id"),
    status: text("status").$type<ScenarioRunStatus>().notNull(),
    currentStep: text("current_step").notNull(),
    progress: integer("progress").notNull().default(0),
    mode: text("mode").notNull().default("NORMAL"),
    seed: text("seed").notNull().default("base"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    inputSnapshot: jsonb("input_snapshot").$type<Record<string, unknown>>().notNull(),
    outputSnapshot: jsonb("output_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    ...mutableColumns,
  },
  (table) => [
    index("scenario_runs_user_created_idx").on(table.userId, table.createdAt),
    index("scenario_runs_status_idx").on(table.status),
  ],
);

export const scenarioRunSteps = pgTable(
  "scenario_run_steps",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => scenarioRuns.id),
    userId: text("user_id").notNull().references(() => users.id),
    status: text("status").$type<ScenarioRunStatus>().notNull(),
    label: text("label").notNull(),
    outcome: text("outcome").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    durationMs: integer("duration_ms"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text("idempotency_key").notNull(),
    ...mutableColumns,
  },
  (table) => [
    uniqueIndex("scenario_step_idempotency_uq").on(table.runId, table.idempotencyKey),
    index("scenario_steps_user_run_idx").on(table.userId, table.runId),
  ],
);

export const positionAnalysisResults = pgTable(
  "position_analysis_results",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => scenarioRuns.id),
    userId: text("user_id").notNull().references(() => users.id),
    // A result can refer either to a canonical PLM position or to a validated
    // run-scoped manual-import position stored in the result snapshot.
    positionId: text("position_id").notNull(),
    responsibility: text("responsibility").notNull(),
    responsibilityConfidence: numeric("responsibility_confidence", { precision: 5, scale: 4 }).notNull(),
    responsibilityCitation: jsonb("responsibility_citation").$type<Record<string, unknown>>().notNull(),
    matchCategory: text("match_category").notNull(),
    matchScore: integer("match_score").notNull(),
    matchedMaterialCode: text("matched_material_code"),
    status: text("status").notNull(),
    requiresHumanReview: boolean("requires_human_review").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    ...mutableColumns,
  },
  (table) => [
    uniqueIndex("position_result_run_position_uq").on(table.runId, table.positionId),
    index("position_result_user_run_idx").on(table.userId, table.runId),
  ],
);

export const analysisReviewDecisions = pgTable(
  "analysis_review_decisions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    runId: text("run_id").notNull().references(() => scenarioRuns.id),
    resultId: text("result_id").notNull().references(() => positionAnalysisResults.id),
    positionId: text("position_id").notNull(),
    doublecheckOutcome: text("doublecheck_outcome").notNull(),
    status: text("status").notNull(),
    agentEvidence: jsonb("agent_evidence").$type<Record<string, unknown>>().notNull(),
    independentEvidence: jsonb("independent_evidence").$type<Record<string, unknown>>().notNull(),
    decisionReason: text("decision_reason"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "string" }),
    ...mutableColumns,
  },
  (table) => [
    uniqueIndex("analysis_review_run_position_uq").on(table.userId, table.runId, table.positionId),
    index("analysis_review_user_status_idx").on(table.userId, table.status),
  ],
);

export const agentThreads = pgTable(
  "agent_threads",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    title: text("title").notNull(),
    ...mutableColumns,
  },
  (table) => [index("agent_threads_user_idx").on(table.userId)],
);

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull().references(() => agentThreads.id),
    userId: text("user_id").notNull().references(() => users.id),
    role: text("role").notNull(),
    content: text("content").notNull(),
    structuredOutput: jsonb("structured_output").$type<Record<string, unknown>>(),
    promptVersion: text("prompt_version"),
    ...mutableColumns,
  },
  (table) => [index("agent_messages_user_thread_idx").on(table.userId, table.threadId)],
);

export const agentCitations = pgTable(
  "agent_citations",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id").notNull().references(() => agentMessages.id),
    userId: text("user_id").notNull().references(() => users.id),
    sourceSystem: text("source_system").notNull(),
    entityId: text("entity_id").notNull(),
    versionOrSnapshot: text("version_or_snapshot").notNull(),
    clauseId: text("clause_id"),
    ...mutableColumns,
  },
  (table) => [index("agent_citations_user_message_idx").on(table.userId, table.messageId)],
);

export const agentCases = pgTable(
  "agent_cases",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    projectId: text("project_id").notNull(),
    ownerUserId: text("owner_user_id").notNull().references(() => users.id),
    threadId: text("thread_id").references(() => agentThreads.id, { onDelete: "set null" }),
    status: text("status").notNull(),
    title: text("title").notNull(),
    contextSnapshot: jsonb("context_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    authorizationVersion: integer("authorization_version").notNull(),
    roleAssignmentSnapshot: jsonb("role_assignment_snapshot")
      .$type<string[]>()
      .notNull()
      .default([]),
    createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
    ...durableAgentColumns,
  },
  (table) => [
    unique("agent_cases_scope_uq").on(table.id, table.tenantId, table.projectId),
    index("agent_cases_tenant_project_status_idx").on(
      table.tenantId,
      table.projectId,
      table.status,
    ),
    index("agent_cases_owner_updated_idx").on(table.ownerUserId, table.updatedAt),
    index("agent_cases_retention_idx").on(table.retentionUntil),
    check(
      "agent_cases_status_check",
      sql`${table.status} in ('DRAFT','GATHERING_DATA','ANALYZED','NEEDS_REVIEW','READY','BLOCKED','CLOSED')`,
    ),
    check("agent_cases_auth_version_check", sql`${table.authorizationVersion} > 0`),
    check(
      "agent_cases_context_json_check",
      sql`jsonb_typeof(${table.contextSnapshot}) = 'object'`,
    ),
    check(
      "agent_cases_role_snapshot_json_check",
      sql`jsonb_typeof(${table.roleAssignmentSnapshot}) = 'array'`,
    ),
    check(
      "agent_cases_retention_check",
      sql`${table.retentionUntil} >= ${table.createdAt} + interval '1 year'`,
    ),
  ],
);

export const agentEvidenceFacts = pgTable(
  "agent_evidence_facts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    projectId: text("project_id").notNull(),
    caseId: text("case_id").notNull(),
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    sourceSystem: text("source_system").notNull(),
    entityId: text("entity_id").notNull(),
    versionOrSnapshot: text("version_or_snapshot").notNull(),
    clauseId: text("clause_id"),
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "string" }).notNull(),
    sourceSnapshotAt: timestamp("source_snapshot_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    freshness: text("freshness").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    accessAttributes: jsonb("access_attributes")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    fingerprint: text("fingerprint").notNull(),
    authorizationVersion: integer("authorization_version").notNull(),
    roleAssignmentSnapshot: jsonb("role_assignment_snapshot")
      .$type<string[]>()
      .notNull()
      .default([]),
    createdByUserId: text("created_by_user_id").notNull().references(() => users.id),
    ...durableAgentColumns,
  },
  (table) => [
    foreignKey({
      columns: [table.caseId, table.tenantId, table.projectId],
      foreignColumns: [agentCases.id, agentCases.tenantId, agentCases.projectId],
      name: "agent_evidence_case_scope_fk",
    }).onDelete("cascade"),
    uniqueIndex("agent_evidence_case_fingerprint_uq").on(
      table.tenantId,
      table.caseId,
      table.fingerprint,
    ),
    index("agent_evidence_tenant_project_case_idx").on(
      table.tenantId,
      table.projectId,
      table.caseId,
    ),
    index("agent_evidence_source_entity_idx").on(
      table.tenantId,
      table.sourceSystem,
      table.entityId,
    ),
    index("agent_evidence_retention_idx").on(table.retentionUntil),
    check(
      "agent_evidence_freshness_check",
      sql`${table.freshness} in ('FRESH','AGING','STALE','UNKNOWN')`,
    ),
    check("agent_evidence_auth_version_check", sql`${table.authorizationVersion} > 0`),
    check("agent_evidence_payload_json_check", sql`jsonb_typeof(${table.payload}) = 'object'`),
    check(
      "agent_evidence_access_json_check",
      sql`jsonb_typeof(${table.accessAttributes}) = 'object'`,
    ),
    check(
      "agent_evidence_role_snapshot_json_check",
      sql`jsonb_typeof(${table.roleAssignmentSnapshot}) = 'array'`,
    ),
    check(
      "agent_evidence_snapshot_time_check",
      sql`${table.sourceSnapshotAt} <= ${table.observedAt}`,
    ),
    check(
      "agent_evidence_retention_check",
      sql`${table.retentionUntil} >= ${table.createdAt} + interval '1 year'`,
    ),
  ],
);

export const agentPlanExecutions = pgTable(
  "agent_plan_executions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    projectId: text("project_id").notNull(),
    caseId: text("case_id").notNull(),
    actorUserId: text("actor_user_id").notNull().references(() => users.id),
    intent: text("intent").notNull(),
    commandKey: text("command_key"),
    status: text("status").notNull(),
    planVersion: text("plan_version").notNull(),
    steps: jsonb("steps").$type<Array<Record<string, unknown>>>().notNull().default([]),
    currentStep: integer("current_step").notNull().default(0),
    maxSteps: integer("max_steps").notNull().default(8),
    correlationId: text("correlation_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    authorizationVersion: integer("authorization_version").notNull(),
    roleAssignmentSnapshot: jsonb("role_assignment_snapshot")
      .$type<string[]>()
      .notNull()
      .default([]),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    safeErrorCode: text("safe_error_code"),
    ...durableAgentColumns,
  },
  (table) => [
    unique("agent_plan_scope_uq").on(table.id, table.tenantId, table.projectId),
    foreignKey({
      columns: [table.caseId, table.tenantId, table.projectId],
      foreignColumns: [agentCases.id, agentCases.tenantId, agentCases.projectId],
      name: "agent_plan_case_scope_fk",
    }).onDelete("cascade"),
    uniqueIndex("agent_plan_idempotency_uq").on(
      table.tenantId,
      table.projectId,
      table.idempotencyKey,
    ),
    index("agent_plan_status_created_idx").on(
      table.tenantId,
      table.projectId,
      table.status,
      table.createdAt,
    ),
    index("agent_plan_correlation_idx").on(table.tenantId, table.correlationId),
    index("agent_plan_retention_idx").on(table.retentionUntil),
    check(
      "agent_plan_status_check",
      sql`${table.status} in ('PLANNED','RUNNING','SUCCEEDED','PARTIAL','FAILED','CANCELLED','EXPIRED')`,
    ),
    check(
      "agent_plan_step_bounds_check",
      sql`${table.maxSteps} between 1 and 20 and ${table.currentStep} between 0 and ${table.maxSteps}`,
    ),
    check("agent_plan_auth_version_check", sql`${table.authorizationVersion} > 0`),
    check("agent_plan_steps_json_check", sql`jsonb_typeof(${table.steps}) = 'array'`),
    check(
      "agent_plan_role_snapshot_json_check",
      sql`jsonb_typeof(${table.roleAssignmentSnapshot}) = 'array'`,
    ),
    check(
      "agent_plan_completion_time_check",
      sql`${table.completedAt} is null or ${table.startedAt} is null or ${table.completedAt} >= ${table.startedAt}`,
    ),
    check(
      "agent_plan_retention_check",
      sql`${table.retentionUntil} >= ${table.createdAt} + interval '1 year'`,
    ),
  ],
);

export const agentTasks = pgTable(
  "agent_tasks",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    projectId: text("project_id").notNull(),
    caseId: text("case_id"),
    reviewDecisionId: text("review_decision_id").references(() => analysisReviewDecisions.id, {
      onDelete: "set null",
    }),
    assigneeUserId: text("assignee_user_id").notNull().references(() => users.id),
    assignedByUserId: text("assigned_by_user_id").notNull().references(() => users.id),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    priority: text("priority").notNull(),
    title: text("title").notNull(),
    reason: text("reason").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    allowedActions: jsonb("allowed_actions").$type<string[]>().notNull().default([]),
    assignmentHistory: jsonb("assignment_history")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    idempotencyKey: text("idempotency_key").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true, mode: "string" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "string" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    authorizationVersion: integer("authorization_version").notNull(),
    roleAssignmentSnapshot: jsonb("role_assignment_snapshot")
      .$type<string[]>()
      .notNull()
      .default([]),
    ...durableAgentColumns,
  },
  (table) => [
    foreignKey({
      columns: [table.caseId, table.tenantId, table.projectId],
      foreignColumns: [agentCases.id, agentCases.tenantId, agentCases.projectId],
      name: "agent_tasks_case_scope_fk",
    }),
    uniqueIndex("agent_tasks_idempotency_uq").on(
      table.tenantId,
      table.projectId,
      table.idempotencyKey,
    ),
    index("agent_tasks_assignee_status_due_idx").on(
      table.tenantId,
      table.assigneeUserId,
      table.status,
      table.dueAt,
    ),
    index("agent_tasks_project_priority_idx").on(
      table.tenantId,
      table.projectId,
      table.priority,
      table.status,
    ),
    index("agent_tasks_retention_idx").on(table.retentionUntil),
    check(
      "agent_tasks_kind_check",
      sql`${table.kind} in ('ANALYSIS_REVIEW','EXPERT_REVIEW','DATA_CLARIFICATION','TECHNICAL')`,
    ),
    check(
      "agent_tasks_status_check",
      sql`${table.status} in ('AWAITING_ACCEPTANCE','IN_PROGRESS','REQUIRES_DECISION','RETURNED_FOR_CLARIFICATION','COMPLETED','CANCELLED')`,
    ),
    check(
      "agent_tasks_priority_check",
      sql`${table.priority} in ('LOW','NORMAL','HIGH','CRITICAL')`,
    ),
    check("agent_tasks_auth_version_check", sql`${table.authorizationVersion} > 0`),
    check(
      "agent_tasks_allowed_actions_json_check",
      sql`jsonb_typeof(${table.allowedActions}) = 'array'`,
    ),
    check(
      "agent_tasks_assignment_history_json_check",
      sql`jsonb_typeof(${table.assignmentHistory}) = 'array'`,
    ),
    check(
      "agent_tasks_role_snapshot_json_check",
      sql`jsonb_typeof(${table.roleAssignmentSnapshot}) = 'array'`,
    ),
    check(
      "agent_tasks_completion_time_check",
      sql`${table.completedAt} is null or ${table.completedAt} >= ${table.createdAt}`,
    ),
    check(
      "agent_tasks_retention_check",
      sql`${table.retentionUntil} >= ${table.createdAt} + interval '1 year'`,
    ),
  ],
);

export const agentActionProposals = pgTable(
  "agent_action_proposals",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    projectId: text("project_id").notNull(),
    caseId: text("case_id").notNull(),
    planExecutionId: text("plan_execution_id"),
    proposedByUserId: text("proposed_by_user_id").notNull().references(() => users.id),
    actionType: text("action_type").notNull(),
    status: text("status").notNull(),
    resourceDescriptor: jsonb("resource_descriptor")
      .$type<Record<string, unknown>>()
      .notNull(),
    requiredPermission: text("required_permission").notNull(),
    summary: text("summary").notNull(),
    consequences: jsonb("consequences").$type<string[]>().notNull().default([]),
    parameters: jsonb("parameters").$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb("result").$type<Record<string, unknown>>(),
    idempotencyKey: text("idempotency_key").notNull(),
    authorizationVersion: integer("authorization_version").notNull(),
    roleAssignmentSnapshot: jsonb("role_assignment_snapshot")
      .$type<string[]>()
      .notNull()
      .default([]),
    confirmationAuthorizationVersion: integer("confirmation_authorization_version"),
    confirmationRoleAssignmentSnapshot: jsonb("confirmation_role_assignment_snapshot")
      .$type<string[]>(),
    proposedAt: timestamp("proposed_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "string" }),
    executionStartedAt: timestamp("execution_started_at", {
      withTimezone: true,
      mode: "string",
    }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    safeErrorCode: text("safe_error_code"),
    correlationId: text("correlation_id").notNull(),
    ...durableAgentColumns,
  },
  (table) => [
    foreignKey({
      columns: [table.caseId, table.tenantId, table.projectId],
      foreignColumns: [agentCases.id, agentCases.tenantId, agentCases.projectId],
      name: "agent_actions_case_scope_fk",
    }),
    foreignKey({
      columns: [table.planExecutionId, table.tenantId, table.projectId],
      foreignColumns: [
        agentPlanExecutions.id,
        agentPlanExecutions.tenantId,
        agentPlanExecutions.projectId,
      ],
      name: "agent_actions_plan_scope_fk",
    }),
    uniqueIndex("agent_actions_idempotency_uq").on(
      table.tenantId,
      table.projectId,
      table.idempotencyKey,
    ),
    index("agent_actions_actor_status_idx").on(
      table.tenantId,
      table.proposedByUserId,
      table.status,
      table.createdAt,
    ),
    index("agent_actions_project_status_idx").on(
      table.tenantId,
      table.projectId,
      table.status,
      table.expiresAt,
    ),
    index("agent_actions_retention_idx").on(table.retentionUntil),
    check(
      "agent_actions_type_check",
      sql`${table.actionType} in ('RUN_SCENARIO','RETRY_SCENARIO','CREATE_REVIEW_TASK','PREPARE_REPORT_DRAFT','PREPARE_EXPORT_DRAFT')`,
    ),
    check(
      "agent_actions_status_check",
      sql`${table.status} in ('PROPOSED','CONFIRMED','EXECUTING','SUCCEEDED','FAILED','EXPIRED','CANCELLED')`,
    ),
    check("agent_actions_auth_version_check", sql`${table.authorizationVersion} > 0`),
    check(
      "agent_actions_confirm_auth_version_check",
      sql`${table.confirmationAuthorizationVersion} is null or ${table.confirmationAuthorizationVersion} > 0`,
    ),
    check(
      "agent_actions_resource_json_check",
      sql`jsonb_typeof(${table.resourceDescriptor}) = 'object'`,
    ),
    check(
      "agent_actions_consequences_json_check",
      sql`jsonb_typeof(${table.consequences}) = 'array'`,
    ),
    check(
      "agent_actions_parameters_json_check",
      sql`jsonb_typeof(${table.parameters}) = 'object'`,
    ),
    check(
      "agent_actions_result_json_check",
      sql`${table.result} is null or jsonb_typeof(${table.result}) = 'object'`,
    ),
    check(
      "agent_actions_role_snapshot_json_check",
      sql`jsonb_typeof(${table.roleAssignmentSnapshot}) = 'array'`,
    ),
    check(
      "agent_actions_confirm_role_json_check",
      sql`${table.confirmationRoleAssignmentSnapshot} is null or jsonb_typeof(${table.confirmationRoleAssignmentSnapshot}) = 'array'`,
    ),
    check(
      "agent_actions_expiry_check",
      sql`${table.expiresAt} > ${table.proposedAt}`,
    ),
    check(
      "agent_actions_confirmation_check",
      sql`${table.status} in ('PROPOSED','CANCELLED','EXPIRED') or (${table.confirmedAt} is not null and ${table.confirmationAuthorizationVersion} is not null and ${table.confirmationRoleAssignmentSnapshot} is not null)`,
    ),
    check(
      "agent_actions_retention_check",
      sql`${table.retentionUntil} >= ${table.createdAt} + interval '1 year'`,
    ),
  ],
);

export const agentEventInbox = pgTable(
  "agent_event_inbox",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    projectId: text("project_id").notNull(),
    actorUserId: text("actor_user_id").references(() => users.id),
    sourceSystem: text("source_system").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    availableAt: timestamp("available_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "string" }),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "string" }),
    safeErrorCode: text("safe_error_code"),
    correlationId: text("correlation_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    authorizationVersion: integer("authorization_version"),
    roleAssignmentSnapshot: jsonb("role_assignment_snapshot")
      .$type<string[]>()
      .notNull()
      .default([]),
    ...durableAgentColumns,
  },
  (table) => [
    uniqueIndex("agent_inbox_source_event_uq").on(
      table.tenantId,
      table.sourceSystem,
      table.sourceEventId,
    ),
    uniqueIndex("agent_inbox_idempotency_uq").on(table.tenantId, table.idempotencyKey),
    index("agent_inbox_dispatch_idx").on(table.status, table.availableAt, table.attempts),
    index("agent_inbox_project_event_idx").on(
      table.tenantId,
      table.projectId,
      table.eventType,
      table.receivedAt,
    ),
    index("agent_inbox_retention_idx").on(table.retentionUntil),
    check(
      "agent_inbox_status_check",
      sql`${table.status} in ('PENDING','PROCESSING','PROCESSED','FAILED','DEAD_LETTER')`,
    ),
    check(
      "agent_inbox_attempts_check",
      sql`${table.maxAttempts} between 1 and 25 and ${table.attempts} between 0 and ${table.maxAttempts}`,
    ),
    check(
      "agent_inbox_auth_version_check",
      sql`${table.authorizationVersion} is null or ${table.authorizationVersion} > 0`,
    ),
    check("agent_inbox_payload_json_check", sql`jsonb_typeof(${table.payload}) = 'object'`),
    check(
      "agent_inbox_role_snapshot_json_check",
      sql`jsonb_typeof(${table.roleAssignmentSnapshot}) = 'array'`,
    ),
    check(
      "agent_inbox_processed_time_check",
      sql`${table.processedAt} is null or ${table.processedAt} >= ${table.receivedAt}`,
    ),
    check(
      "agent_inbox_retention_check",
      sql`${table.retentionUntil} >= ${table.createdAt} + interval '1 year'`,
    ),
  ],
);

export const agentProactiveInsights = pgTable(
  "agent_proactive_insights",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    projectId: text("project_id").notNull(),
    caseId: text("case_id"),
    subjectUserId: text("subject_user_id").references(() => users.id),
    triggerType: text("trigger_type").notNull(),
    stateVersion: text("state_version").notNull(),
    level: text("level").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    recommendedAction: text("recommended_action").notNull(),
    evidenceFactIds: jsonb("evidence_fact_ids").$type<string[]>().notNull().default([]),
    deduplicationKey: text("deduplication_key").notNull(),
    ruleVersion: text("rule_version").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    cooldownUntil: timestamp("cooldown_until", { withTimezone: true, mode: "string" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true, mode: "string" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
    authorizationVersion: integer("authorization_version").notNull(),
    roleAssignmentSnapshot: jsonb("role_assignment_snapshot")
      .$type<string[]>()
      .notNull()
      .default([]),
    createdByUserId: text("created_by_user_id").references(() => users.id),
    ...durableAgentColumns,
  },
  (table) => [
    foreignKey({
      columns: [table.caseId, table.tenantId, table.projectId],
      foreignColumns: [agentCases.id, agentCases.tenantId, agentCases.projectId],
      name: "agent_insights_case_scope_fk",
    }),
    uniqueIndex("agent_insights_deduplication_uq").on(
      table.tenantId,
      table.projectId,
      table.deduplicationKey,
    ),
    index("agent_insights_subject_status_idx").on(
      table.tenantId,
      table.subjectUserId,
      table.status,
      table.level,
    ),
    index("agent_insights_project_last_seen_idx").on(
      table.tenantId,
      table.projectId,
      table.lastSeenAt,
    ),
    index("agent_insights_retention_idx").on(table.retentionUntil),
    check(
      "agent_insights_trigger_check",
      sql`${table.triggerType} in ('APPIUS_VERSION_PUBLISHED','SAP_SNAPSHOT_RECEIVED','RISK_LEVEL_RAISED','DUE_DATE_APPROACHING','SLA_BREACHED','SCENARIO_COMPLETED','SCENARIO_FAILED','INTEGRATION_RECOVERED')`,
    ),
    check(
      "agent_insights_level_check",
      sql`${table.level} in ('LOW','MEDIUM','HIGH','CRITICAL')`,
    ),
    check(
      "agent_insights_status_check",
      sql`${table.status} in ('ACTIVE','ACKNOWLEDGED','RESOLVED','EXPIRED','SUPPRESSED')`,
    ),
    check("agent_insights_auth_version_check", sql`${table.authorizationVersion} > 0`),
    check(
      "agent_insights_evidence_json_check",
      sql`jsonb_typeof(${table.evidenceFactIds}) = 'array'`,
    ),
    check(
      "agent_insights_role_snapshot_json_check",
      sql`jsonb_typeof(${table.roleAssignmentSnapshot}) = 'array'`,
    ),
    check(
      "agent_insights_seen_time_check",
      sql`${table.lastSeenAt} >= ${table.firstSeenAt}`,
    ),
    check(
      "agent_insights_retention_check",
      sql`${table.retentionUntil} >= ${table.createdAt} + interval '1 year'`,
    ),
  ],
);

export const agentMetricEvents = pgTable(
  "agent_metric_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    projectId: text("project_id").notNull(),
    actorUserId: text("actor_user_id").references(() => users.id),
    eventType: text("event_type").notNull(),
    eventVersion: integer("event_version").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    specificationId: text("specification_id"),
    runId: text("run_id"),
    taskId: text("task_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    correlationId: text("correlation_id").notNull(),
    sourceVersion: text("source_version").notNull(),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text("idempotency_key").notNull(),
    authorizationVersion: integer("authorization_version"),
    roleAssignmentSnapshot: jsonb("role_assignment_snapshot")
      .$type<string[]>()
      .notNull()
      .default([]),
    ingestedAt: timestamp("ingested_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    retentionUntil: timestamp("retention_until", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now() + interval '1 year'`),
  },
  (table) => [
    uniqueIndex("agent_metric_event_idempotency_uq").on(
      table.tenantId,
      table.projectId,
      table.idempotencyKey,
    ),
    uniqueIndex("agent_metric_aggregate_version_uq").on(
      table.tenantId,
      table.projectId,
      table.aggregateType,
      table.aggregateId,
      table.eventVersion,
    ),
    index("agent_metric_project_event_time_idx").on(
      table.tenantId,
      table.projectId,
      table.eventType,
      table.occurredAt,
    ),
    index("agent_metric_correlation_idx").on(table.tenantId, table.correlationId),
    index("agent_metric_retention_idx").on(table.retentionUntil),
    check(
      "agent_metric_event_type_check",
      sql`${table.eventType} in ('SPECIFICATION_UPLOADED','ANALYSIS_STARTED','ANALYSIS_STEP_STARTED','ANALYSIS_STEP_COMPLETED','ANALYSIS_COMPLETED','EXPERT_TASK_ASSIGNED','EXPERT_DECISION_RECORDED','SHORTAGE_DETECTED','SHORTAGE_ACTION_ACCEPTED','REPORT_PUBLISHED','PROCESS_FAILED')`,
    ),
    check(
      "agent_metric_aggregate_type_check",
      sql`${table.aggregateType} in ('SPECIFICATION','RUN','ANALYSIS_STEP','EXPERT_TASK','SHORTAGE','REPORT')`,
    ),
    check("agent_metric_event_version_check", sql`${table.eventVersion} > 0`),
    check(
      "agent_metric_auth_version_check",
      sql`${table.authorizationVersion} is null or ${table.authorizationVersion} > 0`,
    ),
    check("agent_metric_attributes_json_check", sql`jsonb_typeof(${table.attributes}) = 'object'`),
    check(
      "agent_metric_role_snapshot_json_check",
      sql`jsonb_typeof(${table.roleAssignmentSnapshot}) = 'array'`,
    ),
    check(
      "agent_metric_retention_check",
      sql`${table.retentionUntil} >= ${table.ingestedAt} + interval '1 year'`,
    ),
  ],
);

export const materialMovements = pgTable(
  "material_movements",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    projectId: text("project_id").notNull(),
    sourceScopeId: text("source_scope_id").notNull(),
    materialCode: text("material_code").notNull(),
    plant: text("plant").notNull(),
    storageLocation: text("storage_location").notNull(),
    movementType: text("movement_type").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 3 }).notNull(),
    unit: text("unit").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    sourceDocumentId: text("source_document_id").notNull(),
    snapshotVersion: text("snapshot_version").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    authorizationVersion: integer("authorization_version"),
    roleAssignmentSnapshot: jsonb("role_assignment_snapshot")
      .$type<string[]>()
      .notNull()
      .default([]),
    ingestedAt: timestamp("ingested_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    retentionUntil: timestamp("retention_until", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now() + interval '1 year'`),
  },
  (table) => [
    uniqueIndex("material_movements_idempotency_uq").on(table.tenantId, table.idempotencyKey),
    index("material_movements_project_material_idx").on(
      table.tenantId,
      table.projectId,
      table.materialCode,
      table.occurredAt,
    ),
    index("material_movements_warehouse_time_idx").on(
      table.tenantId,
      table.sourceScopeId,
      table.plant,
      table.storageLocation,
      table.occurredAt,
    ),
    index("material_movements_retention_idx").on(table.retentionUntil),
    check(
      "material_movements_type_check",
      sql`${table.movementType} in ('RECEIPT','CONSUMPTION','TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT')`,
    ),
    check(
      "material_movements_quantity_check",
      sql`${table.movementType} = 'ADJUSTMENT' or ${table.quantity} >= 0`,
    ),
    check(
      "material_movements_auth_version_check",
      sql`${table.authorizationVersion} is null or ${table.authorizationVersion} > 0`,
    ),
    check(
      "material_movements_attributes_json_check",
      sql`jsonb_typeof(${table.attributes}) = 'object'`,
    ),
    check(
      "material_movements_role_snapshot_json_check",
      sql`jsonb_typeof(${table.roleAssignmentSnapshot}) = 'array'`,
    ),
    check(
      "material_movements_retention_check",
      sql`${table.retentionUntil} >= ${table.ingestedAt} + interval '1 year'`,
    ),
  ],
);

export const promptVersions = pgTable(
  "prompt_versions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    promptVersion: text("prompt_version").notNull(),
    content: text("content").notNull(),
    active: boolean("active").notNull().default(false),
    checksum: text("checksum").notNull(),
    ...mutableColumns,
  },
  (table) => [uniqueIndex("prompt_version_uq").on(table.userId, table.name, table.promptVersion)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    actorDisplayName: text("actor_display_name").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    outcome: text("outcome").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    retentionUntil: timestamp("retention_until", { withTimezone: true, mode: "string" }).notNull(),
    requestId: text("request_id"),
  },
  (table) => [index("audit_user_occurred_idx").on(table.userId, table.occurredAt)],
);

export const uploadedFiles = pgTable(
  "uploaded_files",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    originalName: text("original_name").notNull(),
    safeName: text("safe_name").notNull(),
    extension: text("extension").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    storageUrl: text("storage_url").notNull(),
    parseStatus: text("parse_status").notNull(),
    normalizedData: jsonb("normalized_data").$type<Record<string, unknown>>(),
    ...mutableColumns,
  },
  (table) => [index("uploaded_files_user_idx").on(table.userId)],
);

export const dictionaries = pgTable(
  "dictionaries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    dictionaryType: text("dictionary_type").notNull(),
    key: text("key").notNull(),
    values: jsonb("values").$type<string[]>().notNull(),
    active: boolean("active").notNull().default(true),
    ...mutableColumns,
  },
  (table) => [uniqueIndex("dictionary_key_uq").on(table.userId, table.dictionaryType, table.key)],
);

export const schema = {
  users,
  authSessions,
  specifications,
  specificationVersions,
  specificationPositions,
  sapMaterials,
  sapStockBalances,
  catalogInterchangeabilityFamilies,
  catalogItems,
  catalogStockBalances,
  catalogBomComponents,
  normativeDocuments,
  normativeChunks,
  responsibilityRules,
  analogueRules,
  integrationStates,
  scenarios,
  scenarioRuns,
  scenarioRunSteps,
  positionAnalysisResults,
  analysisReviewDecisions,
  agentThreads,
  agentMessages,
  agentCitations,
  agentCases,
  agentEvidenceFacts,
  agentPlanExecutions,
  agentTasks,
  agentActionProposals,
  agentEventInbox,
  agentProactiveInsights,
  agentMetricEvents,
  materialMovements,
  promptVersions,
  auditLogs,
  uploadedFiles,
  dictionaries,
};
