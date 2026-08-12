import { readFile } from "node:fs/promises";

import appiusFixture from "@/adapters/mock/fixtures/appius.json";
import normativeFixture from "@/adapters/mock/fixtures/normative.json";
import sapFixture from "@/adapters/mock/fixtures/sap.json";
import { createMockLLMProvider } from "@/adapters/mock/mock-llm-provider";
import { createAgentService } from "@/application/agent-service";
import { findBestMaterial } from "@/domain/matching";
import type {
  AnalogueRule,
  GroundedAgentOutput,
  IntegrationState,
  IntegrationStatus,
  Position,
  PositionAnalysisResult,
  ReportSummary,
  ResponsibilityRule,
  SapMaterial,
  ScenarioRun,
  Specification,
  SpecificationVersion,
} from "@/domain/models";
import { normalizeText, tokenSimilarity, tokenize } from "@/domain/normalize";
import type { LLMProvider, StockQuery } from "@/ports";
import { z } from "zod";

export const EXPECTED_AGENT_EVAL_CASES = 34;

const toolArgumentSchema = z.object({
  tool: z.string(),
  field: z.string(),
  value: z.unknown(),
});

const evalCaseSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  input: z.object({
    trustedUserId: z.string().min(1),
    message: z.string().min(1),
  }),
  fixtureOverrides: z
    .object({
      appiusState: z.string().optional(),
      sapState: z.string().optional(),
      normativeFailure: z.boolean().optional(),
      llmFailure: z.boolean().optional(),
    })
    .optional(),
  expected: z.object({
    requiredTools: z.array(z.string()).optional(),
    forbiddenTools: z.array(z.string()).optional(),
    requiredCitationSystems: z.array(z.string()).optional(),
    requiredClauseIds: z.array(z.string()).optional(),
    answerIncludes: z.array(z.string()).optional(),
    answerExcludes: z.array(z.string()).optional(),
    trustedUserIdOnly: z.boolean().optional(),
    allToolCallsUseUserId: z.string().optional(),
    forbiddenUserIds: z.array(z.string()).optional(),
    forbiddenToolArguments: z.array(toolArgumentSchema).optional(),
    requiresHumanReview: z.boolean().optional(),
  }),
});

export type AgentEvalCase = z.infer<typeof evalCaseSchema>;

export interface AgentEvalCaseResult {
  id: string;
  category: string;
  passed: boolean;
  failures: string[];
}

export interface AgentEvalRunResult {
  total: number;
  passed: number;
  failed: number;
  cases: AgentEvalCaseResult[];
}

interface ToolTrace {
  tool: string;
  userId: string;
  arguments: Record<string, unknown>;
}

const specifications = appiusFixture.specifications.map(
  (item) => ({ ...item, userId: item.user_id }) as Specification,
);
const versions = appiusFixture.specificationVersions.map(
  (item) => ({ ...item, userId: item.user_id }) as SpecificationVersion,
);
const positions = appiusFixture.positions.map(
  (item) => ({ ...item, userId: item.user_id }) as unknown as Position,
);
const materials = sapFixture.materials.map(
  (item) =>
    ({
      ...item,
      id: item.recordId,
      userId: item.user_id,
      storageLocation: item.warehouse,
      snapshotAt: item.snapshotDate,
      cardUrl: item.materialCardUrl,
      sourcePositionId: item.expectedMatch?.targetPositionId,
    }) as unknown as SapMaterial,
);

const documentTitles = new Map(
  normativeFixture.documents.map((document) => [
    `${document.documentId}:${document.version}`,
    document.title,
  ]),
);
const russianRuleText = new Map(
  normativeFixture.chunks
    .filter((chunk) => chunk.language === "ru")
    .map((chunk) => [
      `${chunk.documentId}:${chunk.version}:${chunk.clauseId}`,
      chunk.text,
    ]),
);

const responsibilityRules = normativeFixture.responsibilityRules.map(
  (item) =>
    ({
      equipmentTypes: item.equipmentTypes,
      responsibility: item.responsibility,
      conditions: {
        confidence: item.confidence,
        ...(item.requiresHumanReviewWhen
          ? { requiresHumanReviewWhen: item.requiresHumanReviewWhen }
          : {}),
      },
      documentId: item.documentId,
      version: item.version,
      clauseId: item.clauseId,
      title:
        documentTitles.get(`${item.documentId}:${item.version}`) ??
        `Синтетическое правило ${item.ruleId}`,
      text:
        russianRuleText.get(`${item.documentId}:${item.version}:${item.clauseId}`) ??
        `Синтетическое правило ${item.ruleId}`,
      isSyntheticDemo: true,
    }) as ResponsibilityRule,
);

const analogueRules = normativeFixture.analogueRules.map((item) => {
  const pairs = deriveAnaloguePairs(item.equipmentType);
  return {
    equipmentTypes: [item.equipmentType],
    allowedStandardPairs: pairs.standards,
    allowedMaterialPairs: pairs.materials,
    dimensionTolerances: deriveDimensionTolerances(
      item.equipmentType,
      item.criteria as Record<string, unknown>,
    ),
    documentId: item.documentId,
    version: item.version,
    clauseId: item.clauseId,
    title:
      documentTitles.get(`${item.documentId}:${item.version}`) ??
      `Синтетическое правило ${item.ruleId}`,
    text:
      russianRuleText.get(`${item.documentId}:${item.version}:${item.clauseId}`) ??
      `Синтетическое правило ${item.ruleId}`,
    isSyntheticDemo: true,
  } satisfies AnalogueRule;
});

export async function loadAgentEvalCases(filePath: string): Promise<AgentEvalCase[]> {
  const contents = await readFile(filePath, "utf8");
  const cases = contents
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return evalCaseSchema.parse(JSON.parse(line));
      } catch (error) {
        throw new Error(`Некорректный JSONL eval в строке ${index + 1}`, { cause: error });
      }
    });

  if (cases.length !== EXPECTED_AGENT_EVAL_CASES) {
    throw new Error(
      `Ожидалось ${EXPECTED_AGENT_EVAL_CASES} eval-кейса, получено ${cases.length}.`,
    );
  }
  if (new Set(cases.map((item) => item.id)).size !== cases.length) {
    throw new Error("Идентификаторы eval-кейсов должны быть уникальными.");
  }
  return cases;
}

export async function runAgentEvals(cases: AgentEvalCase[]): Promise<AgentEvalRunResult> {
  const results: AgentEvalCaseResult[] = [];
  for (const evalCase of cases) {
    results.push(await runAgentEvalCase(evalCase));
  }
  const passed = results.filter((item) => item.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    cases: results,
  };
}

async function runAgentEvalCase(evalCase: AgentEvalCase): Promise<AgentEvalCaseResult> {
  const traces: ToolTrace[] = [];
  const overrides = evalCase.fixtureOverrides ?? {};
  const appiusState = integrationState(
    "APPIUS",
    (overrides.appiusState ?? "AVAILABLE") as IntegrationStatus,
  );
  const sapState = integrationState(
    "SAP",
    (overrides.sapState ?? "AVAILABLE") as IntegrationStatus,
  );
  const llm = tracedLlm(traces, Boolean(overrides.llmFailure));
  const trace = (
    tool: string,
    userId: string,
    args: Record<string, unknown> = {},
  ): void => {
    traces.push({ tool, userId, arguments: args });
  };

  const service = createAgentService({
    appius: {
      getState: async (userId) => {
        trace("appius.getState", userId);
        return appiusState;
      },
      listSpecifications: async (userId) => {
        trace("appius.listSpecifications", userId);
        return specifications.filter((item) => item.userId === userId);
      },
      listVersions: async (specificationId, userId) => {
        trace("appius.listVersions", userId, { specificationId });
        return versions.filter(
          (item) => item.userId === userId && item.specificationId === specificationId,
        );
      },
      getLatestVersion: async (specificationId, userId) => {
        trace("appius.getLatestVersion", userId, { specificationId });
        const version = versions.find(
          (item) =>
            item.userId === userId &&
            item.specificationId === specificationId &&
            item.isCurrent,
        );
        if (!version) throw toolFailure("APPIUS_VERSION_NOT_FOUND");
        return version;
      },
      getPositions: async (specificationId, versionId, userId) => {
        trace("appius.getPositions", userId, { specificationId, versionId });
        return positions.filter(
          (item) =>
            item.userId === userId &&
            item.specificationId === specificationId &&
            item.versionId === versionId,
        );
      },
    },
    sap: {
      getState: async (userId) => {
        trace("sap.getState", userId);
        return sapState;
      },
      getMaterialStock: async (materialCode, userId) => {
        trace("sap.getMaterialStock", userId, { materialCode });
        return withSapSnapshot(
          materials.filter(
            (item) => item.userId === userId && item.materialCode === materialCode,
          ),
          sapState,
        );
      },
      searchMaterialStock: async (query, userId) => {
        trace("sap.searchMaterialStock", userId, { ...query });
        const items = searchMaterials(query, userId);
        const skip = query.skip ?? 0;
        const top = query.top ?? 20;
        const snapshotAt =
          sapState.snapshotAt ?? sapFixture.integrationState.snapshotDate;
        return {
          items: withSapSnapshot(items.slice(skip, skip + top), sapState),
          total: items.length,
          snapshotAt,
          ...(skip + top < items.length ? { nextSkip: skip + top } : {}),
        };
      },
    },
    norms: {
      searchResponsibilityRules: async (position, userId) => {
        trace("norms.searchResponsibilityRules", userId, { positionId: position.id });
        if (overrides.normativeFailure) throw toolFailure("NORMATIVE_UNAVAILABLE");
        return responsibilityRules.filter(
          (rule) =>
            userId === evalCase.input.trustedUserId &&
            rule.equipmentTypes.includes(position.equipmentType),
        );
      },
      searchAnalogueRules: async (position, userId) => {
        trace("norms.searchAnalogueRules", userId, { positionId: position.id });
        if (overrides.normativeFailure) throw toolFailure("NORMATIVE_UNAVAILABLE");
        return analogueRules.filter(
          (rule) =>
            userId === evalCase.input.trustedUserId &&
            rule.equipmentTypes.includes(position.equipmentType),
        );
      },
    },
    scenarios: {
      getRun: async (id, userId) => {
        trace("scenario.getRun", userId, { runId: id });
        return scenarioRun(id, userId);
      },
      getPositionResult: async (runId, positionId, userId) => {
        trace("scenario.getPositionResult", userId, { runId, positionId });
        return positionResult(runId, positionId, userId);
      },
    },
    reports: {
      getSummary: async (runId, userId) => {
        trace("report.getSummary", userId, { runId });
        return reportSummary(runId, userId);
      },
    },
    llm,
    audit: { write: async () => undefined },
  });

  let output: GroundedAgentOutput;
  try {
    output = await service.respond(
      { message: evalCase.input.message },
      evalCase.input.trustedUserId,
    );
  } catch (error) {
    return {
      id: evalCase.id,
      category: evalCase.category,
      passed: false,
      failures: [`eval runner получил исключение: ${safeErrorLabel(error)}`],
    };
  }

  const failures = evaluateOutput(evalCase, output, traces);
  return {
    id: evalCase.id,
    category: evalCase.category,
    passed: failures.length === 0,
    failures,
  };
}

function evaluateOutput(
  evalCase: AgentEvalCase,
  output: GroundedAgentOutput,
  traces: ToolTrace[],
): string[] {
  const failures: string[] = [];
  const expected = evalCase.expected;
  const toolNames = new Set(output.toolCalls.map((call) => call.tool));
  const citationSystems = new Set(output.citations.map((citation) => citation.sourceSystem));
  const clauseIds = new Set(output.citations.map((citation) => citation.clauseId).filter(Boolean));
  const normalizedAnswer = output.answer.toLocaleLowerCase("ru-RU");

  for (const tool of expected.requiredTools ?? []) {
    if (!toolNames.has(tool)) failures.push(`не вызван обязательный инструмент ${tool}`);
  }
  for (const tool of expected.forbiddenTools ?? []) {
    if (toolNames.has(tool)) failures.push(`вызван запрещённый инструмент ${tool}`);
  }
  for (const system of expected.requiredCitationSystems ?? []) {
    if (!citationSystems.has(system as GroundedAgentOutput["citations"][number]["sourceSystem"])) {
      failures.push(`нет обязательной citation системы ${system}`);
    }
  }
  for (const clauseId of expected.requiredClauseIds ?? []) {
    if (!clauseIds.has(clauseId)) failures.push(`нет обязательного пункта ${clauseId}`);
  }
  for (const fragment of expected.answerIncludes ?? []) {
    if (!normalizedAnswer.includes(fragment.toLocaleLowerCase("ru-RU"))) {
      failures.push(`ответ не содержит «${fragment}»`);
    }
  }
  for (const fragment of expected.answerExcludes ?? []) {
    if (normalizedAnswer.includes(fragment.toLocaleLowerCase("ru-RU"))) {
      failures.push(`ответ содержит запрещённое «${fragment}»`);
    }
  }
  if (
    expected.requiresHumanReview !== undefined &&
    output.requiresHumanReview !== expected.requiresHumanReview
  ) {
    failures.push(
      `requiresHumanReview=${output.requiresHumanReview}, ожидалось ${expected.requiresHumanReview}`,
    );
  }

  const trustedUserId = expected.allToolCallsUseUserId ?? evalCase.input.trustedUserId;
  if (expected.trustedUserIdOnly || expected.allToolCallsUseUserId) {
    const foreignCall = traces.find((call) => call.userId !== trustedUserId);
    if (foreignCall) {
      failures.push(`инструмент ${foreignCall.tool} вызван с недоверенным user_id`);
    }
  }
  for (const forbidden of expected.forbiddenToolArguments ?? []) {
    const violatingCall = traces.find(
      (call) =>
        call.tool === forbidden.tool &&
        Object.is(call.arguments[forbidden.field], forbidden.value),
    );
    if (violatingCall) {
      failures.push(
        `${forbidden.tool} вызван с запрещённым ${forbidden.field}=${String(forbidden.value)}`,
      );
    }
  }
  const observableText = `${output.answer}\n${JSON.stringify(traces)}`;
  for (const forbiddenUserId of expected.forbiddenUserIds ?? []) {
    if (observableText.includes(forbiddenUserId)) {
      failures.push("ответ или трасса содержит запрещённый user_id");
    }
  }
  return failures;
}

function tracedLlm(traces: ToolTrace[], fail: boolean): LLMProvider {
  const provider = createMockLLMProvider();
  return {
    respond: async (input) => {
      traces.push({
        tool: "llm.respond",
        userId: input.userId,
        arguments: { factCount: input.facts.length },
      });
      if (fail) throw toolFailure("LLM_PROVIDER_UNAVAILABLE");
      return provider.respond(input);
    },
  };
}

function integrationState(
  system: "APPIUS" | "SAP",
  state: IntegrationStatus,
): IntegrationState {
  const snapshotAt =
    system === "SAP"
      ? state === "STALE"
        ? "2026-07-01T00:00:00.000Z"
        : sapFixture.integrationState.snapshotDate
      : undefined;
  return {
    system,
    state,
    delayMs: 0,
    snapshotAt,
    lastSynchronizedAt: "2026-08-11T08:00:00.000Z",
  };
}

function searchMaterials(query: StockQuery, userId: string): SapMaterial[] {
  const scoped = materials.filter(
    (item) =>
      item.userId === userId &&
      (!query.equipmentType || item.equipmentType === query.equipmentType),
  );
  if (!query.text) {
    return [...scoped].sort((left, right) =>
      left.materialCode.localeCompare(right.materialCode, "ru"),
    );
  }
  const normalizedQuery = normalizeText(query.text);
  const queryTokens = tokenize(query.text);
  return scoped
    .map((item) => {
      const values = [
        item.materialCode,
        item.legacyCode,
        item.nameRu,
        item.nameEn,
        ...item.synonyms,
      ].filter((value): value is string => Boolean(value));
      const exact = values.some((value) => normalizeText(value).includes(normalizedQuery));
      return {
        item,
        score: exact ? 2 : tokenSimilarity(queryTokens, tokenize(...values)),
      };
    })
    .filter(({ score }) => score >= 0.12)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.item.materialCode.localeCompare(right.item.materialCode, "ru");
    })
    .map(({ item }) => item);
}

function withSapSnapshot(items: SapMaterial[], state: IntegrationState): SapMaterial[] {
  return state.state === "STALE" && state.snapshotAt
    ? items.map((item) => ({ ...item, snapshotAt: state.snapshotAt! }))
    : items;
}

function deriveAnaloguePairs(equipmentType: string): {
  standards: Array<[string, string]>;
  materials: Array<[string, string]>;
} {
  const required = positions.filter((position) => position.equipmentType === equipmentType);
  const candidates = materials.filter(
    (material) =>
      material.equipmentType === equipmentType &&
      material.fixtureTags?.includes("case:analogue"),
  );
  const standards = new Map<string, [string, string]>();
  const grades = new Map<string, [string, string]>();
  for (const position of required) {
    for (const candidate of candidates) {
      if (position.standard && candidate.standard) {
        const pair: [string, string] = [position.standard, candidate.standard];
        standards.set(pair.join("\u0000"), pair);
      }
      if (position.materialGrade && candidate.materialGrade) {
        const pair: [string, string] = [position.materialGrade, candidate.materialGrade];
        grades.set(pair.join("\u0000"), pair);
      }
    }
  }
  return { standards: [...standards.values()], materials: [...grades.values()] };
}

function deriveDimensionTolerances(
  equipmentType: string,
  criteria: Record<string, unknown>,
): Record<string, number> {
  const required = positions.find((position) => position.equipmentType === equipmentType);
  if (!required) return {};
  const percentKeys: Record<string, string> = {
    flowM3h: "flowPercent",
    headM: "headPercent",
    powerKw: "powerPercent",
    voltageV: "voltagePercent",
    speedRpm: "speedPercent",
    wallThicknessMm: "wallThicknessPercent",
  };
  const exactKeys: Record<string, string> = {
    connectionDnMm: "connectionDiameterMm",
    inletDiameterMm: "inletDiameterMm",
    outletDiameterMm: "outletDiameterMm",
  };
  const result: Record<string, number> = {};
  for (const [dimension, value] of Object.entries(required.dimensions)) {
    if (typeof value !== "number") continue;
    const percent = criteria[percentKeys[dimension]];
    if (typeof percent === "number") {
      result[dimension] = Math.abs(value) * (percent / 100);
      continue;
    }
    const exact = criteria[exactKeys[dimension] ?? dimension];
    if (typeof exact === "number") result[dimension] = exact;
  }
  return result;
}

function scenarioRun(id: string, userId: string): ScenarioRun | null {
  if (userId !== "demo-user-001") return null;
  if (id === "run-demo-001") {
    return createRun(id, userId, "COMPLETED", 100, "Отчёт сформирован");
  }
  if (id === "run-queued-001") {
    return createRun(id, userId, "QUEUED", 0, "Ожидает запуска");
  }
  return null;
}

function createRun(
  id: string,
  userId: string,
  status: ScenarioRun["status"],
  progress: number,
  currentStep: string,
): ScenarioRun {
  const createdAt = "2026-08-11T09:00:00.000Z";
  return {
    id,
    userId,
    scenarioId: "scenario-full-analysis",
    specificationId: "ALL_CURRENT_SPECIFICATIONS",
    status,
    currentStep,
    progress,
    mode: "NORMAL",
    seed: "eval-seed-v1",
    version: status === "COMPLETED" ? 7 : 1,
    createdAt,
    updatedAt: "2026-08-11T09:01:00.000Z",
    ...(status === "COMPLETED"
      ? {
          startedAt: createdAt,
          completedAt: "2026-08-11T09:01:00.000Z",
        }
      : {}),
    inputSnapshot: {},
    outputSnapshot: {},
    steps: [],
  };
}

function reportSummary(runId: string, userId: string): ReportSummary | null {
  if (runId !== "run-demo-001" || userId !== "demo-user-001") return null;
  return {
    total: 24,
    exact: 8,
    found: 16,
    likely: 8,
    review: 5,
    noMatch: 3,
    analogues: 3,
    insufficient: 1,
    procurement: 1,
    customerResponsibility: 10,
    contractorResponsibility: 14,
  };
}

function positionResult(
  runId: string,
  positionId: string,
  userId: string,
): PositionAnalysisResult | null {
  if (runId !== "run-demo-001" || userId !== "demo-user-001") return null;
  const position = positions.find((item) => item.id === positionId);
  if (!position) return null;
  const rule = responsibilityRules.find((item) =>
    item.equipmentTypes.includes(position.equipmentType),
  );
  if (!rule) return null;
  const match = findBestMaterial(position, materials);
  return {
    position,
    responsibility: rule.responsibility,
    responsibilityConfidence: 0.98,
    responsibilityCitation: rule,
    match,
    status: match.material ? "FOUND" : "NOT_FOUND",
    requiresHumanReview: match.requiresHumanReview,
  };
}

function toolFailure(code: string): Error {
  return Object.assign(new Error("synthetic eval failure"), { code });
}

function safeErrorLabel(error: unknown): string {
  return error instanceof Error ? error.name : "non-error";
}
