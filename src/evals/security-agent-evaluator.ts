import { readFile } from "node:fs/promises";

import { z } from "zod";

import {
  AgentActionService,
  type AgentActionExecutor,
  type AgentActionStore,
} from "@/application/agent-orchestrator/action-service";
import {
  AgentCaseService,
  type AgentCaseStore,
} from "@/application/agent-orchestrator/case-service";
import {
  reauthorizeSavedAgentCitations,
  type AgentCitationReadPort,
} from "@/application/agent-orchestrator/citation-authorization";
import {
  AgentCommandRegistry,
} from "@/application/agent-orchestrator/command-registry";
import {
  createAgentCommandHandlers,
  type AgentCommandHandlerMap,
} from "@/application/agent-orchestrator/command-handlers";
import { parseAgentCommandRequest } from "@/application/agent-orchestrator/command-schemas";
import { agentChatInputSchema } from "@/application/agent-orchestrator/orchestrator";
import type { TrustedRequestContext } from "@/application/authorization-service";
import type { AgentActionProposal } from "@/domain/agent/actions";
import type {
  AgentCaseRecord,
  AgentEvidenceFactRecord,
} from "@/domain/agent/case";
import type { AgentCommandKey } from "@/domain/agent/commands";
import {
  createAgentExecutionContext,
  type AgentContextSelection,
  type AgentExecutionContext,
} from "@/domain/agent/context";
import type { PermissionKey } from "@/domain/rbac";
import type {
  AgentOrchestratorPorts,
  ValidatedAgentSelection,
} from "@/ports/agent-orchestrator";

export const EXPECTED_SECURITY_AGENT_EVAL_CASES = 32;

const profileSchema = z.enum([
  "SUMMARY_WITHOUT_CHAT",
  "SUMMARY_WITHOUT_PROJECT_READ",
  "TASKS_WITHOUT_REVIEW_READ",
  "RISKS_WITHOUT_ANALYSIS_READ",
  "STOCKS_WITHOUT_STOCK_SEARCH",
  "KPI_WITHOUT_PROJECT_READ",
  "ANALYSIS_WITHOUT_SPECIFICATION_READ",
  "ANALYSIS_WITHOUT_CATALOG_READ",
  "NO_ACTIVE_PROJECT",
  "EXECUTION_PROJECT_MISMATCH",
  "REQUEST_PROJECT_MISMATCH",
  "SPECIFICATION_SELECTION_MISMATCH",
  "POSITION_SELECTION_MISMATCH",
  "RUN_SELECTION_MISMATCH",
  "PERIOD_SELECTION_MISMATCH",
  "FOREIGN_WAREHOUSE_BEFORE_RETRIEVAL",
  "CHAT_USER_ID_INJECTION",
  "CHAT_PERMISSION_INJECTION",
  "CHAT_AUTH_VERSION_INJECTION",
  "COMMAND_UNKNOWN_FILTER",
  "COMMAND_INVALID_PERIOD",
  "SAP_PERMISSION_REVOKED",
  "SAP_SOURCE_REVOKED",
  "SAP_WAREHOUSE_REVOKED",
  "REPORT_RESOURCE_REVOKED",
  "UNKNOWN_CITATION_SOURCE",
  "NORMATIVE_SOURCE_REVOKED",
  "TASK_OWNER_SCOPE_REVOKED",
  "CASE_CROSS_PROJECT_HIDDEN",
  "CASE_EVIDENCE_REVOKED",
  "ACTION_AUTH_VERSION_REVOKED",
  "ACTION_PERMISSION_REVOKED",
]);

const securityEvalCaseSchema = z.object({
  id: z.string().min(1),
  split: z.enum(["validation", "held-out", "adversarial"]),
  category: z.string().min(1),
  maturity: z.literal("A1"),
  runtimeBoundary: z.enum([
    "COMMAND_AUTHORIZATION",
    "CONTEXT_SELECTION",
    "INPUT_SCHEMA",
    "CITATION_REAUTHORIZATION",
    "CASE_REAUTHORIZATION",
    "ACTION_REAUTHORIZATION",
  ]),
  datasetVersion: z.literal("security-boundaries-1.0.0"),
  input: z.object({ profile: profileSchema }).strict(),
  expected: z.object({
    outcome: z.enum(["DENIED", "FILTERED", "HIDDEN", "REVOKED_EVIDENCE"]),
    errorCode: z.string().min(1).optional(),
    boundaryCalls: z.number().int().nonnegative(),
    visibleCount: z.number().int().nonnegative(),
    sideEffectCalls: z.number().int().nonnegative(),
    maxDurationMs: z.number().positive().max(10_000),
  }).strict(),
}).strict();

export type SecurityAgentEvalCase = z.output<typeof securityEvalCaseSchema>;

export interface SecurityAgentEvalRunResult {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly cases: readonly {
    readonly id: string;
    readonly split: SecurityAgentEvalCase["split"];
    readonly category: string;
    readonly passed: boolean;
    readonly durationMs: number;
    readonly failures: readonly string[];
  }[];
}

interface ActualBoundaryResult {
  readonly outcome: SecurityAgentEvalCase["expected"]["outcome"];
  readonly errorCode?: string;
  readonly boundaryCalls: number;
  readonly visibleCount: number;
  readonly sideEffectCalls: number;
}

export async function loadSecurityAgentEvalCases(filePath: string): Promise<SecurityAgentEvalCase[]> {
  const lines = (await readFile(filePath, "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const cases = lines.map((line, index) => {
    try {
      return securityEvalCaseSchema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(`Некорректный security JSONL eval в строке ${index + 1}`, { cause: error });
    }
  });
  if (cases.length !== EXPECTED_SECURITY_AGENT_EVAL_CASES) {
    throw new Error(
      `Ожидалось ${EXPECTED_SECURITY_AGENT_EVAL_CASES} security eval-кейса, получено ${cases.length}.`,
    );
  }
  if (new Set(cases.map((item) => item.id)).size !== cases.length) {
    throw new Error("Идентификаторы security eval-кейсов должны быть уникальными.");
  }
  const profiles = new Set(cases.map((item) => item.input.profile));
  if (profiles.size !== EXPECTED_SECURITY_AGENT_EVAL_CASES) {
    throw new Error("Каждый security-профиль должен быть представлен ровно одним кейсом.");
  }
  const boundaryCounts = countBy(cases, (item) => item.runtimeBoundary);
  if (
    boundaryCounts.COMMAND_AUTHORIZATION !== 9 ||
    boundaryCounts.CONTEXT_SELECTION !== 7 ||
    boundaryCounts.INPUT_SCHEMA !== 5 ||
    boundaryCounts.CITATION_REAUTHORIZATION !== 7 ||
    boundaryCounts.CASE_REAUTHORIZATION !== 2 ||
    boundaryCounts.ACTION_REAUTHORIZATION !== 2
  ) {
    throw new Error("Security eval не соответствует закреплённому покрытию trust boundaries.");
  }
  return cases;
}

export async function runSecurityAgentEvals(
  cases: readonly SecurityAgentEvalCase[],
): Promise<SecurityAgentEvalRunResult> {
  const results: SecurityAgentEvalRunResult["cases"][number][] = [];
  for (const evalCase of cases) results.push(await runCase(evalCase));
  const passed = results.filter((item) => item.passed).length;
  return { total: results.length, passed, failed: results.length - passed, cases: results };
}

async function runCase(
  evalCase: SecurityAgentEvalCase,
): Promise<SecurityAgentEvalRunResult["cases"][number]> {
  const started = performance.now();
  const failures: string[] = [];
  let actual: ActualBoundaryResult;
  try {
    actual = await executeProfile(evalCase.input.profile);
  } catch (error) {
    actual = {
      outcome: "DENIED",
      errorCode: errorCode(error),
      boundaryCalls: 0,
      visibleCount: 0,
      sideEffectCalls: 0,
    };
  }

  for (const key of ["outcome", "boundaryCalls", "visibleCount", "sideEffectCalls"] as const) {
    if (actual[key] !== evalCase.expected[key]) {
      failures.push(`${key}: ожидалось ${evalCase.expected[key]}, получено ${actual[key]}.`);
    }
  }
  if ((actual.errorCode ?? null) !== (evalCase.expected.errorCode ?? null)) {
    failures.push(
      `errorCode: ожидалось ${evalCase.expected.errorCode ?? "none"}, получено ${actual.errorCode ?? "none"}.`,
    );
  }
  const durationMs = performance.now() - started;
  if (durationMs > evalCase.expected.maxDurationMs) {
    failures.push(`Время ${durationMs.toFixed(2)}ms превышает ${evalCase.expected.maxDurationMs}ms.`);
  }
  return {
    id: evalCase.id,
    split: evalCase.split,
    category: evalCase.category,
    passed: failures.length === 0,
    durationMs,
    failures,
  };
}

async function executeProfile(
  profile: SecurityAgentEvalCase["input"]["profile"],
): Promise<ActualBoundaryResult> {
  if (profile.startsWith("CHAT_") || profile.startsWith("COMMAND_")) {
    return executeInputSchemaProfile(profile);
  }
  if (
    profile.startsWith("SAP_") ||
    profile.startsWith("REPORT_") ||
    profile.startsWith("UNKNOWN_CITATION") ||
    profile.startsWith("NORMATIVE_") ||
    profile.startsWith("TASK_OWNER")
  ) {
    return executeCitationProfile(profile);
  }
  if (profile.startsWith("CASE_")) return executeCaseProfile(profile);
  if (profile.startsWith("ACTION_")) return executeActionProfile(profile);
  return executeCommandProfile(profile);
}

async function executeCommandProfile(
  profile: SecurityAgentEvalCase["input"]["profile"],
): Promise<ActualBoundaryResult> {
  let boundaryCalls = 0;
  const handler = {
    execute: async () => {
      boundaryCalls += 1;
      return {} as never;
    },
  };
  const handlers = Object.fromEntries(
    ["SUMMARY", "MY_TASKS", "RISKS", "STOCKS", "KPI", "ANALYSIS"].map((key) => [
      key,
      { key, ...handler },
    ]),
  ) as unknown as AgentCommandHandlerMap;
  const registry = new AgentCommandRegistry(handlers) as unknown as {
    execute(
      context: AgentExecutionContext,
      request: { commandKey: AgentCommandKey; context: AgentContextSelection },
    ): Promise<unknown>;
  };
  let commandKey: AgentCommandKey = "SUMMARY";
  let permissions = fullPermissions();
  let trustedPatch: Partial<TrustedRequestContext> = {};
  let selection: AgentContextSelection = baseSelection();
  let requested: AgentContextSelection = selection;

  switch (profile) {
    case "SUMMARY_WITHOUT_CHAT":
      permissions = without(permissions, "agent.chat");
      break;
    case "SUMMARY_WITHOUT_PROJECT_READ":
      permissions = without(permissions, "project.read");
      break;
    case "TASKS_WITHOUT_REVIEW_READ":
      commandKey = "MY_TASKS";
      permissions = without(permissions, "review.read");
      break;
    case "RISKS_WITHOUT_ANALYSIS_READ":
      commandKey = "RISKS";
      permissions = without(permissions, "analysis.read");
      break;
    case "STOCKS_WITHOUT_STOCK_SEARCH":
      commandKey = "STOCKS";
      permissions = without(permissions, "stock.search");
      break;
    case "KPI_WITHOUT_PROJECT_READ":
      commandKey = "KPI";
      permissions = without(permissions, "project.read");
      break;
    case "ANALYSIS_WITHOUT_SPECIFICATION_READ":
      commandKey = "ANALYSIS";
      permissions = without(permissions, "specification.read");
      break;
    case "ANALYSIS_WITHOUT_CATALOG_READ":
      commandKey = "ANALYSIS";
      permissions = without(permissions, "catalog.read");
      break;
    case "NO_ACTIVE_PROJECT":
      trustedPatch = { activeProjectId: null };
      selection = {};
      requested = {};
      break;
    case "EXECUTION_PROJECT_MISMATCH":
      selection = { ...selection, projectId: "project-foreign" };
      requested = selection;
      break;
    case "REQUEST_PROJECT_MISMATCH":
      requested = { ...selection, projectId: "project-foreign" };
      break;
    case "SPECIFICATION_SELECTION_MISMATCH":
      requested = { ...selection, specificationId: "spec-foreign" };
      break;
    case "POSITION_SELECTION_MISMATCH":
      requested = { ...selection, positionId: "position-foreign" };
      break;
    case "RUN_SELECTION_MISMATCH":
      requested = { ...selection, runId: "run-foreign" };
      break;
    case "PERIOD_SELECTION_MISMATCH":
      requested = {
        ...selection,
        period: { from: "2026-07-01T00:00:00.000Z", to: "2026-08-01T00:00:00.000Z" },
      };
      break;
    case "FOREIGN_WAREHOUSE_BEFORE_RETRIEVAL": {
      const context = createAgentExecutionContext(trusted(permissions), { selection });
      const handlersWithPorts = createAgentCommandHandlers(stubPorts(() => {
        boundaryCalls += 1;
      }));
      await handlersWithPorts.STOCKS.execute(
        context,
        { commandKey: "STOCKS", context: requested, filters: { warehouseIds: ["WH-FOREIGN"] } },
        validatedSelection(),
      );
      return result("DENIED", boundaryCalls);
    }
    default:
      throw new Error(`Неизвестный command security profile: ${profile}`);
  }

  const context = createAgentExecutionContext(trusted(permissions, trustedPatch), { selection });
  await registry.execute(context, { commandKey, context: requested });
  return result("DENIED", boundaryCalls);
}

async function executeInputSchemaProfile(
  profile: SecurityAgentEvalCase["input"]["profile"],
): Promise<ActualBoundaryResult> {
  switch (profile) {
    case "CHAT_USER_ID_INJECTION":
      agentChatInputSchema.parse({ message: "Покажи остаток", userId: "admin" });
      break;
    case "CHAT_PERMISSION_INJECTION":
      agentChatInputSchema.parse({ message: "Покажи остаток", permissions: ["user.manage"] });
      break;
    case "CHAT_AUTH_VERSION_INJECTION":
      agentChatInputSchema.parse({ message: "Покажи остаток", authorizationVersion: 999 });
      break;
    case "COMMAND_UNKNOWN_FILTER":
      parseAgentCommandRequest("STOCKS", { context: {}, filters: { warehouseIds: ["WH-1"], role: "SYSTEM_ADMIN" } });
      break;
    case "COMMAND_INVALID_PERIOD":
      parseAgentCommandRequest("SUMMARY", {
        context: {
          period: { from: "2026-08-13T00:00:00.000Z", to: "2026-08-12T00:00:00.000Z" },
        },
      });
      break;
    default:
      throw new Error(`Неизвестный input security profile: ${profile}`);
  }
  return result("DENIED", 0);
}

async function executeCitationProfile(
  profile: SecurityAgentEvalCase["input"]["profile"],
): Promise<ActualBoundaryResult> {
  let boundaryCalls = 0;
  const repository = citationRepository(() => {
    boundaryCalls += 1;
  });
  let context = trusted();
  let citation = savedCitation("SAP", "SAP-DEMO-0001");
  switch (profile) {
    case "SAP_PERMISSION_REVOKED":
      context = trusted(without(fullPermissions(), "stock.search"));
      break;
    case "SAP_SOURCE_REVOKED":
      context = trusted(fullPermissions(), { sourceScopeIds: ["demo-normative-001"] });
      break;
    case "SAP_WAREHOUSE_REVOKED":
      break;
    case "REPORT_RESOURCE_REVOKED":
      citation = savedCitation("REPORT", "run-foreign");
      break;
    case "UNKNOWN_CITATION_SOURCE":
      citation = savedCitation("INTERNAL_TOOL", "secret-tool-state");
      break;
    case "NORMATIVE_SOURCE_REVOKED":
      context = trusted(fullPermissions(), { sourceScopeIds: ["demo-sap-001"] });
      citation = savedCitation("NORMATIVE", "document-foreign");
      break;
    case "TASK_OWNER_SCOPE_REVOKED":
      citation = savedCitation("TASK_STORE", "task-foreign");
      break;
    default:
      throw new Error(`Неизвестный citation security profile: ${profile}`);
  }
  const visible = await reauthorizeSavedAgentCitations(context, repository, [citation]);
  return {
    outcome: "FILTERED",
    boundaryCalls,
    visibleCount: visible.length,
    sideEffectCalls: 0,
  };
}

async function executeCaseProfile(
  profile: SecurityAgentEvalCase["input"]["profile"],
): Promise<ActualBoundaryResult> {
  let boundaryCalls = 0;
  const record = caseRecord(profile === "CASE_CROSS_PROJECT_HIDDEN" ? "project-foreign" : "project-1");
  const evidence = evidenceRecord(record, { sourceScopeId: "source-revoked" });
  const store: AgentCaseStore = {
    createOrGet: async (value) => value,
    getOwned: async () => record,
    listOwned: async () => [record],
    appendEvidence: async (value) => value,
    listEvidence: async () => {
      boundaryCalls += 1;
      return [evidence];
    },
    updateStatus: async () => record,
  };
  const output = await new AgentCaseService(store).get(record.id, trusted());
  if (profile === "CASE_CROSS_PROJECT_HIDDEN") {
    return {
      outcome: output === null ? "HIDDEN" : "DENIED",
      boundaryCalls,
      visibleCount: output?.evidence.length ?? 0,
      sideEffectCalls: 0,
    };
  }
  return {
    outcome: output?.revokedEvidenceCount === 1 ? "REVOKED_EVIDENCE" : "DENIED",
    boundaryCalls,
    visibleCount: output?.evidence.length ?? 0,
    sideEffectCalls: 0,
  };
}

async function executeActionProfile(
  profile: SecurityAgentEvalCase["input"]["profile"],
): Promise<ActualBoundaryResult> {
  let proposal: AgentActionProposal | null = null;
  let sideEffectCalls = 0;
  const store: AgentActionStore = {
    createOrGetWithAudit: async (value) => {
      proposal = value;
      return value;
    },
    getAuthorized: async () => proposal,
    listAuthorized: async () => proposal ? [proposal] : [],
    claimForExecution: async () => {
      throw new Error("claim must not be reached");
    },
    completeWithAudit: async () => {
      throw new Error("complete must not be reached");
    },
    failWithAudit: async () => {
      throw new Error("failure must not be reached");
    },
    cancelWithAudit: async () => {
      throw new Error("cancel must not be reached");
    },
  };
  const executor: AgentActionExecutor = {
    resolveCurrent: async (value) => value.resource,
    execute: async () => {
      sideEffectCalls += 1;
      throw new Error("side effect must not be reached");
    },
  };
  const now = () => new Date("2026-08-13T12:00:00.000Z");
  const service = new AgentActionService(store, executor, now);
  const creator = trusted(new Set(["agent.chat", "analysis.create"]));
  const created = await service.propose({
    caseId: "case-security-eval",
    actionType: "RUN_SCENARIO",
    resource: {
      resourceType: "SCENARIO_TEMPLATE",
      resourceId: "scenario-full-analysis",
      projectId: "project-1",
      ownerUserId: "subject-1",
      status: "AVAILABLE",
    },
    summary: "Запустить стандартный анализ",
    consequences: ["Будет создан только разрешённый запуск"],
    parameters: { specificationId: "spec-1" },
    requestKey: "security-action",
  }, creator);
  const current = profile === "ACTION_AUTH_VERSION_REVOKED"
    ? trusted(new Set(["agent.chat", "analysis.create"]), { authorizationVersion: 8 })
    : trusted(new Set(["agent.chat"]));
  await service.confirm(created.id, current);
  return {
    outcome: "DENIED",
    boundaryCalls: 0,
    visibleCount: 0,
    sideEffectCalls,
  };
}

function trusted(
  permissionKeys: ReadonlySet<PermissionKey> = fullPermissions(),
  patch: Partial<TrustedRequestContext> = {},
): TrustedRequestContext {
  return {
    subjectId: "subject-1",
    displayName: "Аналитик",
    activeRoleAssignmentIds: ["assignment-1"],
    globalRoleKeys: [],
    activeProjectId: "project-1",
    projectRoleKeys: ["MTR_ANALYST"],
    permissionKeys,
    catalogScopeIds: ["catalog-1"],
    sourceScopeIds: ["demo-sap-001", "demo-normative-001", "demo-system-config-001"],
    accessClaims: { warehouseIds: ["WH-1"] },
    authorizationVersion: 7,
    requestId: "request-security-eval",
    ...patch,
  };
}

function fullPermissions(): ReadonlySet<PermissionKey> {
  return new Set<PermissionKey>([
    "agent.chat",
    "project.read",
    "review.read",
    "analysis.read",
    "stock.search",
    "specification.read",
    "catalog.read",
    "report.read",
    "analysis.create",
  ]);
}

function without(values: ReadonlySet<PermissionKey>, denied: PermissionKey): ReadonlySet<PermissionKey> {
  const output = new Set(values);
  output.delete(denied);
  return output;
}

function baseSelection(): AgentContextSelection {
  return {
    projectId: "project-1",
    specificationId: "spec-1",
    positionId: "position-1",
    runId: "run-1",
    period: { from: "2026-06-01T00:00:00.000Z", to: "2026-07-01T00:00:00.000Z" },
  };
}

function validatedSelection(): ValidatedAgentSelection {
  return {
    projectId: "project-1",
    validatedSubjectId: "subject-1",
    validatedAgainstAuthorizationVersion: 7,
    validationRequestId: "request-security-eval",
  };
}

function stubPorts(onStockRead: () => void): AgentOrchestratorPorts {
  const evidence = {
    availability: "COMPLETE",
    confidence: 1,
    coverage: {
      requestedScope: ["project-1"],
      checkedScope: ["project-1"],
      complete: true,
    },
    citations: [],
    missingData: [],
  } as const;
  return {
    summary: { read: async () => ({ facts: [], evidence }) },
    tasks: { listMine: async () => ({ items: [], evidence }) },
    risks: { evaluate: async () => ({ items: [], evidence }) },
    stocks: {
      search: async () => {
        onStockRead();
        return { items: [], evidence };
      },
    },
    metrics: { calculate: async () => ({ metrics: [], evidence }) },
  };
}

function citationRepository(onRead: () => void): AgentCitationReadPort {
  return {
    getSpecification: async () => {
      onRead();
      return null;
    },
    getPosition: async () => {
      onRead();
      return null;
    },
    getSapMaterialStock: async () => {
      onRead();
      return [{ storageLocation: "WH-FOREIGN" }] as never;
    },
    getCatalogItemByCode: async () => {
      onRead();
      return null;
    },
    getScenarioRunInProject: async () => {
      onRead();
      return null;
    },
    listNormativeChunks: async () => {
      onRead();
      return [];
    },
    listAgentMetricEvents: async () => {
      onRead();
      return [];
    },
    listMaterialMovements: async () => {
      onRead();
      return [];
    },
    listAnalysisReviewTasksInProject: async () => {
      onRead();
      return [];
    },
    listAgentAssignedTasksInProject: async () => {
      onRead();
      return [];
    },
  };
}

function savedCitation(sourceSystem: string, entityId: string) {
  return { sourceSystem, entityId, versionOrSnapshot: "v1", clauseId: null };
}

function caseRecord(projectId: string): AgentCaseRecord {
  return {
    id: "case-security-eval",
    tenantId: "demo-tenant-001",
    projectId,
    ownerSubjectId: "subject-1",
    threadId: null,
    status: "DRAFT",
    title: "Проверка доступа",
    contextSnapshot: {},
    authorizationVersion: 7,
    roleAssignmentSnapshot: ["assignment-1"],
    createdAt: "2026-08-13T12:00:00.000Z",
    updatedAt: "2026-08-13T12:00:00.000Z",
    version: 1,
  };
}

function evidenceRecord(
  record: AgentCaseRecord,
  accessAttributes: Readonly<Record<string, unknown>>,
): AgentEvidenceFactRecord {
  return {
    id: "evidence-security-eval",
    tenantId: record.tenantId,
    projectId: record.projectId,
    caseId: record.id,
    kind: "STOCK",
    summary: "Остаток",
    sourceSystem: "SAP",
    entityId: "SAP-DEMO-0001",
    versionOrSnapshot: "v1",
    clauseId: null,
    observedAt: "2026-08-13T12:00:00.000Z",
    sourceSnapshotAt: "2026-08-13T11:59:00.000Z",
    freshness: "FRESH",
    payload: {},
    accessAttributes,
    fingerprint: "fingerprint-security-eval",
    authorizationVersion: 7,
    roleAssignmentSnapshot: ["assignment-1"],
    createdBySubjectId: "subject-1",
    createdAt: "2026-08-13T12:00:00.000Z",
    updatedAt: "2026-08-13T12:00:00.000Z",
    version: 1,
  };
}

function result(
  outcome: ActualBoundaryResult["outcome"],
  boundaryCalls: number,
): ActualBoundaryResult {
  return { outcome, boundaryCalls, visibleCount: 0, sideEffectCalls: 0 };
}

function errorCode(error: unknown): string {
  if (error instanceof z.ZodError) return "INPUT_REJECTED";
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  if (error instanceof Error && error.name === "AuthorizationError") return "AUTHORIZATION_DENIED";
  return error instanceof Error ? error.name : "UNKNOWN_ERROR";
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const output: Record<string, number> = {};
  for (const item of items) output[key(item)] = (output[key(item)] ?? 0) + 1;
  return output;
}
