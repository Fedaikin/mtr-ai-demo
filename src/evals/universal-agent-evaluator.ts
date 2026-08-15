import { readFile } from "node:fs/promises";

import { z } from "zod";

import { generateUniversalChatDataset } from "@/adapters/mock/fixtures/universal-chat-dataset";
import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { seedIndustrialCatalogue } from "@/adapters/persistence/catalog-bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { createUniversalAgentReadPort } from "@/adapters/persistence/universal-agent-read-port";
import { seedUniversalChatDataset } from "@/adapters/persistence/universal-chat-bootstrap";
import type { TrustedRequestContext } from "@/application/authorization-service";
import { createUniversalReadCapabilityRegistry } from "@/application/agent-orchestrator/universal-chat/read-capabilities";
import { projectUniversalAgentOutput } from "@/application/agent-orchestrator/universal-chat/public-projection";
import {
  UniversalChatService,
  type UniversalChatMemory,
} from "@/application/agent-orchestrator/universal-chat/universal-chat-service";
import { createAgentExecutionContext } from "@/domain/agent/context";
import type { UniversalAgentAnswer } from "@/domain/agent/universal-chat/answer";
import { createFixedScenarioClock } from "@/domain/agent/universal-chat/scenario-clock";
import { DEMO_USER_ID } from "@/domain/models";
import type { PermissionKey } from "@/domain/rbac";

export const EXPECTED_UNIVERSAL_AGENT_EVAL_CASES = 158;
const CLOCK_INSTANT = "2026-08-13T09:15:00.000Z";

const categorySchema = z.enum([
  "project-material",
  "compatibility-reliability",
  "portfolio-intake-deadline",
  "multi-turn-context",
  "permission-abstention",
  "public-projection",
  "parameterized-scale",
  "corrective-remediation",
]);

const manifestSchema = z.object({
  schemaVersion: z.literal("mtr-agent-universal-eval-manifest-v1"),
  datasetVersion: z.literal("universal-chat-v1@1.0.0-DEMO"),
  runtimeBoundary: z.literal("UNIVERSAL_CHAT_SERVICE_WITH_SCOPED_PERSISTENCE_PORT"),
  scenarioClock: z.literal(CLOCK_INSTANT),
  expectedCases: z.literal(EXPECTED_UNIVERSAL_AGENT_EVAL_CASES),
  categories: z.record(categorySchema, z.number().int().positive()),
  minimums: z.object({
    businessProjects: z.number().int().min(20),
    materialFamilies: z.number().int().min(25),
    multiTurnConversations: z.number().int().min(20),
    permissionOrAbstentionCases: z.number().int().min(15),
    publicBoundaryCases: z.number().int().min(15),
    maxCaseDurationMs: z.number().positive().max(15_000),
    maxPublicPayloadBytes: z.number().int().positive().max(500_000),
  }).strict(),
  isSyntheticDemo: z.literal(true),
}).strict();

export type UniversalEvalCategory = z.infer<typeof categorySchema>;
export type UniversalAgentEvalManifest = z.infer<typeof manifestSchema>;

interface UniversalEvalCase {
  readonly id: string;
  readonly category: UniversalEvalCategory;
  readonly message: string;
  readonly variant:
    | "PROJECT_SPECIFICATIONS"
    | "PROJECT_MATERIALS"
    | "COMPATIBILITY"
    | "PORTFOLIO"
    | "MULTI_TURN"
    | "MISSING_PERMISSION"
    | "FOREIGN_SCOPE"
    | "UNKNOWN_MATERIAL"
    | "PUBLIC_PROJECTION"
    | "SCALE"
    | "CORRECTIVE_ACTIVE"
    | "CORRECTIVE_PLANNED"
    | "CORRECTIVE_ALL"
    | "CORRECTIVE_INVENTORY"
    | "CORRECTIVE_WAREHOUSE"
    | "CORRECTIVE_UNKNOWN";
  readonly projectId?: string;
  readonly projectCode?: string;
  readonly followUp?: string;
}

export interface UniversalAgentEvalCaseResult {
  readonly id: string;
  readonly category: UniversalEvalCategory;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly publicBytes: number;
  readonly failures: readonly string[];
}

export interface UniversalAgentEvalRunResult {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly p95DurationMs: number;
  readonly maxPublicBytes: number;
  readonly cases: readonly UniversalAgentEvalCaseResult[];
}

export async function loadUniversalAgentEvalManifest(filePath: string): Promise<UniversalAgentEvalManifest> {
  const value = manifestSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
  const categoryTotal = Object.values(value.categories).reduce((sum, count) => sum + count, 0);
  if (categoryTotal !== value.expectedCases) {
    throw new Error(`Universal eval manifest содержит ${categoryTotal} вместо ${value.expectedCases} кейсов.`);
  }
  return value;
}

export function buildUniversalAgentEvalCases(
  manifest: UniversalAgentEvalManifest,
): readonly UniversalEvalCase[] {
  const clock = createFixedScenarioClock(manifest.scenarioClock);
  const dataset = generateUniversalChatDataset(clock);
  const projects = dataset.businessProjects.slice(0, 20);
  const familySources = dataset.operationalMaterials
    .filter((material) => material.familyId && material.itemKind === "COMPONENT")
    .filter((material, index, rows) => rows.findIndex((candidate) => candidate.familyId === material.familyId) === index)
    .slice(0, 25);
  if (projects.length < manifest.minimums.businessProjects) throw new Error("Недостаточно проектов для universal eval.");
  if (familySources.length < manifest.minimums.materialFamilies) throw new Error("Недостаточно семейств для universal eval.");

  const projectCases = projects.flatMap((project, index): UniversalEvalCase[] => [
    {
      id: `UNI-PROJECT-${pad(index + 1)}-SPEC`,
      category: "project-material",
      variant: "PROJECT_SPECIFICATIONS",
      projectId: project.id,
      projectCode: project.code,
      message: `Покажи актуальные спецификации проекта ${project.code}`,
    },
    {
      id: `UNI-PROJECT-${pad(index + 1)}-MATERIAL`,
      category: "project-material",
      variant: "PROJECT_MATERIALS",
      projectId: project.id,
      projectCode: project.code,
      message: `Какой материальный баланс по проекту ${project.name}?`,
    },
  ]);

  const compatibilityCases = familySources.map((source, index): UniversalEvalCase => {
    const candidate = dataset.operationalMaterials.find((material) =>
      material.familyId === source.familyId && material.materialCode !== source.materialCode,
    );
    if (!candidate) throw new Error(`Нет кандидата для ${source.familyId}`);
    const reliability = index % 3 === 0;
    return {
      id: `UNI-COMPAT-${pad(index + 1)}`,
      category: "compatibility-reliability",
      variant: "COMPATIBILITY",
      message: reliability
        ? `Что надёжнее: ${source.catalogItemCode} или ${candidate.catalogItemCode}, и совместимы ли они?`
        : `На сколько процентов ${source.catalogItemCode} совместима с ${candidate.catalogItemCode} и почему?`,
    };
  });

  const portfolioMessages = [
    "Покажи активные проекты",
    "Какие активные проекты доступны?",
    "Покажи список текущих проектов",
    "Какие текущие проекты есть в моём контуре?",
    "Какие ближайшие сроки?",
    "Покажи сроки на ближайшие 3 дня",
    "Какие дедлайны в следующие 3 дня?",
    "Сроки в ближайшие три дня",
    "Сколько спецификаций упало сегодня?",
    "Что со спецификациями, поступившими сегодня?",
    "Сколько спецификаций пришло сегодня?",
    "Сколько спецификаций загрузили сегодня?",
    "Сколько спецификаций упало сегодня с ошибкой?",
    "Что со спецификациями с ошибкой сегодня?",
    "Сколько спецификаций загрузилось с ошибкой сегодня?",
    "Сколько спецификаций поступило сегодня со сбоем?",
    "Что сейчас в очереди?",
    "Что сейчас в очереди обработки спецификаций?",
    "Сколько спецификаций осталось обработать?",
    "Что осталось обработать по спецификациям?",
  ];
  const portfolioCases = portfolioMessages.map((message, index): UniversalEvalCase => ({
    id: `UNI-PORTFOLIO-${pad(index + 1)}`,
    category: "portfolio-intake-deadline",
    variant: "PORTFOLIO",
    message,
  }));

  const multiTurnCases = projects.map((project, index): UniversalEvalCase => ({
    id: `UNI-MULTI-${pad(index + 1)}`,
    category: "multi-turn-context",
    variant: "MULTI_TURN",
    projectId: project.id,
    projectCode: project.code,
    message: `Покажи материалы проекта ${project.code}`,
    followUp: "А теперь покажи спецификации этого проекта только для обслуживания.",
  }));

  const securityCases: UniversalEvalCase[] = [
    ...familySources.slice(0, 5).map((source, index): UniversalEvalCase => ({
      id: `UNI-DENY-${pad(index + 1)}`,
      category: "permission-abstention",
      variant: "MISSING_PERMISSION",
      message: `Покажи остаток материала ${source.catalogItemCode}`,
    })),
    ...Array.from({ length: 5 }, (_, index): UniversalEvalCase => ({
      id: `UNI-SCOPE-${pad(index + 1)}`,
      category: "permission-abstention",
      variant: "FOREIGN_SCOPE",
      message: ["Покажи активные проекты", "Какие проекты под риском?", "Что закончится в ближайшие 30 дней?", "Какие ближайшие сроки?", "Что сейчас в очереди?"][index]!,
    })),
    ...Array.from({ length: 5 }, (_, index): UniversalEvalCase => ({
      id: `UNI-UNKNOWN-${pad(index + 1)}`,
      category: "permission-abstention",
      variant: "UNKNOWN_MATERIAL",
      message: `Что это за материал CAT-DEMO-NOT-${pad(index + 1)}?`,
    })),
  ];

  const publicCases = projects.slice(0, 15).map((project, index): UniversalEvalCase => ({
    id: `UNI-PUBLIC-${pad(index + 1)}`,
    category: "public-projection",
    variant: "PUBLIC_PROJECTION",
    projectId: project.id,
    projectCode: project.code,
    message: `Сформируй карточку материального состояния проекта ${project.code}`,
  }));

  const scaleCases = projects.slice(0, 15).map((project, index): UniversalEvalCase => ({
    id: `UNI-SCALE-${pad(index + 1)}`,
    category: "parameterized-scale",
    variant: "SCALE",
    projectId: project.id,
    projectCode: project.code,
    message: `Покажи полный материальный баланс и риски проекта ${project.code}`,
  }));

  const correctiveCases: UniversalEvalCase[] = [
    { id: "REMEDIAL-CHAT-001", category: "corrective-remediation", variant: "CORRECTIVE_ACTIVE", message: "Покажи активные проекты" },
    { id: "REMEDIAL-CHAT-002", category: "corrective-remediation", variant: "CORRECTIVE_ACTIVE", message: "Выведи список текущих проектов" },
    { id: "REMEDIAL-CHAT-003", category: "corrective-remediation", variant: "CORRECTIVE_PLANNED", message: "Покажи запланированные проекты" },
    { id: "REMEDIAL-CHAT-004", category: "corrective-remediation", variant: "CORRECTIVE_ALL", message: "Покажи все проекты" },
    { id: "REMEDIAL-CHAT-005", category: "corrective-remediation", variant: "CORRECTIVE_INVENTORY", message: "Есть ли на WH-DEMO-CENTRAL шкаф управления электродвигателем № 0001?" },
    { id: "REMEDIAL-CHAT-006", category: "corrective-remediation", variant: "CORRECTIVE_INVENTORY", message: "Есть ли шкаф управления электродвигателем № 0001 на WH-DEMO-CENTRAL?" },
    { id: "REMEDIAL-CHAT-007", category: "corrective-remediation", variant: "CORRECTIVE_WAREHOUSE", message: "Есть ли на втором складке шкаф управления электродвигателем № 0001?" },
    { id: "REMEDIAL-CHAT-008", category: "corrective-remediation", variant: "CORRECTIVE_UNKNOWN", message: "Есть ли на WH-DEMO-CENTRAL шкаф управления электродвигателем № 9999?" },
  ];

  const cases = [
    ...projectCases,
    ...compatibilityCases,
    ...portfolioCases,
    ...multiTurnCases,
    ...securityCases,
    ...publicCases,
    ...scaleCases,
    ...correctiveCases,
  ];
  validateCurriculum(cases, manifest);
  return Object.freeze(cases);
}

export async function runUniversalAgentEvals(
  manifest: UniversalAgentEvalManifest,
): Promise<UniversalAgentEvalRunResult> {
  const cases = buildUniversalAgentEvalCases(manifest);
  const clock = createFixedScenarioClock(manifest.scenarioClock);
  const database = await getDatabase({ migrations: "ensure" });
  await resetDemoDatabase(DEMO_USER_ID, database);
  await seedIndustrialCatalogue(DEMO_USER_ID, database);
  await seedUniversalChatDataset(DEMO_USER_ID, database, clock);
  const service = new UniversalChatService(
    createUniversalReadCapabilityRegistry(createUniversalAgentReadPort(database), clock),
    clock,
  );
  const results: UniversalAgentEvalCaseResult[] = [];
  try {
    for (const evalCase of cases) {
      results.push(await runCase(evalCase, service, manifest));
    }
  } finally {
    await closeDatabase();
  }
  const passed = results.filter((item) => item.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    p95DurationMs: nearestRank(results.map((item) => item.durationMs), 0.95),
    maxPublicBytes: Math.max(...results.map((item) => item.publicBytes), 0),
    cases: results,
  };
}

async function runCase(
  evalCase: UniversalEvalCase,
  service: UniversalChatService,
  manifest: UniversalAgentEvalManifest,
): Promise<UniversalAgentEvalCaseResult> {
  const started = performance.now();
  const failures: string[] = [];
  let publicBytes = 0;
  const normalContext = executionContext(evalCase.id);
  try {
    if (evalCase.variant === "MISSING_PERMISSION") {
      const permissions = new Set(normalContext.trusted.permissionKeys);
      permissions.delete("stock.search");
      const restricted = executionContext(evalCase.id, { permissionKeys: permissions });
      await expectFailure(
        () => service.respond({ message: evalCase.message }, restricted),
        "UNIVERSAL_CAPABILITY_FORBIDDEN",
        failures,
      );
    } else {
      const context = evalCase.variant === "FOREIGN_SCOPE"
        ? executionContext(evalCase.id, { activeProjectId: "foreign-project" })
        : normalContext;
      const output = await service.respond({ message: evalCase.message }, context);
      if (!output) {
        failures.push("Current universal runtime не распознал production-shaped запрос.");
      } else if (evalCase.variant === "CORRECTIVE_WAREHOUSE") {
        if (!("kind" in output) || output.kind !== "ASK_CLARIFICATION") {
          failures.push("Неоднозначный склад не завершился целевым уточнением.");
        } else if (output.candidates.map((candidate) => candidate.code).join(",") !== "WH-DEMO-CENTRAL,WH-DEMO-SOUTH") {
          failures.push("Список складов не совпал с разрешённым oracle объекта.");
        }
      } else if (evalCase.variant === "UNKNOWN_MATERIAL" || evalCase.variant === "CORRECTIVE_UNKNOWN") {
        if ("kind" in output) {
          if (output.candidates.some((candidate) => candidate.kind !== "MATERIAL")) {
            failures.push("Unknown material ушёл в несвязанный project-контекст.");
          }
        } else if (output.confidence !== 0 || output.citations.length !== 0 || !output.requiresHumanReview) {
          failures.push("Unknown material не завершился честным abstention.");
        }
      } else if ("kind" in output) {
        failures.push("Ожидался доказательный ответ, получено уточнение.");
      } else {
        await verifyAnswer(evalCase, output, service, context, failures);
        const projection = projectUniversalAgentOutput({
          schemaVersion: "universal-agent-answer-v1",
          output,
          resolvedContext: output.resolvedContext,
          runtime: output.runtime,
        });
        if (!projection) failures.push("Public projection отклонила валидный universal answer.");
        const serialized = JSON.stringify(projection);
        publicBytes = Buffer.byteLength(serialized, "utf8");
        if (/resolvedContext|toolCalls|runtime|providerVersion|scoreBreakdown|learningProvenance/iu.test(serialized)) {
          failures.push("Public projection раскрывает private runtime/context.");
        }
        if (publicBytes > manifest.minimums.maxPublicPayloadBytes) {
          failures.push(`Public payload ${publicBytes} B превышает лимит.`);
        }
      }
    }
  } catch (error) {
    failures.push(`Неожиданная universal runtime ошибка: ${errorCode(error)}.`);
  }
  const durationMs = performance.now() - started;
  if (durationMs > manifest.minimums.maxCaseDurationMs) {
    failures.push(`Время ${durationMs.toFixed(2)}ms превышает ${manifest.minimums.maxCaseDurationMs}ms.`);
  }
  return {
    id: evalCase.id,
    category: evalCase.category,
    passed: failures.length === 0,
    durationMs,
    publicBytes,
    failures,
  };
}

async function verifyAnswer(
  evalCase: UniversalEvalCase,
  output: UniversalAgentAnswer,
  service: UniversalChatService,
  context: ReturnType<typeof executionContext>,
  failures: string[],
): Promise<void> {
  if (evalCase.variant === "PROJECT_SPECIFICATIONS") {
    if (!output.tables.some((table) => table.id === "project-specifications")) failures.push("Нет таблицы спецификаций проекта.");
    if (output.resolvedContext.businessProject?.id !== evalCase.projectId) failures.push("Смешан businessProject context.");
  }
  if (["PROJECT_MATERIALS", "PUBLIC_PROJECTION", "SCALE"].includes(evalCase.variant)) {
    if (!output.tables.some((table) => table.id === "project-material-balance")) failures.push("Нет проектного материального баланса.");
    if (output.resolvedContext.businessProject?.id !== evalCase.projectId) failures.push("Смешан businessProject context.");
    if (output.citations.length === 0) failures.push("Материальный вывод не имеет citations.");
  }
  if (evalCase.variant === "COMPATIBILITY") {
    if (output.compatibility.length === 0) failures.push("Не рассчитана совместимость явно названной пары.");
    if (/надёжн/iu.test(evalCase.message) && output.recommendations.length === 0) failures.push("Нет отдельного вывода по надёжности.");
  }
  if (evalCase.variant === "PORTFOLIO") {
    if (output.tables.length === 0 || output.facts.length === 0) failures.push("Портфельный ответ не содержит facts/table.");
  }
  if (evalCase.variant === "CORRECTIVE_ACTIVE") {
    if (output.tables[0]?.totalRows !== 22 || output.tables[0].rows.some((row) => row["Статус"] !== "Активен")) {
      failures.push("Active-project semantics не совпали с oracle 22 ACTIVE.");
    }
  }
  if (evalCase.variant === "CORRECTIVE_PLANNED") {
    if (output.tables[0]?.totalRows !== 0 || output.confidence !== 1) failures.push("Пустой PLANNED scope не доказан честно.");
  }
  if (evalCase.variant === "CORRECTIVE_ALL") {
    if (output.tables[0]?.totalRows !== 22) failures.push("All-project scope не совпал с oracle.");
  }
  if (evalCase.variant === "CORRECTIVE_INVENTORY") {
    if (output.resolvedContext.material?.code !== "SAP-CATALOG-ASM-ELC-0001") failures.push("Full-object material разрешён неверно.");
    if (!output.facts.some((item) => item.key === "warehouse-on-hand" && item.value === 4 && item.unit === "EA")) {
      failures.push("Складской остаток не совпал с oracle.");
    }
  }
  if (evalCase.variant === "FOREIGN_SCOPE") {
    if (output.confidence !== 0 || output.citations.length !== 0 || !output.requiresHumanReview) {
      failures.push("Foreign scope не завершился fail-closed ответом.");
    }
  }
  if (evalCase.variant === "MULTI_TURN") {
    const shortageCodes = output.risks.flatMap((risk) => risk.materialCode ? [risk.materialCode] : []);
    const memory: UniversalChatMemory = {
      resolvedContext: output.resolvedContext,
      shortageMaterialCodes: shortageCodes,
    };
    const followUp = await service.respond({ message: evalCase.followUp!, memory }, context);
    if (!followUp || "kind" in followUp) {
      failures.push("Multi-turn follow-up потерял проектный контекст.");
    } else {
      if (followUp.resolvedContext.businessProject?.id !== evalCase.projectId) failures.push("Follow-up смешал проект.");
      if (followUp.resolvedContext.purpose !== "MAINTENANCE") failures.push("Follow-up потерял purpose.");
      if (!followUp.tables.some((table) => table.id === "project-specifications")) failures.push("Follow-up не вернул спецификации.");
    }
  }
}

async function expectFailure(
  operation: () => Promise<unknown>,
  expectedCode: string,
  failures: string[],
): Promise<void> {
  try {
    await operation();
    failures.push(`Ожидалась ошибка ${expectedCode}.`);
  } catch (error) {
    if (errorCode(error) !== expectedCode) failures.push(`Ожидалась ${expectedCode}, получена ${errorCode(error)}.`);
  }
}

function executionContext(
  requestId: string,
  patch: Partial<TrustedRequestContext> = {},
) {
  const permissionKeys = new Set<PermissionKey>([
    "agent.chat",
    "project.read",
    "specification.read",
    "specification.history.read",
    "catalog.read",
    "catalog.substitutes.read",
    "catalog.bom.read",
    "stock.search",
    "analysis.read",
    "analysis.create",
    "review.read",
    "review.queue.read",
  ]);
  return createAgentExecutionContext({
    subjectId: DEMO_USER_ID,
    displayName: "Демо-пользователь 1",
    activeRoleAssignmentIds: ["assignment-demo-project-manager"],
    globalRoleKeys: [],
    activeProjectId: "demo-project-001",
    projectRoleKeys: ["PROJECT_MANAGER"],
    permissionKeys,
    catalogScopeIds: ["demo-catalog-001"],
    sourceScopeIds: ["demo-sap-001", "demo-normative-001", "demo-system-config-001"],
    accessClaims: { warehouseIds: [
      "WH-DEMO-NORTH",
      "WH-DEMO-CENTRAL",
      "WH-DEMO-ELECTRICAL",
      "WH-DEMO-SOUTH",
      "WH-DEMO-INSTRUMENT",
      "WH-DEMO-EQUIPMENT",
      "WH-DEMO-RESERVE",
    ] },
    authorizationVersion: 1,
    requestId,
    ...patch,
  });
}

function validateCurriculum(
  cases: readonly UniversalEvalCase[],
  manifest: UniversalAgentEvalManifest,
): void {
  if (cases.length !== manifest.expectedCases) throw new Error(`Получено ${cases.length} universal eval-кейсов.`);
  if (new Set(cases.map((item) => item.id)).size !== cases.length) throw new Error("Universal eval IDs должны быть уникальными.");
  const counts = Object.fromEntries([...categorySchema.options].map((category) => [
    category,
    cases.filter((item) => item.category === category).length,
  ]));
  for (const category of categorySchema.options) {
    if (counts[category] !== manifest.categories[category]) {
      throw new Error(`Категория ${category}: ${counts[category]} вместо ${manifest.categories[category]}.`);
    }
  }
  if (cases.filter((item) => item.variant === "MULTI_TURN").length < manifest.minimums.multiTurnConversations) throw new Error("Недостаточно multi-turn eval.");
  if (cases.filter((item) => ["MISSING_PERMISSION", "FOREIGN_SCOPE", "UNKNOWN_MATERIAL"].includes(item.variant)).length < manifest.minimums.permissionOrAbstentionCases) throw new Error("Недостаточно permission/abstention eval.");
  if (cases.filter((item) => item.variant === "PUBLIC_PROJECTION").length < manifest.minimums.publicBoundaryCases) throw new Error("Недостаточно public-boundary eval.");
}

function nearestRank(values: readonly number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)] ?? 0;
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : error instanceof Error
      ? error.message
      : "UNKNOWN";
}

function pad(value: number): string {
  return String(value).padStart(3, "0");
}
