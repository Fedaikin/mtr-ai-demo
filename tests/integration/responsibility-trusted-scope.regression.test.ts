import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { getRepository } from "@/adapters/persistence/repository";
import { ScenarioService } from "@/application/scenario-service";
import { drainScenarioRunWithDriver } from "@/application/scenario-runner";
import { getReport } from "@/application/report-service";
import { DEMO_USER_ID, type ScenarioRun } from "@/domain/models";
import type { ResponsibilityRuleManifest } from "@/domain/responsibility";

const ANALYST_ID = "demo-analyst-001";
const VIEWER_ID = "demo-viewer-001";
const SERVICE_ID = "demo-service-001";

describe.sequential("доверенный проектный и нормативный контур сценария", () => {
  beforeAll(async () => resetDemoDatabase(DEMO_USER_ID));
  afterAll(async () => closeDatabase());

  it("reference oracle fail-closed отклоняет неизвестный declarative condition", () => {
    expect(() => oracleRuleApplies(
      { equipment_type: "PIPE", classification: {}, dimensions: {} },
      { equipment_types: ["PIPE"], conditions: { unsupportedKey: "value" } },
    )).toThrow("ORACLE_UNSUPPORTED_CONDITION:unsupportedKey");
  });

  it("даёт руководителю и аналитику один полный active-rule corpus без копирования правил", async () => {
    const repository = await getRepository();
    const service = new ScenarioService(repository);
    const manager = await complete(service, DEMO_USER_ID);
    const analyst = await complete(service, ANALYST_ID);

    const managerManifest = manifest(manager);
    const analystManifest = manifest(analyst);
    expect(managerManifest).toMatchObject({
      trustedScope: {
        projectId: "demo-project-001",
        sourceScopeId: "demo-normative-001",
      },
      activeRuleCount: 5,
      ruleCount: 5,
    });
    expect(analystManifest).toEqual(managerManifest);
    expect(analystManifest.checksumSha256).toMatch(/^[a-f0-9]{64}$/u);

    const analystReport = analyst.outputSnapshot.report as {
      results: unknown[];
      provenance: { responsibilityRuleManifest: ResponsibilityRuleManifest };
    };
    expect(analystReport.results).toHaveLength(24);
    expect(analystReport.provenance.responsibilityRuleManifest).toEqual(analystManifest);

    const database = await getDatabase();
    const positionRows = rows(await database.execute(`
      select p.id, p.equipment_type, p.standard, p.material_grade, p.dimensions,
             p.classification, p.name_ru, p.name_en, p.synonyms
      from specification_positions p
      join specification_versions v on v.id=p.version_id and v.is_current=true
      where p.project_id='demo-project-001'
        and p.specification_id in ('spec-demo-piping-001','spec-demo-utilities-002','spec-demo-equipment-003')
      order by p.id
    `));
    const ruleRows = rows(await database.execute(`
      select r.id, r.equipment_types, r.responsibility, r.conditions, r.clause_id,
             d.document_id, d.document_version as version
      from responsibility_rules r
      join normative_documents d on d.id=r.normative_document_id
      where d.source_scope_id='demo-normative-001' and r.active=true
      order by r.id
    `));
    const expectedByPosition = new Map(positionRows.map((position) => {
      const applicable = ruleRows.filter((rule) => oracleRuleApplies(position, rule));
      const responsibilities = new Set(applicable.map((rule) => String(rule.responsibility)));
      const reviewRequired = applicable.some((rule) => oracleReviewRequired(position, rule));
      const decisionState = applicable.length === 0
        ? "INSUFFICIENT_DATA"
        : responsibilities.size > 1 || reviewRequired
          ? "REVIEW_REQUIRED"
          : "RESOLVED";
      return [String(position.id), { applicable, decisionState }];
    }));
    const managerResults = (manager.outputSnapshot.report as {
      runId: string;
      results: Array<{
        position: { id: string };
        responsibilityDecisionState: string;
        responsibility: string | null;
        responsibilityCitation: { documentId: string; version: string; clauseId: string } | null;
      }>;
    }).results;
    expect(managerResults).toHaveLength(expectedByPosition.size);
    const metrics = {
      coveredPositionCount: 0,
      unresolvedWithApplicableRule: 0,
      resolvedWithoutApplicableRule: 0,
      insufficientDataWithoutRule: 0,
      falseDefaultResponsibilityCount: 0,
      wrongResponsibilityOrCitationCount: 0,
      decisionStateMismatchCount: 0,
    };
    for (const result of managerResults) {
      const expected = expectedByPosition.get(result.position.id);
      expect(expected).not.toBeUndefined();
      if (!expected) continue;
      if (expected.applicable.length > 0) metrics.coveredPositionCount += 1;
      if (expected.applicable.length > 0 && result.responsibilityDecisionState === "INSUFFICIENT_DATA") {
        metrics.unresolvedWithApplicableRule += 1;
      }
      if (expected.applicable.length === 0 && result.responsibilityDecisionState === "RESOLVED") {
        metrics.resolvedWithoutApplicableRule += 1;
      }
      if (expected.applicable.length === 0 && result.responsibilityDecisionState === "INSUFFICIENT_DATA") {
        metrics.insufficientDataWithoutRule += 1;
      }
      if (expected.applicable.length === 0 && result.responsibility !== null) {
        metrics.falseDefaultResponsibilityCount += 1;
      }
      if (result.responsibilityDecisionState === "RESOLVED") {
        const citation = result.responsibilityCitation;
        const citationMatches = expected.applicable.some((rule) =>
          String(rule.responsibility) === result.responsibility &&
          String(rule.document_id) === citation?.documentId &&
          String(rule.version) === citation?.version &&
          String(rule.clause_id) === citation?.clauseId);
        if (!citationMatches) metrics.wrongResponsibilityOrCitationCount += 1;
      }
      if (result.responsibilityDecisionState !== expected.decisionState) {
        metrics.decisionStateMismatchCount += 1;
      }
    }
    expect(metrics).toMatchObject({
      coveredPositionCount: expect.any(Number),
      unresolvedWithApplicableRule: 0,
      resolvedWithoutApplicableRule: 0,
      falseDefaultResponsibilityCount: 0,
      wrongResponsibilityOrCitationCount: 0,
      decisionStateMismatchCount: 0,
    });
    expect(metrics.coveredPositionCount).toBeGreaterThan(0);
    expect((manager.outputSnapshot.report as { runId: string }).runId).toBe(manager.id);

    const ownerRuleCount = (await repository.listResponsibilityRules(DEMO_USER_ID)).length;
    const analystOwnedRuleCount = (await repository.listResponsibilityRules(ANALYST_ID)).length;
    expect({ ownerRuleCount, analystOwnedRuleCount }).toEqual({
      ownerRuleCount: 5,
      analystOwnedRuleCount: 0,
    });

    const viewerRuns = await repository.listScenarioRunsInProject(
      VIEWER_ID,
      "demo-project-001",
      { includeSteps: false },
    );
    expect(viewerRuns.map((run) => run.id)).toContain(manager.id);
    await expect(getReport(VIEWER_ID, manager.id)).resolves.toMatchObject({
      run: { id: manager.id, projectId: "demo-project-001" },
      report: { runId: manager.id, results: { length: 24 } },
    });
  });

  it("не разрешает viewer и интерактивно запрещённому service account запускать анализ", async () => {
    const service = new ScenarioService(await getRepository());
    const input = {
      scenarioId: "scenario-full-analysis",
      specificationId: "ALL_CURRENT_SPECIFICATIONS",
    };
    await expect(service.createRun(VIEWER_ID, input)).rejects.toMatchObject({
      name: "AuthorizationError",
      permission: "analysis.create",
    });
    await expect(service.createRun(SERVICE_ID, input)).rejects.toMatchObject({
      name: "AuthorizationError",
    });
  });

  it("фильтрует SAP по актуальным warehouse claims до retrieval", async () => {
    const database = await getDatabase();
    await database.execute(`delete from user_source_access_claims where user_id='${ANALYST_ID}'`);
    await database.execute(`
      insert into user_source_access_claims
        (id,user_id,claim_type,claim_value,source)
      values ('claim-analyst-remediation-central','${ANALYST_ID}','warehouseIds','WH-DEMO-CENTRAL','REMEDIATION_TEST')
    `);
    const run = await complete(new ScenarioService(await getRepository()), ANALYST_ID);
    const materials = ((run.outputSnapshot.sap as { materials?: Array<{ storageLocation: string }> })
      .materials ?? []);
    expect(materials.length).toBeGreaterThan(0);
    expect(new Set(materials.map((item) => item.storageLocation))).toEqual(
      new Set(["WH-DEMO-CENTRAL"]),
    );
  });

  it("не продолжает run после истечения project role assignment или access claim", async () => {
    const service = new ScenarioService(await getRepository());
    const claimScoped = await service.createRun(ANALYST_ID, {
      scenarioId: "scenario-full-analysis",
      specificationId: "ALL_CURRENT_SPECIFICATIONS",
    });
    await (await getDatabase()).execute(`
      update user_source_access_claims
      set valid_until=now()-interval '1 second'
      where user_id='${ANALYST_ID}' and claim_type='warehouseIds'
    `);
    await expect(service.advance(ANALYST_ID, claimScoped.id, claimScoped.version)).rejects.toMatchObject({
      name: "ScenarioServiceError",
      code: "RUN_SCOPE_REVOKED",
    });

    const created = await service.createRun(ANALYST_ID, {
      scenarioId: "scenario-full-analysis",
      specificationId: "ALL_CURRENT_SPECIFICATIONS",
    });
    await (await getDatabase()).execute(`
      update role_assignments
      set valid_until=valid_from+interval '1 millisecond'
      where user_id='${ANALYST_ID}' and scope_type='PROJECT'
    `);
    await expect(service.advance(ANALYST_ID, created.id, created.version)).rejects.toMatchObject({
      name: "AuthorizationError",
      permission: "analysis.create",
    });
  });

  it("canonical reset удаляет project runtime всех участников до замены общих fixtures", async () => {
    await expect(resetDemoDatabase(DEMO_USER_ID)).resolves.toMatchObject({
      users: 8,
      specifications: 83,
    });
    const [countRow] = rows(await (await getDatabase()).execute(`
      select count(*)::int as count from scenario_runs where project_id='demo-project-001'
    `));
    expect(Number(countRow?.count ?? -1)).toBe(0);
  });
});

async function complete(service: ScenarioService, userId: string): Promise<ScenarioRun> {
  const created = await service.createRun(userId, {
    scenarioId: "scenario-full-analysis",
    specificationId: "ALL_CURRENT_SPECIFICATIONS",
  });
  const drained = await drainScenarioRunWithDriver(service, userId, created.id);
  expect(drained.stopReason).toBe("TERMINAL");
  expect(drained.run.status).toBe("COMPLETED");
  return drained.run;
}

const ORACLE_CONDITION_KEYS = new Set([
  "standard",
  "materialGrade",
  "criticality",
  "procurementGroup",
  "classCode",
  "classification",
  "dimensions",
  "confidence",
  "expertReviewForCritical",
  "requiresHumanReviewWhen",
]);

function oracleRuleApplies(
  position: Record<string, unknown>,
  rule: Record<string, unknown>,
): boolean {
  const equipmentTypes = stringArray(rule.equipment_types);
  if (!equipmentTypes.includes(String(position.equipment_type)) && !equipmentTypes.includes("*")) {
    return false;
  }
  const conditions = jsonRecord(rule.conditions);
  for (const key of Object.keys(conditions)) {
    if (!ORACLE_CONDITION_KEYS.has(key)) throw new Error(`ORACLE_UNSUPPORTED_CONDITION:${key}`);
  }
  const classification = jsonRecord(position.classification);
  const dimensions = jsonRecord(position.dimensions);
  if (!oracleMatches(position.standard, conditions.standard)) return false;
  if (!oracleMatches(position.material_grade, conditions.materialGrade)) return false;
  if (!oracleMatches(classification.criticality, conditions.criticality)) return false;
  if (!oracleMatches(classification.procurementGroup, conditions.procurementGroup)) return false;
  if (!oracleMatches(classification.classCode, conditions.classCode)) return false;
  if (!oracleRecordMatches(classification, conditions.classification)) return false;
  return oracleDimensionsMatch(dimensions, conditions.dimensions);
}

function oracleReviewRequired(
  position: Record<string, unknown>,
  rule: Record<string, unknown>,
): boolean {
  const conditions = jsonRecord(rule.conditions);
  const classification = jsonRecord(position.classification);
  if (conditions.expertReviewForCritical === true && classification.criticality === "HIGH") return true;
  const reviewConditions = conditions.requiresHumanReviewWhen === undefined
    ? []
    : Array.isArray(conditions.requiresHumanReviewWhen)
      ? conditions.requiresHumanReviewWhen
      : [conditions.requiresHumanReviewWhen];
  return reviewConditions.some((candidate) => {
    const normalized = oracleText(candidate);
    if (normalized === "hazardous area" || normalized === "hazardous area demo") {
      const searchable = oracleText([
        position.name_ru,
        position.name_en,
        ...stringArray(position.synonyms),
        classification.classCode,
        jsonRecord(position.dimensions).protectionClass,
      ].filter(Boolean).join(" "));
      return /(?:hazardous|explosion|взрыв|\bex\b)/iu.test(searchable);
    }
    return Object.values(classification).some((value) => oracleMatches(value, candidate));
  });
}

function oracleRecordMatches(actual: Record<string, unknown>, expected: unknown): boolean {
  if (expected === undefined) return true;
  const constraints = jsonRecord(expected);
  return Object.entries(constraints).every(([key, value]) => oracleMatches(actual[key], value));
}

function oracleDimensionsMatch(actual: Record<string, unknown>, expected: unknown): boolean {
  if (expected === undefined) return true;
  return Object.entries(jsonRecord(expected)).every(([key, constraint]) => {
    const value = actual[key];
    const range = jsonRecord(constraint);
    if (Object.keys(range).length === 0) return oracleMatches(value, constraint);
    if (typeof value !== "number") return false;
    if (typeof range.min === "number" && value < range.min) return false;
    if (typeof range.max === "number" && value > range.max) return false;
    return range.min !== undefined || range.max !== undefined;
  });
}

function oracleMatches(actual: unknown, expected: unknown): boolean {
  if (expected === undefined) return true;
  if (Array.isArray(expected)) return expected.some((candidate) => oracleMatches(actual, candidate));
  if (typeof actual === "number" && typeof expected === "number") {
    return Math.abs(actual - expected) <= 0.0001;
  }
  if (typeof actual === "boolean" || typeof expected === "boolean") return actual === expected;
  if (actual === null || actual === undefined || expected === null) return actual === expected;
  return oracleText(actual) === oracleText(expected);
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function oracleText(value: unknown): string {
  return String(value).trim().toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replace(/\s+/gu, " ");
}

function rows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) {
    return result.rows as Array<Record<string, unknown>>;
  }
  return [];
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function manifest(run: ScenarioRun): ResponsibilityRuleManifest {
  const report = run.outputSnapshot.report as {
    provenance: { responsibilityRuleManifest: ResponsibilityRuleManifest };
  };
  return report.provenance.responsibilityRuleManifest;
}
