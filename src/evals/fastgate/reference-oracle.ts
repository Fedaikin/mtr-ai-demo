import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { initializeDatabase } from "@/adapters/persistence/bootstrap";
import { getDatabase } from "@/adapters/persistence/db";
import {
  createFastGateDatabaseStateSnapshot,
  type FastGateActionSafetyState,
  type FastGateDatabaseStateSnapshot,
  type FastGateReviewSafetyState,
} from "@/evals/fastgate/official/database-state";
import type { FastGateOracleMaterial, FastGateOracleSnapshot } from "@/evals/fastgate/types";

export async function buildLocalFastGateOracle(deploymentSha: string): Promise<FastGateOracleSnapshot> {
  if (process.env.DATABASE_URL?.trim()) throw new Error("FASTGATE_LOCAL_ORACLE_REMOTE_DATABASE_FORBIDDEN");
  if (!process.env.PGLITE_DATA_DIR?.trim()) throw new Error("FASTGATE_LOCAL_ORACLE_DATA_DIR_REQUIRED");
  await initializeDatabase();
  const db = await getDatabase({ migrations: "skip" });
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    const projects = rows(await tx.execute(sql`
      select id, code, name, status, access_project_id, need_date
      from business_projects order by id
    `)).map((row) => ({
      id: text(row.id), code: text(row.code), name: text(row.name), status: text(row.status), accessProjectId: text(row.access_project_id), needDate: timestamp(row.need_date),
    }));
    const specifications = rows(await tx.execute(sql`
      select specification_id as id, business_project_id, specification_id as code, name, purpose
      from business_project_specifications order by specification_id
    `)).map((row) => ({
      id: text(row.id), projectId: text(row.business_project_id), code: text(row.code), name: text(row.name), purpose: text(row.purpose),
    }));
    const materialRows = rows(await tx.execute(sql`
      select omv.material_code, ci.name_ru, omv.source_kind, omv.family_id, omv.equipment_type, omv.item_kind, omv.unit,
             ci.standard, ci.material_grade, ci.manufacturer, ci.characteristics,
             omv.pack_size, omv.safety_stock, omv.stock, omv.inbound_supplies, omv.weekly_movements, omv.reliability
      from operational_material_views omv
      join catalog_items ci on ci.id=omv.catalog_item_id and ci.user_id=omv.owner_user_id
      order by omv.material_code
    `));
    const materials = materialRows.map(materialFromRow);
    const positionRows = rows(await tx.execute(sql`
      select bpp.business_project_id, omv.material_code, sum(bpp.required_quantity)::text as required, bpp.unit
      from business_project_positions bpp
      join operational_material_views omv on omv.tenant_id=bpp.tenant_id and omv.id=bpp.operational_material_view_id
      group by bpp.business_project_id, omv.material_code, bpp.unit
      order by bpp.business_project_id, omv.material_code
    `));
    const allocationRows = rows(await tx.execute(sql`
      select business_project_id, material_code, sum(quantity)::text as quantity
      from project_material_allocations group by business_project_id, material_code
    `));
    const shortages = positionRows.map((row) => {
      const required = numeric(row.required);
      const raw = materialRows.find((item) => text(item.material_code) === text(row.material_code));
      const stock = record(raw?.stock);
      const inbound = array(raw?.inbound_supplies).map(record);
      const movements = array(raw?.weekly_movements).map(record);
      const project = projects.find((item) => item.id === text(row.business_project_id));
      const otherAllocations = allocationRows.filter((item) => text(item.material_code) === text(row.material_code) && text(item.business_project_id) !== text(row.business_project_id)).reduce((sum, item) => sum + numeric(item.quantity), 0);
      const onHand = numeric(stock.onHandQuantity);
      const available = Math.max(0, onHand - numeric(stock.reservedQuantity) - numeric(stock.quarantinedQuantity) - numeric(stock.committedToOtherNeeds) - otherAllocations);
      const inboundBeforeNeed = inbound.filter((item) => project && Date.parse(timestamp(item.promisedAt)) <= Date.parse(project.needDate)).reduce((sum, item) => sum + numeric(item.confirmedQuantity), 0);
      const averageWeekly = movements.length ? Math.ceil(movements.reduce((sum, item) => sum + numeric(item.consumptionQuantity), 0) / movements.length) : 0;
      const daysToExhaustion = averageWeekly <= 0 ? null : Math.floor(available / (averageWeekly / 7));
      const weeksToNeed = project ? Math.max(0, Math.ceil((Date.parse(project.needDate) - Date.now()) / 604_800_000)) : 0;
      const requiredAtNeed = required + averageWeekly * weeksToNeed + numeric(raw?.safety_stock);
      const shortage = Math.max(0, requiredAtNeed - (available + inboundBeforeNeed));
      return {
        projectId: text(row.business_project_id), materialCode: text(row.material_code), required: requiredAtNeed,
        available, shortage, unit: text(row.unit),
        riskLabel: shortage > 0 ? "Дефицит" as const : daysToExhaustion !== null && daysToExhaustion <= 30 ? "Исчерпание" as const : "Контроль" as const,
      };
    });
    const intakes = rows(await tx.execute(sql`
      select id, business_project_id, status, current_step, received_at, sla_deadline
      from specification_intake_items order by id
    `)).map((row) => ({
      id: text(row.id), projectId: text(row.business_project_id), status: text(row.status), currentStep: text(row.current_step),
      receivedAt: timestamp(row.received_at), slaDeadline: timestamp(row.sla_deadline),
    }));
    const deadlines = rows(await tx.execute(sql`
      select business_project_id, due_at, status from business_project_deadlines order by due_at, id
    `)).map((row) => ({ projectId: text(row.business_project_id), dueAt: timestamp(row.due_at), status: text(row.status) }));
    const analoguePairs = chooseAnaloguePairs(materials);
    const roleProfiles = await readRoleProfiles(tx);
    const activeProjectIdsBySubject = await readActiveProjects(tx);
    const accessibleProjectIdsBySubject = await readAccessibleProjects(tx);
    const lastRunRows = rows(await tx.execute(sql`
      select id from scenario_runs where user_id='demo-user-001' and status='COMPLETED'
      order by completed_at desc nulls last, id desc limit 1
    `));
    const lastCompletedRun = lastRunRows[0] ? await readCompletedRun(tx, text(lastRunRows[0].id)) : null;
    const prompt = rows(await tx.execute(sql`
      select prompt_version from prompt_versions where user_id='demo-user-001' and active=true
      order by updated_at desc limit 1
    `))[0];
    const datasetVersion = text(rows(await tx.execute(sql`
      select dataset_version from business_projects order by dataset_version desc limit 1
    `))[0]?.dataset_version || "UNKNOWN");
    const databaseState = await readDatabaseState(tx);
    const targetState = rows(await tx.execute(sql`
      select u.id, u.login, u.password_hash, u.display_name, u.roles, u.status,
             u.account_type, u.auth_source, u.external_subject_id, u.authorization_version,
             u.is_synthetic_demo,
             coalesce(jsonb_agg(jsonb_build_object(
               'id',ra.id,'role',r.key,'scope',ra.scope_type,'status',ra.status,'project',ra.project_id
             ) order by ra.id) filter (where ra.id is not null),'[]'::jsonb) as assignments
      from users u left join role_assignments ra on ra.user_id=u.id left join roles r on r.id=ra.role_id
      group by u.id,u.login,u.password_hash,u.display_name,u.roles,u.status,u.account_type,u.auth_source,
               u.external_subject_id,u.authorization_version,u.is_synthetic_demo
      order by u.id
    `));
    const targetStateChecksum = checksum(targetState);
    const actionSafetyState = await readActionSafetyState(tx);
    const reviewSafetyState = await readReviewSafetyState(tx);
    const dataProjection = { projects, specifications, materials, shortages, intakes, deadlines, analoguePairs, activeProjectIdsBySubject, accessibleProjectIdsBySubject, lastCompletedRun };
    return {
      schemaVersion: "mtr-agent-fastgate-oracle-v1",
      createdAt: new Date().toISOString(),
      environment: "LOCAL_TEST",
      deploymentSha,
      datasetVersion,
      datasetChecksum: checksum({ datasetVersion, projects, specifications }),
      promptVersion: text(prompt?.prompt_version || "UNKNOWN"),
      activeProjectIdsBySubject,
      accessibleProjectIdsBySubject,
      projects,
      specifications,
      materials,
      shortages,
      intakes,
      deadlines,
      analoguePairs,
      roleProfiles,
      lastCompletedRun,
      targetStateChecksum,
      dataChecksum: checksum(dataProjection),
      databaseState,
      actionSafetyState,
      reviewSafetyState,
    };
  });
}

async function readDatabaseState(tx: Queryable): Promise<FastGateDatabaseStateSnapshot> {
  const tableNames = rows(await tx.execute(sql`
    select tablename
    from pg_catalog.pg_tables
    where schemaname = 'public'
    order by tablename
  `)).map((row) => text(row.tablename)).filter((name) => /^[a-z_][a-z0-9_]*$/u.test(name));
  const tables = [];
  for (const tableName of tableNames) {
    const values = rows(await tx.execute(sql.raw(
      `select to_jsonb(t) as value from "${tableName}" t order by to_jsonb(t)::text`,
    ))).map((row) => row.value);
    tables.push({ tableName, rows: values });
  }
  return createFastGateDatabaseStateSnapshot(tables);
}

async function readActionSafetyState(tx: Queryable): Promise<readonly FastGateActionSafetyState[]> {
  return rows(await tx.execute(sql`
    select id, status, result is not null as result_present,
           confirmed_at, execution_started_at, completed_at, cancelled_at
    from agent_action_proposals
    order by id
  `)).map((row) => Object.freeze({
    id: text(row.id),
    status: text(row.status),
    resultPresent: row.result_present === true,
    confirmedAt: row.confirmed_at ? timestamp(row.confirmed_at) : null,
    executionStartedAt: row.execution_started_at ? timestamp(row.execution_started_at) : null,
    completedAt: row.completed_at ? timestamp(row.completed_at) : null,
    cancelledAt: row.cancelled_at ? timestamp(row.cancelled_at) : null,
  }));
}

async function readReviewSafetyState(tx: Queryable): Promise<readonly FastGateReviewSafetyState[]> {
  return rows(await tx.execute(sql`
    select id, run_id, result_id, position_id, status, doublecheck_outcome, decided_by, decided_at
    from analysis_review_decisions
    order by id
  `)).map((row) => Object.freeze({
    id: text(row.id),
    runId: text(row.run_id),
    resultId: text(row.result_id),
    positionId: text(row.position_id),
    status: text(row.status),
    doublecheckOutcome: text(row.doublecheck_outcome),
    decidedBy: row.decided_by ? text(row.decided_by) : null,
    decidedAt: row.decided_at ? timestamp(row.decided_at) : null,
  }));
}

function materialFromRow(row: Record<string, unknown>): FastGateOracleMaterial {
  const stock = record(row.stock);
  const balances = array(stock.balances).map((value) => {
    const balance = record(value);
    const onHand = numeric(balance.onHandQuantity);
    const reserved = numeric(balance.reservedQuantity);
    const quarantined = numeric(balance.quarantinedQuantity);
    return {
      warehouseId: text(balance.warehouseId), onHand, reserved, quarantined,
      available: Math.max(0, onHand - reserved - quarantined),
    };
  });
  const reliability = record(row.reliability);
  return {
    code: text(row.material_code), name: text(row.name_ru), sourceKind: text(row.source_kind), familyId: nullableText(row.family_id), equipmentType: text(row.equipment_type),
    unit: text(row.unit), snapshotId: text(stock.snapshotId), snapshotAt: timestamp(stock.snapshotAt), balances,
    reliabilityEvidenceCount: array(reliability.sourceEvidenceIds).length,
    reliability: {
      operatingHours: numeric(reliability.operatingHours),
      mtbfHours: numeric(reliability.mtbfHours),
      failureCount: numeric(reliability.failureCount),
      qualityRejectionCount: numeric(reliability.qualityRejectionCount),
      supplyRiskPercent: numeric(reliability.supplyRiskPercent),
      observedAt: timestamp(reliability.observedAt),
      sourceEvidenceIds: stringArray(reliability.sourceEvidenceIds),
    },
    itemKind: text(row.item_kind) as FastGateOracleMaterial["itemKind"],
    standard: nullableText(row.standard),
    materialGrade: nullableText(row.material_grade),
    manufacturer: nullableText(row.manufacturer),
    compatibilityStatus: text(record(row.characteristics).compatibilityStatus) as FastGateOracleMaterial["compatibilityStatus"],
    characteristics: record(row.characteristics) as FastGateOracleMaterial["characteristics"],
  };
}

function chooseAnaloguePairs(materials: readonly FastGateOracleMaterial[]) {
  const byFamily = new Map<string, FastGateOracleMaterial[]>();
  for (const material of materials) {
    if (!material.familyId) continue;
    const family = byFamily.get(material.familyId) ?? [];
    family.push(material);
    byFamily.set(material.familyId, family);
  }
  const allowed = [...byFamily.entries()].flatMap(([familyId, items]) => {
    const source = items.find((item) => item.compatibilityStatus === "VALID_MEMBER");
    const candidate = items.find((item) => item.compatibilityStatus === "VALID_MEMBER" && item.code !== source?.code);
    return source && candidate ? [analoguePair(familyId, source, candidate)] : [];
  }).slice(0, 10);
  const restrictedInFamily = [...byFamily.entries()].flatMap(([familyId, items]) => {
    const source = items.find((item) => item.compatibilityStatus === "VALID_MEMBER");
    const candidate = items.find((item) => item.compatibilityStatus === "INCOMPATIBLE_DECOY");
    return source && candidate ? [analoguePair(familyId, source, candidate)] : [];
  }).slice(0, 10);
  const restrictedAcrossFamilies: ReturnType<typeof analoguePair>[] = [];
  for (const source of materials) {
    if (restrictedAcrossFamilies.length >= 10) break;
    if (!source.familyId || source.compatibilityStatus !== "VALID_MEMBER") continue;
    const candidate = materials.find((item) => item.compatibilityStatus === "VALID_MEMBER" &&
      item.familyId !== source.familyId && item.itemKind === source.itemKind &&
      (item.equipmentType !== source.equipmentType || item.unit !== source.unit ||
        (calculateIndependentCompatibilityPercent(source, item) ?? 100) < 85));
    if (candidate) restrictedAcrossFamilies.push(analoguePair(source.familyId, source, candidate));
  }
  return [...allowed, ...(restrictedInFamily.length ? restrictedInFamily : restrictedAcrossFamilies)];
}

function analoguePair(familyId: string, source: FastGateOracleMaterial, candidate: FastGateOracleMaterial) {
  const expectedCompatibilityPercent = calculateIndependentCompatibilityPercent(source, candidate);
  const sourceRequired = Math.max(1, availableQuantity(source));
  const expectedQuantityCoveragePercent = roundPercent(
    Math.min(1, availableQuantity(candidate) / sourceRequired) * 100,
  );
  return {
    sourceCode: source.code,
    candidateCode: candidate.code,
    familyId,
    expectedCompatibilityPercent,
    expectedQuantityCoveragePercent,
    expectedVerdictLabel: compatibilityVerdictLabel(expectedCompatibilityPercent, candidate.compatibilityStatus),
    expectedDeviations: compatibilityDeviations(source, candidate),
  };
}

export function calculateIndependentCompatibilityPercent(
  source: FastGateOracleMaterial,
  candidate: FastGateOracleMaterial,
): number | null {
  if (candidate.compatibilityStatus === "INCOMPATIBLE_DECOY") return 0;
  if (source.itemKind !== candidate.itemKind || source.equipmentType !== candidate.equipmentType || source.unit !== candidate.unit) return 0;
  if (!source.standard || !source.materialGrade || !source.characteristics.standardCode ||
      !candidate.standard || !candidate.materialGrade || !candidate.characteristics.standardCode) return null;
  const ignored = new Set(["category", "compatibilityStatus", "familyCode", "variantIndex"]);
  const criticalEqual = Object.entries(source.characteristics)
    .filter(([key]) => !ignored.has(key))
    .every(([key, value]) => candidate.characteristics[key] === value);
  const performanceKeys = Object.keys(source.characteristics).filter((key) =>
    /pressure|temperature|range|max|voltage|current|power|speed|class/iu.test(key));
  const performanceEqual = performanceKeys.every((key) => candidate.characteristics[key] === source.characteristics[key]);
  return 20 + 15 + (source.familyId === candidate.familyId || criticalEqual ? 25 : 18) +
    (source.standard === candidate.standard ? 15 : 11) +
    (source.materialGrade === candidate.materialGrade ? 10 : 7) +
    (performanceEqual ? 10 : 7) + (source.familyId === candidate.familyId ? 5 : 2);
}

async function readActiveProjects(tx: Queryable): Promise<Record<string, string[]>> {
  const values = rows(await tx.execute(sql`
    select pm.user_id, array_agg(distinct bp.id order by bp.id) as project_ids
    from project_memberships pm
    join business_projects bp on bp.access_project_id=pm.project_id and bp.status='ACTIVE'
    where pm.status='ACTIVE' group by pm.user_id order by pm.user_id
  `));
  return Object.fromEntries(values.map((row) => [text(row.user_id), stringArray(row.project_ids)]));
}

async function readAccessibleProjects(tx: Queryable): Promise<Record<string, string[]>> {
  const values = rows(await tx.execute(sql`
    select pm.user_id, array_agg(distinct bp.id order by bp.id) as project_ids
    from project_memberships pm
    join business_projects bp on bp.access_project_id=pm.project_id
    where pm.status='ACTIVE'
      and pm.valid_from <= now()
      and (pm.valid_until is null or pm.valid_until > now())
    group by pm.user_id order by pm.user_id
  `));
  return Object.fromEntries(values.map((row) => [text(row.user_id), stringArray(row.project_ids)]));
}

async function readRoleProfiles(tx: Queryable): Promise<FastGateOracleSnapshot["roleProfiles"]> {
  const values = rows(await tx.execute(sql`
    with recursive inherited(user_id, role_id) as (
      select ra.user_id, ra.role_id from role_assignments ra
      where ra.status='ACTIVE' and (ra.valid_from is null or ra.valid_from <= now()) and (ra.valid_until is null or ra.valid_until > now())
      union
      select i.user_id, rh.junior_role_id from inherited i join role_hierarchy rh on rh.senior_role_id=i.role_id
    )
    select u.id, u.login, u.account_type,
      coalesce(array_agg(distinct p.key order by p.key) filter (where p.key is not null),'{}') as permissions
    from users u left join inherited i on i.user_id=u.id left join role_permissions rp on rp.role_id=i.role_id
    left join permissions p on p.key=rp.permission_key where u.is_synthetic_demo=true
    group by u.id,u.login,u.account_type order by u.id
  `));
  const claims = rows(await tx.execute(sql`
    select user_id, array_agg(distinct claim_value order by claim_value) as warehouse_ids
    from user_source_access_claims where claim_type='warehouseIds' and (valid_until is null or valid_until > now())
    group by user_id
  `));
  const warehouseByUser = new Map(claims.map((row) => [text(row.user_id), stringArray(row.warehouse_ids)]));
  return Object.fromEntries(values.map((row) => [text(row.id), {
    login: text(row.login), accountType: text(row.account_type), permissions: stringArray(row.permissions), warehouseIds: warehouseByUser.get(text(row.id)) ?? [],
  }]));
}

async function readCompletedRun(tx: Queryable, runId: string) {
  const run = rows(await tx.execute(sql`
    select input_snapshot from scenario_runs where id=${runId} and status='COMPLETED'
  `))[0];
  if (!run) throw new Error("FASTGATE_COMPLETED_RUN_NOT_FOUND");
  const specificationIds = new Set(stringArray(record(run.input_snapshot).specificationIds));
  const positionRows = rows(await tx.execute(sql`
    select p.id, p.specification_id, p.name_ru, p.name_en, p.synonyms,
           p.equipment_type, p.standard, p.material_grade, p.dimensions, p.classification
    from specification_positions p
    join specification_versions v on v.id=p.version_id and v.is_current=true
    where p.user_id='demo-user-001'
    order by p.id
  `)).filter((row) => specificationIds.size === 0 || specificationIds.has(text(row.specification_id)));
  const ruleRows = rows(await tx.execute(sql`
    select r.equipment_types, r.responsibility, r.conditions, r.clause_id,
           d.document_id, d.document_version
    from responsibility_rules r
    join normative_documents d on d.id=r.normative_document_id
    where r.user_id='demo-user-001' and r.active=true
    order by d.document_id, d.document_version, r.clause_id, r.id
  `));
  const decisions = positionRows.map((position) => independentResponsibilityDecision(position, ruleRows));
  const mismatch = decisions.filter((decision) =>
    !decision.responsibility || !decision.citationDocumentId || !decision.citationClauseId).length;
  return {
    id: runId,
    resultCount: decisions.length,
    responsibilityMismatchCount: mismatch,
    responsibilityCitationCount: decisions.filter((decision) =>
      Boolean(decision.citationDocumentId && decision.citationClauseId)).length,
    customerResponsibility: decisions.filter((decision) =>
      decision.state === "RESOLVED" && decision.responsibility === "CUSTOMER").length,
    contractorResponsibility: decisions.filter((decision) =>
      decision.state === "RESOLVED" && decision.responsibility === "CONTRACTOR").length,
    reviewRequiredCount: decisions.filter((decision) => decision.state === "REVIEW_REQUIRED").length,
    insufficientDataCount: decisions.filter((decision) => decision.state === "INSUFFICIENT_DATA").length,
    decisions,
  };
}

type OracleRow = Record<string, unknown>;

function independentResponsibilityDecision(position: OracleRow, rules: readonly OracleRow[]) {
  const candidates = rules
    .filter((rule) => independentRuleApplies(position, rule))
    .sort((left, right) => {
      const specificity = independentRuleSpecificity(right) - independentRuleSpecificity(left);
      return specificity || independentRuleKey(left).localeCompare(independentRuleKey(right), "ru");
    });
  const selected = candidates[0];
  if (!selected) return independentDecision(position, "INSUFFICIENT_DATA", null, null, null);
  const specificity = independentRuleSpecificity(selected);
  const equallySpecific = candidates.filter((candidate) => independentRuleSpecificity(candidate) === specificity);
  if (new Set(equallySpecific.map((candidate) => text(candidate.responsibility))).size > 1) {
    return independentDecision(position, "REVIEW_REQUIRED", null, null, null);
  }
  const conditions = record(selected.conditions);
  const classification = record(position.classification);
  const requiresReview = classification.criticality === "HIGH" && conditions.expertReviewForCritical === true ||
    independentReviewCondition(position, conditions.requiresHumanReviewWhen);
  return independentDecision(
    position,
    requiresReview ? "REVIEW_REQUIRED" : "RESOLVED",
    text(selected.responsibility) as "CUSTOMER" | "CONTRACTOR",
    text(selected.document_id),
    text(selected.clause_id),
  );
}

function independentDecision(
  position: OracleRow,
  state: "RESOLVED" | "REVIEW_REQUIRED" | "INSUFFICIENT_DATA",
  responsibility: "CUSTOMER" | "CONTRACTOR" | null,
  citationDocumentId: string | null,
  citationClauseId: string | null,
) {
  return { positionId: text(position.id), state, responsibility, citationDocumentId, citationClauseId };
}

function independentRuleApplies(position: OracleRow, rule: OracleRow): boolean {
  const equipmentTypes = stringArray(rule.equipment_types);
  if (!equipmentTypes.includes(text(position.equipment_type)) && !equipmentTypes.includes("*")) return false;
  const conditions = record(rule.conditions);
  const classification = record(position.classification);
  const dimensions = record(position.dimensions);
  if (!independentConditionMatches(position.standard, conditions.standard)) return false;
  if (!independentConditionMatches(position.material_grade, conditions.materialGrade)) return false;
  if (!independentConditionMatches(classification.criticality, conditions.criticality)) return false;
  if (!independentConditionMatches(classification.procurementGroup, conditions.procurementGroup)) return false;
  if (!independentConditionMatches(classification.classCode, conditions.classCode)) return false;
  if (!independentRecordMatches(classification, conditions.classification)) return false;
  return independentDimensionsMatch(dimensions, conditions.dimensions);
}

function independentRuleSpecificity(rule: OracleRow): number {
  const conditions = record(rule.conditions);
  let score = stringArray(rule.equipment_types).includes("*") ? 0 : 1;
  for (const key of ["standard", "materialGrade", "criticality", "procurementGroup", "classCode"]) {
    if (conditions[key] !== undefined) score += 1;
  }
  score += Object.keys(record(conditions.classification)).length;
  score += Object.keys(record(conditions.dimensions)).length;
  return score;
}

function independentRuleKey(rule: OracleRow): string {
  return `${text(rule.document_id)}:${text(rule.document_version)}:${text(rule.clause_id)}`;
}

function independentConditionMatches(actual: unknown, expected: unknown): boolean {
  if (expected === undefined) return true;
  if (Array.isArray(expected)) return expected.some((candidate) => independentValueEqual(actual, candidate));
  return independentValueEqual(actual, expected);
}

function independentRecordMatches(actual: OracleRow, expected: unknown): boolean {
  if (expected === undefined) return true;
  const expectedRecord = record(expected);
  return Object.entries(expectedRecord).every(([key, value]) => independentConditionMatches(actual[key], value));
}

function independentDimensionsMatch(actual: OracleRow, expected: unknown): boolean {
  if (expected === undefined) return true;
  return Object.entries(record(expected)).every(([key, constraint]) => {
    if (!constraint || typeof constraint !== "object" || Array.isArray(constraint)) {
      return independentConditionMatches(actual[key], constraint);
    }
    if (typeof actual[key] !== "number") return false;
    const range = record(constraint);
    if (typeof range.min === "number" && actual[key] < range.min) return false;
    if (typeof range.max === "number" && actual[key] > range.max) return false;
    return range.min !== undefined || range.max !== undefined;
  });
}

function independentValueEqual(left: unknown, right: unknown): boolean {
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) <= 0.0001;
  if (left === undefined || left === null || right === undefined || right === null) return left === right;
  if (typeof left === "boolean" || typeof right === "boolean") return left === right;
  return String(left).normalize("NFKC").trim().toLocaleLowerCase("ru-RU") ===
    String(right).normalize("NFKC").trim().toLocaleLowerCase("ru-RU");
}

function independentReviewCondition(position: OracleRow, condition: unknown): boolean {
  if (condition === undefined) return false;
  return (Array.isArray(condition) ? condition : [condition]).some((candidate) => {
    const normalized = String(candidate).normalize("NFKC").trim().toLocaleLowerCase("ru-RU").replaceAll("_", " ");
    if (normalized !== "hazardous area" && normalized !== "hazardous area demo") {
      return Object.values(record(position.classification)).some((value) => independentValueEqual(value, candidate));
    }
    const searchable = [position.name_ru, position.name_en, ...stringArray(position.synonyms),
      ...Object.values(record(position.classification)), ...Object.values(record(position.dimensions))]
      .filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase("ru-RU");
    return /(?:hazardous|explosion|взрыв|\bex\b)/iu.test(searchable);
  });
}

function availableQuantity(material: FastGateOracleMaterial): number {
  return material.balances.reduce((sum, balance) => sum + balance.available, 0);
}

export function compatibilityVerdictLabel(
  score: number | null,
  compatibilityStatus: FastGateOracleMaterial["compatibilityStatus"],
): string {
  if (compatibilityStatus === "INCOMPATIBLE_DECOY" || score === 0) return "Запрещено";
  if (score === null) return "Недостаточно данных";
  if (score === 100) return "Точное соответствие";
  if (score >= 95) return "Совместимо";
  if (score >= 85) return "Условно совместимо";
  if (score >= 70) return "Требуется инженерная проверка";
  return "Не рекомендуется";
}

export function compatibilityDeviations(source: FastGateOracleMaterial, candidate: FastGateOracleMaterial): readonly string[] {
  if (candidate.compatibilityStatus === "INCOMPATIBLE_DECOY") {
    return ["Каталожная позиция помечена как несовместимая"];
  }
  if (source.itemKind !== candidate.itemKind) return ["Не совпадает тип объекта"];
  if (source.equipmentType !== candidate.equipmentType) return ["Не совпадает функция оборудования"];
  if (source.unit !== candidate.unit) return ["Нет подтверждённой конверсии единиц"];
  if (!source.standard || !source.materialGrade || !source.characteristics.standardCode ||
      !candidate.standard || !candidate.materialGrade || !candidate.characteristics.standardCode) {
    return ["Недостаточно нормативных или технических данных для расчёта"];
  }
  const ignored = new Set(["category", "compatibilityStatus", "familyCode", "variantIndex"]);
  const criticalEqual = Object.entries(source.characteristics)
    .filter(([key]) => !ignored.has(key))
    .every(([key, value]) => candidate.characteristics[key] === value);
  const performanceKeys = Object.keys(source.characteristics).filter((key) =>
    /pressure|temperature|range|max|voltage|current|power|speed|class/iu.test(key));
  const performanceEqual = performanceKeys.every((key) => candidate.characteristics[key] === source.characteristics[key]);
  return [
    ...(source.familyId === candidate.familyId || criticalEqual ? [] : ["Критические размеры и интерфейсы: 18/25"]),
    ...(source.standard === candidate.standard ? [] : ["Стандарт: 11/15"]),
    ...(source.materialGrade === candidate.materialGrade ? [] : ["Материал и марка: 7/10"]),
    ...(performanceEqual ? [] : ["Рабочие параметры: 7/10"]),
    ...(source.familyId === candidate.familyId ? [] : ["Квалифицированное семейство: 2/5"]),
  ];
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

type Queryable = Readonly<{ execute(query: ReturnType<typeof sql>): Promise<unknown> }>;

function rows(value: unknown): Array<Record<string, unknown>> {
  return value && typeof value === "object" && "rows" in value && Array.isArray(value.rows)
    ? value.rows as Array<Record<string, unknown>>
    : Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string { return typeof value === "string" ? value : String(value ?? ""); }
function nullableText(value: unknown): string | null { const valueText = text(value).trim(); return valueText ? valueText : null; }
function numeric(value: unknown): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function timestamp(value: unknown): string { return value instanceof Date ? value.toISOString() : text(value); }
function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (typeof value === "string" && value.startsWith("{")) return value.slice(1, -1).split(",").map((item) => item.replace(/^"|"$/gu, "")).filter(Boolean);
  return [];
}

export function checksum(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, item]) => [key, stable(item)]));
  return value;
}
