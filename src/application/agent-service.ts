import { buildAnalogueCoverage } from "@/domain/analogues";
import type {
  AnalogueRule,
  GroundedAgentOutput,
  GroundedCitation,
  IntegrationState,
  Position,
  PositionAnalysisResult,
  ReportSummary,
  ResponsibilityRule,
  SapMaterial,
  ScenarioRun,
  Specification,
  SpecificationVersion,
} from "@/domain/models";
import { normalizeText, tokenSimilarity } from "@/domain/normalize";
import {
  resolveDictionaryKeys,
  tokenizeWithDictionary,
  type SearchDictionaryEntry,
} from "@/domain/search-dictionary";
import type {
  AppiusPort,
  AuditPort,
  CatalogAssemblyBom,
  CatalogItem,
  CatalogItemWithStock,
  CatalogPort,
  CatalogSearchItem,
  CatalogSearchResult,
  CatalogSubstituteResult,
  GroundedAgentInput,
  LLMProvider,
  NormativePort,
  SapStockPort,
  ScenarioPort,
  StockSearchResult,
} from "@/ports";
import { redactSensitiveRecord } from "@/lib/redaction";
import { z } from "zod";

interface GroundedFactEnvelope<T = unknown> {
  data: T;
  citations?: GroundedCitation[];
}

export const agentMessageInputSchema = z
  .object({
    message: z.string().trim().min(1).max(4_000),
    threadId: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

/** HTTP bodies are parsed with this schema; userId is deliberately absent. */
export const agentInputSchema = agentMessageInputSchema;

export const trustedAgentRequestSchema = agentMessageInputSchema
  .extend({
    userId: z.string().trim().min(1).max(160),
    correlationId: z.string().trim().min(1).max(160).optional(),
    promptVersion: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

export type AgentMessageInput = z.infer<typeof agentMessageInputSchema>;
export type TrustedAgentRequest = z.infer<typeof trustedAgentRequestSchema>;

export interface ScenarioAgentPort extends ScenarioPort {
  getPositionResult?(
    runId: string,
    positionId: string,
    userId: string,
  ): Promise<PositionAnalysisResult | null>;
}

export interface ReportPort {
  getSummary(runId: string, userId: string): Promise<ReportSummary | null>;
}

export interface AgentServiceDependencies {
  appius: AppiusPort;
  sap: SapStockPort;
  catalog?: CatalogPort;
  norms: NormativePort;
  scenarios: ScenarioAgentPort;
  reports: ReportPort;
  llm: LLMProvider;
  audit: AuditPort;
  dictionaries?: {
    listActive(userId: string): Promise<SearchDictionaryEntry[]>;
  };
}

type AgentIntent =
  | "CATALOG"
  | "SPECIFICATION"
  | "STOCK"
  | "RESPONSIBILITY"
  | "ANALOGUE"
  | "RUN"
  | "REPORT";

interface ToolCallRecord {
  tool: string;
  outcome: "OK" | "ERROR";
  durationMs: number;
}

interface RequestContext {
  userId: string;
  message: string;
  threadId?: string;
  facts: GroundedAgentInput["facts"];
  citations: GroundedCitation[];
  toolCalls: ToolCallRecord[];
  appiusStateChecked: boolean;
  appiusAvailable: boolean;
  appiusState?: IntegrationState;
  sapStateChecked: boolean;
  sapAvailable: boolean;
  sapState?: IntegrationState;
  attemptedUserOverride: boolean;
  searchDictionary: SearchDictionaryEntry[];
  run?: ScenarioRun | null;
  correlationId: string;
  promptVersion: string;
  runId?: string;
}

const integrationStateSchema = z
  .object({
    system: z.enum(["APPIUS", "SAP", "RAG", "LLM"]),
    state: z.enum([
      "AVAILABLE",
      "UNAVAILABLE",
      "SLOW",
      "ACCESS_DENIED",
      "STALE_VERSION",
      "STALE",
      "RATE_LIMITED",
      "MALFORMED_RESPONSE",
    ]),
    delayMs: z.number().nonnegative(),
    snapshotAt: z.string().optional(),
    lastSynchronizedAt: z.string().optional(),
    safeMessage: z.string().max(500).optional(),
  })
  .passthrough();

const specificationSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    projectCode: z.string(),
    name: z.string(),
    latestVersionId: z.string(),
    latestVersionNumber: z.number(),
    positionCount: z.number().nonnegative(),
  })
  .passthrough();

const specificationVersionSchema = z
  .object({
    id: z.string(),
    specificationId: z.string(),
    userId: z.string(),
    versionNumber: z.number(),
    isCurrent: z.boolean(),
    status: z.enum(["ACTIVE", "SUPERSEDED"]),
    effectiveAt: z.string(),
    positionCount: z.number().nonnegative(),
  })
  .passthrough();

const positionSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    internalCode: z.string(),
    nameRu: z.string(),
    nameEn: z.string().optional(),
    synonyms: z.array(z.string()),
    equipmentType: z.string(),
    standard: z.string().optional(),
    materialGrade: z.string().optional(),
    dimensions: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])),
    requiredQuantity: z.number().nonnegative(),
    unit: z.string(),
    specificationId: z.string(),
    specificationName: z.string().optional(),
    versionId: z.string(),
    versionNumber: z.number(),
    isCurrentVersion: z.boolean(),
    classification: z.record(z.string(), z.string()),
    access: z.record(z.string(), z.unknown()),
    fixtureTags: z.array(z.string()).optional(),
  })
  .passthrough();

const sapMaterialSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    materialCode: z.string(),
    nameRu: z.string(),
    nameEn: z.string().optional(),
    synonyms: z.array(z.string()),
    legacyCode: z.string().optional(),
    equipmentType: z.string(),
    standard: z.string().optional(),
    materialGrade: z.string().optional(),
    dimensions: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])),
    tolerances: z
      .record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()]))
      .optional(),
    plant: z.string(),
    storageLocation: z.string(),
    batch: z.string().optional(),
    availableQuantity: z.number().nonnegative(),
    unit: z.string(),
    snapshotAt: z.string(),
    cardUrl: z.string(),
    fixtureTags: z.array(z.string()).optional(),
    sourcePositionId: z.string().optional(),
  })
  .passthrough();

const catalogScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const catalogFamilySchema = z
  .object({
    id: z.string(),
    code: z.string(),
    nameRu: z.string(),
    nameEn: z.string().optional(),
    equipmentType: z.string(),
    itemKind: z.enum(["COMPONENT", "ASSEMBLY"]),
    unit: z.string(),
    compatibilitySignature: z.record(z.string(), catalogScalarSchema),
    active: z.boolean(),
    isSyntheticDemo: z.boolean(),
  })
  .passthrough();

const catalogItemSchema = z
  .object({
    id: z.string(),
    itemCode: z.string(),
    legacyCode: z.string().optional(),
    manufacturerPartNumber: z.string().optional(),
    nameRu: z.string(),
    nameEn: z.string().optional(),
    synonyms: z.array(z.string()),
    equipmentType: z.string(),
    itemKind: z.enum(["COMPONENT", "ASSEMBLY"]),
    category: z
      .enum(["PIPING", "VALVES", "INSTRUMENTATION", "ELECTRICAL", "ROTATING", "MRO"])
      .optional(),
    familyId: z.string().optional(),
    manufacturer: z.string().optional(),
    standard: z.string().optional(),
    materialGrade: z.string().optional(),
    characteristics: z.record(z.string(), catalogScalarSchema),
    unit: z.string(),
    cardUrl: z.string(),
    fixtureTags: z.array(z.string()),
    isSyntheticDemo: z.boolean(),
  })
  .passthrough();

const catalogStockSummaryShape = {
  totalAvailableQuantity: z.number().nonnegative(),
  balanceCount: z.number().int().nonnegative(),
  latestSnapshotAt: z.string().optional(),
};

const catalogSearchItemSchema = catalogItemSchema.extend(catalogStockSummaryShape);

const catalogItemWithStockSchema = catalogSearchItemSchema.extend({
  balances: z.array(
    z
      .object({
        id: z.string(),
        plant: z.string(),
        storageLocation: z.string(),
        batch: z.string().optional(),
        availableQuantity: z.number().nonnegative(),
        unit: z.string(),
        snapshotAt: z.string(),
      })
      .passthrough(),
  ),
});

const catalogSearchResultSchema = z
  .object({
    items: z.array(catalogSearchItemSchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const catalogSubstituteResultSchema = z
  .object({
    sourceItemCode: z.string(),
    family: catalogFamilySchema.nullable(),
    items: z.array(catalogSearchItemSchema),
  })
  .passthrough();

const catalogAssemblyBomSchema = z
  .object({
    assembly: catalogItemSchema,
    components: z.array(
      z
        .object({
          id: z.string(),
          positionNumber: z.string(),
          quantity: z.number().nonnegative(),
          unit: z.string(),
          isCritical: z.boolean(),
          component: catalogSearchItemSchema,
          alternativeFamily: catalogFamilySchema.nullable(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const ruleCitationShape = {
  documentId: z.string(),
  version: z.string(),
  clauseId: z.string(),
  title: z.string(),
  isSyntheticDemo: z.literal(true),
};

const responsibilityRuleSchema = z
  .object({
    ...ruleCitationShape,
    equipmentTypes: z.array(z.string()),
    responsibility: z.enum(["CUSTOMER", "CONTRACTOR"]),
    conditions: z.record(z.string(), z.unknown()).optional(),
    text: z.string(),
  })
  .passthrough();

const analogueRuleSchema = z
  .object({
    ...ruleCitationShape,
    equipmentTypes: z.array(z.string()),
    allowedStandardPairs: z.array(z.tuple([z.string(), z.string()])).optional(),
    allowedMaterialPairs: z.array(z.tuple([z.string(), z.string()])).optional(),
    dimensionTolerances: z.record(z.string(), z.number()).optional(),
    text: z.string(),
  })
  .passthrough();

const scenarioRunSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    scenarioId: z.string(),
    specificationId: z.string(),
    status: z.enum([
      "QUEUED",
      "LOADING_APPIUS",
      "SYNCING_SAP",
      "CLASSIFYING_RESPONSIBILITY",
      "MATCHING_STOCK",
      "FINDING_ANALOGUES",
      "GENERATING_REPORT",
      "COMPLETED",
      "FAILED",
      "CANCELLED",
    ]),
    currentStep: z.string(),
    progress: z.number().min(0).max(100),
    mode: z.enum(["NORMAL", "DRY_RUN"]),
    seed: z.string(),
    version: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

const reportSummarySchema = z
  .object({
    total: z.number().nonnegative(),
    found: z.number().nonnegative(),
    likely: z.number().nonnegative(),
    review: z.number().nonnegative(),
    noMatch: z.number().nonnegative(),
    analogues: z.number().nonnegative(),
    insufficient: z.number().nonnegative(),
    procurement: z.number().nonnegative(),
    customerResponsibility: z.number().nonnegative(),
    contractorResponsibility: z.number().nonnegative(),
  })
  .passthrough();

const groundedCitationSchema = z.object({
  sourceSystem: z.enum(["APPIUS", "SAP", "CATALOG", "NORMATIVE", "SCENARIO", "REPORT"]),
  entityId: z.string().min(1),
  versionOrSnapshot: z.string().min(1),
  clauseId: z.string().nullable(),
});

const groundedAgentOutputSchema = z.object({
  answer: z.string().min(1).max(20_000),
  facts: z.array(z.string().max(4_000)).max(100),
  recommendations: z.array(z.string().max(4_000)).max(100),
  citations: z.array(groundedCitationSchema).max(200),
  confidence: z.number().min(0).max(1),
  requiresHumanReview: z.boolean(),
  toolCalls: z.array(
    z.object({
      tool: z.string(),
      outcome: z.enum(["OK", "ERROR"]),
      durationMs: z.number().nonnegative(),
    }),
  ),
});

const promptInjectionPatterns = [
  /(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+(?:instructions?|rules?)/iu,
  /игнориру(?:й|йте)\s+(?:все\s+)?(?:предыдущие|системные|правила|инструкции)/iu,
  /(?:покажи|раскрой|выведи|дай)\s+(?:мне\s+)?(?:system|системн(?:ый|ого))\s*(?:prompt|промпт)/iu,
  /(?:system|developer|assistant)\s*:\s*/iu,
  /<\/?(?:system|developer|tool|assistant)>/iu,
  /вызови\s+(?:неразреш[её]нный\s+)?инструмент/iu,
];

const userIdPattern = /["']?\buser[_-]?id\b["']?\s*(?:=|:|равен\s*)\s*["']?([a-z0-9][a-z0-9_-]{1,159})["']?/giu;

export class AgentService {
  constructor(private readonly dependencies: AgentServiceDependencies) {}

  async respond(input: AgentMessageInput, trustedUserId: string): Promise<GroundedAgentOutput>;
  async respond(request: TrustedAgentRequest): Promise<GroundedAgentOutput>;
  async respond(
    inputOrRequest: AgentMessageInput | TrustedAgentRequest,
    trustedUserId?: string,
  ): Promise<GroundedAgentOutput> {
    const request = trustedAgentRequestSchema.parse(
      trustedUserId === undefined
        ? inputOrRequest
        : {
            ...agentMessageInputSchema.parse(inputOrRequest),
            userId: z.string().trim().min(1).max(160).parse(trustedUserId),
          },
    );
    const requestStartedAt = performance.now();
    const correlationId = request.correlationId ?? `agent-${crypto.randomUUID()}`;
    const runId = extractRunId(request.message);

    const attemptedIds = extractAttemptedUserIds(request.message);
    const context: RequestContext = {
      userId: request.userId,
      message: stripUserIdDirectives(request.message),
      threadId: request.threadId,
      facts: [],
      citations: [],
      toolCalls: [],
      appiusStateChecked: false,
      appiusAvailable: false,
      sapStateChecked: false,
      sapAvailable: false,
      attemptedUserOverride: attemptedIds.some((id) => id !== request.userId),
      searchDictionary: [],
      correlationId,
      promptVersion: request.promptVersion ?? "mtr-agent-system-v1",
      runId,
    };

    await this.safeAudit(request.userId, {
      action: "agent.request.received",
      entityType: "agent_thread",
      entityId: request.threadId,
      outcome: "SUCCESS",
      details: {
        messageLength: request.message.length,
        attemptedUserOverride: context.attemptedUserOverride,
        conversationId: request.threadId,
        correlationId,
      },
    }, correlationId);

    if (containsPromptInjection(request.message)) {
      await this.safeAudit(request.userId, {
        action: "agent.security.prompt_injection_blocked",
        entityType: "agent_thread",
        entityId: request.threadId,
        outcome: "SUCCESS",
        details: { blocked: true },
      }, correlationId);
      return {
        answer:
          "Запрос содержит инструкцию, которая пытается изменить правила агента или раскрыть служебные настройки. Она проигнорирована. Сформулируйте вопрос о МТР без управляющих инструкций.",
        facts: [],
        recommendations: [],
        citations: [],
        confidence: 1,
        requiresHumanReview: false,
        toolCalls: [],
      };
    }

    if (context.attemptedUserOverride) {
      await this.safeAudit(request.userId, {
        action: "agent.security.user_id_override_ignored",
        entityType: "agent_thread",
        entityId: request.threadId,
        outcome: "SUCCESS",
        details: { ignored: true },
      }, correlationId);
    }

    context.searchDictionary = await this.loadSearchDictionary(context);
    const intents = classifyIntents(context.message, context.searchDictionary);
    const specificationId = extractSpecificationId(context.message);
    const catalogueRequest = intents.has("CATALOG");

    if (catalogueRequest) {
      await this.collectCatalogueFacts(context);
    }
    if (intents.has("SPECIFICATION") && !catalogueRequest) {
      await this.collectSpecificationFacts(context, specificationId);
    }
    if (intents.has("STOCK") && !catalogueRequest) {
      await this.collectStockFacts(context);
    }

    let resolvedPosition: Position | null | undefined;
    if (!catalogueRequest && (intents.has("RESPONSIBILITY") || intents.has("ANALOGUE"))) {
      resolvedPosition = await this.resolvePosition(context, specificationId);
    }
    if (intents.has("RESPONSIBILITY") && resolvedPosition) {
      await this.collectResponsibilityFacts(context, resolvedPosition);
    }
    if (intents.has("ANALOGUE") && resolvedPosition) {
      await this.collectAnalogueFacts(context, resolvedPosition);
    }
    if ((intents.has("RUN") || intents.has("REPORT")) && runId) {
      await this.collectRunFacts(context, runId);
    } else if (intents.has("RUN") || intents.has("REPORT")) {
      this.addSafeError(context, "SCENARIO", "Укажите идентификатор запуска, чтобы получить подтверждённый статус.", false);
    }
    if (intents.has("REPORT") && runId) {
      await this.collectReportFacts(context, runId);
    }
    if (runId && this.dependencies.scenarios.getPositionResult) {
      const positionId = extractPositionId(context.message);
      if (positionId && /(?:позици|результат|совпад|аналог|ответствен)/iu.test(context.message)) {
        await this.collectPositionResult(context, runId, positionId);
      }
    }

    let output: GroundedAgentOutput;
    const providerStartedAt = performance.now();
    await this.safeAudit(context.userId, {
      action: "agent.tool.request",
      entityType: "agent_tool_call",
      entityId: "llm.respond",
      outcome: "SUCCESS",
      details: {
        tool: "llm.respond",
        sourceSystem: "LLM",
        arguments: { factCount: context.facts.length },
        conversationId: context.threadId,
        runId: context.runId,
        correlationId: context.correlationId,
        attempts: 1,
        promptVersion: context.promptVersion,
        ...llmAuditDetails(this.dependencies.llm),
      },
    }, context.correlationId);
    try {
      const providerOutput = await this.dependencies.llm.respond({
        userId: context.userId,
        message: context.message,
        threadId: context.threadId,
        facts: context.facts,
      });
      output = groundedAgentOutputSchema.parse(providerOutput) as GroundedAgentOutput;
      const durationMs = elapsedMs(providerStartedAt);
      context.toolCalls.push({ tool: "llm.respond", outcome: "OK", durationMs });
      await this.safeAudit(context.userId, {
        action: "agent.tool.result",
        entityType: "agent_tool_call",
        entityId: "llm.respond",
        outcome: "SUCCESS",
        details: {
          tool: "llm.respond",
          sourceSystem: "LLM",
          arguments: { factCount: context.facts.length },
          result: { citationCount: output.citations.length },
          durationMs,
          attempts: 1,
          conversationId: context.threadId,
          runId: context.runId,
          correlationId: context.correlationId,
          promptVersion: context.promptVersion,
          ...llmAuditDetails(this.dependencies.llm),
          citations: output.citations,
        },
      }, context.correlationId);
    } catch (error) {
      const durationMs = elapsedMs(providerStartedAt);
      context.toolCalls.push({ tool: "llm.respond", outcome: "ERROR", durationMs });
      const providerFailure = safeLlmFailure(error);
      await this.safeAudit(context.userId, {
        action: "agent.tool.result",
        entityType: "agent_tool_call",
        entityId: "llm.respond",
        outcome: "FAILURE",
        details: {
          tool: "llm.respond",
          sourceSystem: "LLM",
          arguments: { factCount: context.facts.length },
          durationMs,
          attempts: 1,
          conversationId: context.threadId,
          runId: context.runId,
          correlationId: context.correlationId,
          promptVersion: context.promptVersion,
          ...llmAuditDetails(this.dependencies.llm),
          errorCode: providerFailure.code,
          errorMessage: providerFailure.message,
        },
      }, context.correlationId);
      output = {
        answer: providerFailure.message,
        facts: ["Подтверждённые результаты вызванных инструментов не изменены."],
        recommendations: [
          "Повторите запрос после восстановления LLM-провайдера; не принимайте решение без сформированного ответа.",
        ],
        citations: [],
        confidence: 0,
        requiresHumanReview: true,
        toolCalls: [],
      };
    }

    const citations = dedupeCitations(context.citations);
    const factualIntent = intents.size > 0;
    const recommendations = [...output.recommendations];
    if (context.attemptedUserOverride) {
      recommendations.unshift(
        "user_id из текста проигнорирован; данные запрошены только в контексте активной серверной сессии.",
      );
    }
    if (factualIntent && citations.length === 0) {
      output.confidence = 0;
      output.requiresHumanReview = true;
    }
    output = {
      ...output,
      answer: context.attemptedUserOverride
        ? `user_id из текста проигнорирован. ${output.answer}`
        : output.answer,
      recommendations: unique(recommendations),
      citations,
      toolCalls: context.toolCalls,
    };

    await this.safeAudit(context.userId, {
      action: "agent.response.completed",
      entityType: "agent_thread",
      entityId: context.threadId,
      outcome: "SUCCESS",
      details: {
        intent: [...intents],
        toolCallCount: context.toolCalls.length,
        citationCount: citations.length,
        requiresHumanReview: output.requiresHumanReview,
        durationMs: elapsedMs(requestStartedAt),
        correlationId: context.correlationId,
        conversationId: context.threadId,
        runId: context.runId,
        promptVersion: context.promptVersion,
        ...llmAuditDetails(this.dependencies.llm),
        citations,
      },
    }, context.correlationId);
    return output;
  }

  private async collectSpecificationFacts(
    context: RequestContext,
    specificationId?: string,
  ): Promise<void> {
    if (!(await this.ensureAppiusAvailable(context))) return;
    const specifications = await this.callTool<Specification[]>(
      context,
      "appius.listSpecifications",
      "APPIUS",
      "specifications",
      () => this.dependencies.appius.listSpecifications(context.userId),
      z.array(specificationSchema),
    );
    if (!specifications) return;

    this.addFact(
      context,
      "APPIUS.specifications",
      specifications,
      specifications.map(specificationCitation),
    );

    const selected = specificationId
      ? specifications.filter((specification) => specification.id === specificationId)
      : specifications;
    const asksForVersion = /(?:актуальн|последн|текущ|верси)/iu.test(context.message);
    const asksForPositions = /(?:позици|состав|перечень)/iu.test(context.message);
    if (!specificationId && !asksForVersion && !asksForPositions) return;

    for (const specification of selected) {
      const version = await this.callTool<SpecificationVersion>(
        context,
        "appius.getLatestVersion",
        "APPIUS",
        specification.id,
        () => this.dependencies.appius.getLatestVersion(specification.id, context.userId),
        specificationVersionSchema,
      );
      if (!version) continue;
      this.addFact(context, "APPIUS.latest-version", version, [versionCitation(version)]);
      if (!asksForPositions) continue;
      const positions = await this.callTool<Position[]>(
        context,
        "appius.getPositions",
        "APPIUS",
        version.id,
        () => this.dependencies.appius.getPositions(specification.id, version.id, context.userId),
        z.array(positionSchema),
      );
      if (!positions) continue;
      this.addFact(context, "APPIUS.positions", positions, [versionCitation(version)]);
    }
  }

  private async collectStockFacts(context: RequestContext): Promise<void> {
    if (!(await this.ensureSapAvailable(context))) return;
    const materialCode = extractMaterialCode(context.message);
    if (materialCode?.startsWith("SAP-")) {
      const materials = await this.callTool<SapMaterial[]>(
        context,
        "sap.getMaterialStock",
        "SAP",
        materialCode,
        () => this.dependencies.sap.getMaterialStock(materialCode, context.userId),
        z.array(sapMaterialSchema),
      );
      if (!materials) return;
      this.addFact(context, "SAP.material-stock", materials, materials.map(materialCitation));
      return;
    }

    const queries = stockSearchQueries(
      context.message,
      materialCode,
      context.searchDictionary,
    );
    let result: StockSearchResult | undefined;
    let query = queries[0]?.label ?? "stock-search";
    for (const candidateQuery of queries) {
      query = candidateQuery.label;
      const candidate = await this.callTool<StockSearchResult>(
        context,
        "sap.searchMaterialStock",
        "SAP",
        candidateQuery.label,
        () =>
          this.dependencies.sap.searchMaterialStock(
            {
              ...(candidateQuery.text ? { text: candidateQuery.text } : {}),
              ...(candidateQuery.equipmentType
                ? { equipmentType: candidateQuery.equipmentType }
                : {}),
              top: 20,
              skip: 0,
            },
            context.userId,
          ),
        stockSearchResultSchema(),
      );
      if (!candidate) return;
      result = {
        ...candidate,
        items: rankStockItems(
          candidate.items,
          context.message,
          context.searchDictionary,
        ),
      };
      if (result.items.length > 0) break;
    }
    if (!result) return;
    const snapshot =
      result.snapshotAt ||
      context.sapState?.snapshotAt ||
      context.sapState?.lastSynchronizedAt ||
      "empty-search-result";
    const citations =
      result.items.length > 0
        ? result.items.map(materialCitation)
        : [sapSearchCitation(query, snapshot)];
    this.addFact(context, "SAP.stock-search", { ...result, snapshotAt: snapshot }, citations);
  }

  private async collectCatalogueFacts(context: RequestContext): Promise<void> {
    const catalog = this.dependencies.catalog;
    if (!catalog) {
      this.addSafeError(
        context,
        "CATALOG",
        "Промышленный каталог временно недоступен.",
        false,
      );
      return;
    }

    const itemCode = extractCatalogItemCode(context.message);
    const asksForSubstitutes = isCatalogueSubstituteRequest(context.message);
    const asksForBom = isCatalogueBomRequest(context.message);
    if (itemCode) {
      const item = await this.callTool<CatalogItemWithStock | null>(
        context,
        "catalog.getItemByCode",
        "CATALOG",
        itemCode,
        () => catalog.getItemByCode(itemCode, context.userId),
        z.union([catalogItemWithStockSchema, z.null()]),
      );
      if (item === undefined) return;
      this.addFact(
        context,
        "CATALOG.item",
        item,
        item ? [catalogItemCitation(item)] : [catalogSearchCitation(itemCode)],
      );
      if (!item) return;

      if (asksForSubstitutes) {
        await this.collectCatalogueSubstitutes(context, item.itemCode);
      }
      if (asksForBom) {
        await this.collectCatalogueBom(context, item.itemCode);
      }
      return;
    }

    const query = cleanCatalogueQuery(context.message);
    const result = await this.callTool<CatalogSearchResult>(
      context,
      "catalog.searchItems",
      "CATALOG",
      query || "catalogue-search",
      () =>
        catalog.searchItems(
          {
            ...(query ? { text: query } : {}),
            ...(asksForBom ? { itemKind: "ASSEMBLY" as const } : {}),
            limit: 20,
            offset: 0,
          },
          context.userId,
        ),
      catalogSearchResultSchema,
    );
    if (!result) return;
    const compatibleSearchItems = result.items.filter(isValidCatalogueFamilyMember);
    const groundedResult = asksForSubstitutes
      ? {
          ...result,
          items: compatibleSearchItems,
          total: compatibleSearchItems.length,
        }
      : result;
    this.addFact(
      context,
      "CATALOG.search",
      groundedResult,
      groundedResult.items.length > 0
        ? groundedResult.items.map(catalogItemCitation)
        : [catalogSearchCitation(query || "catalogue-search")],
    );

    if (asksForSubstitutes) {
      const source = groundedResult.items.find((item) => Boolean(item.familyId));
      if (source) await this.collectCatalogueSubstitutes(context, source.itemCode);
    }
  }

  private async collectCatalogueSubstitutes(
    context: RequestContext,
    itemCode: string,
  ): Promise<void> {
    const catalog = this.dependencies.catalog;
    if (!catalog) return;
    const raw = await this.callTool<CatalogSubstituteResult | null>(
      context,
      "catalog.listSubstitutes",
      "CATALOG",
      itemCode,
      () => catalog.listSubstitutes(itemCode, context.userId),
      z.union([catalogSubstituteResultSchema, z.null()]),
    );
    if (raw === undefined) return;
    const result = raw ? sanitizeCatalogueSubstitutes(raw) : null;
    this.addFact(
      context,
      "CATALOG.substitutes",
      result,
      result
        ? [
            ...(result.family ? [catalogFamilyCitation(result.family.code)] : []),
            ...result.items.map(catalogItemCitation),
          ]
        : [catalogSearchCitation(`substitutes:${itemCode}`)],
    );
  }

  private async collectCatalogueBom(
    context: RequestContext,
    itemCode: string,
  ): Promise<void> {
    const catalog = this.dependencies.catalog;
    if (!catalog) return;
    const bom = await this.callTool<CatalogAssemblyBom | null>(
      context,
      "catalog.getAssemblyBom",
      "CATALOG",
      itemCode,
      () => catalog.getAssemblyBom(itemCode, context.userId),
      z.union([catalogAssemblyBomSchema, z.null()]),
    );
    if (bom === undefined) return;
    this.addFact(
      context,
      "CATALOG.bom",
      bom,
      bom
        ? [
            catalogItemCitation(bom.assembly),
            ...bom.components.map(({ component }) => catalogItemCitation(component)),
          ]
        : [catalogSearchCitation(`bom:${itemCode}`)],
    );
  }

  private async resolvePosition(
    context: RequestContext,
    specificationId?: string,
  ): Promise<Position | null> {
    if (!(await this.ensureAppiusAvailable(context))) return null;
    const specifications = await this.callTool<Specification[]>(
      context,
      "appius.listSpecifications",
      "APPIUS",
      "specifications-for-position",
      () => this.dependencies.appius.listSpecifications(context.userId),
      z.array(specificationSchema),
    );
    if (!specifications) return null;

    const positionId = extractPositionId(context.message);
    const internalCode = extractAppiusCode(context.message);
    const selectedSpecifications = specificationId
      ? specifications.filter((specification) => specification.id === specificationId)
      : specifications;
    let best: { position: Position; score: number; version: SpecificationVersion } | undefined;
    let lastVersion: SpecificationVersion | undefined;

    for (const specification of selectedSpecifications) {
      const version = await this.callTool<SpecificationVersion>(
        context,
        "appius.getLatestVersion",
        "APPIUS",
        specification.id,
        () => this.dependencies.appius.getLatestVersion(specification.id, context.userId),
        specificationVersionSchema,
      );
      if (!version) continue;
      lastVersion = version;
      if (!version.isCurrent) {
        this.addFact(context, "APPIUS.latest-version", version, [versionCitation(version)]);
        continue;
      }
      const positions = await this.callTool<Position[]>(
        context,
        "appius.getPositions",
        "APPIUS",
        version.id,
        () => this.dependencies.appius.getPositions(specification.id, version.id, context.userId),
        z.array(positionSchema),
      );
      if (!positions) continue;

      for (const position of positions) {
        if (positionId && position.id.toLocaleLowerCase("ru-RU") === positionId.toLocaleLowerCase("ru-RU")) {
          best = { position, score: 1, version };
          break;
        }
        if (
          internalCode &&
          position.internalCode.toLocaleUpperCase("ru-RU") === internalCode.toLocaleUpperCase("ru-RU")
        ) {
          best = { position, score: 1, version };
          break;
        }
        if (!positionId && !internalCode) {
          const dictionaryTypes = resolveDictionaryKeys(
            context.message,
            context.searchDictionary,
          );
          const lexicalScore = tokenSimilarity(
            tokenizeWithDictionary(
              [cleanPositionQuery(context.message)],
              context.searchDictionary,
            ),
            tokenizeWithDictionary(
              [
                position.nameRu,
                position.nameEn,
                position.internalCode,
                position.equipmentType,
                ...position.synonyms,
              ],
              context.searchDictionary,
            ),
          );
          const score = dictionaryTypes.includes(position.equipmentType)
            ? Math.max(0.5, lexicalScore)
            : lexicalScore;
          if (!best || score > best.score) best = { position, score, version };
        }
      }
      if (best?.score === 1) break;
    }

    if (!best || (!positionId && !internalCode && best.score < 0.12)) {
      this.addFact(
        context,
        "APPIUS.positions",
        [],
        lastVersion ? [versionCitation(lastVersion)] : specifications.map(specificationCitation),
      );
      return null;
    }
    this.addFact(context, "APPIUS.positions", [best.position], [versionCitation(best.version)]);
    return best.position;
  }

  private async collectResponsibilityFacts(context: RequestContext, position: Position): Promise<void> {
    const rules = await this.callTool<ResponsibilityRule[]>(
      context,
      "norms.searchResponsibilityRules",
      "NORMATIVE",
      position.id,
      () => this.dependencies.norms.searchResponsibilityRules(position, context.userId),
      z.array(responsibilityRuleSchema),
    );
    if (!rules) return;
    this.addFact(context, "NORMATIVE.responsibility", { position, rules }, [
      positionCitation(position),
      ...rules.map(ruleCitation),
    ]);
  }

  private async collectAnalogueFacts(context: RequestContext, position: Position): Promise<void> {
    const rules = await this.callTool<AnalogueRule[]>(
      context,
      "norms.searchAnalogueRules",
      "NORMATIVE",
      position.id,
      () => this.dependencies.norms.searchAnalogueRules(position, context.userId),
      z.array(analogueRuleSchema),
    );
    if (!rules) return;
    if (rules.length === 0) {
      this.addFact(context, "NORMATIVE.analogue", { position, rules }, [positionCitation(position)]);
      return;
    }
    if (!(await this.ensureSapAvailable(context))) {
      this.addFact(context, "NORMATIVE.analogue", { position, rules }, [
        positionCitation(position),
        ...rules.map(ruleCitation),
      ]);
      return;
    }
    const result = await this.callTool<StockSearchResult>(
      context,
      "sap.searchMaterialStock",
      "SAP",
      `analogue:${position.id}`,
      () =>
        this.dependencies.sap.searchMaterialStock(
          { equipmentType: position.equipmentType, top: 100, skip: 0 },
          context.userId,
        ),
      stockSearchResultSchema(),
    );
    if (!result) return;
    const coverage = buildAnalogueCoverage(position, result.items, rules);
    const citedMaterials =
      coverage?.allocations.map((allocation) => allocation.material) ?? [];
    this.addFact(context, "NORMATIVE.analogue", { position, rules, coverage }, [
      positionCitation(position),
      ...rules.map(ruleCitation),
      ...(citedMaterials.length > 0
        ? citedMaterials.map(materialCitation)
        : [sapSearchCitation(`analogue:${position.id}`, result.snapshotAt)]),
    ]);
  }

  private async collectRunFacts(context: RequestContext, runId: string): Promise<void> {
    if (context.run !== undefined) return;
    const run = await this.callTool<ScenarioRun | null>(
      context,
      "scenario.getRun",
      "SCENARIO",
      runId,
      () => this.dependencies.scenarios.getRun(runId, context.userId),
      z.union([scenarioRunSchema, z.null()]),
    );
    context.run = run;
    if (!run) {
      this.addSafeError(context, "SCENARIO", "Запуск не найден в контексте активного пользователя.", false);
      return;
    }
    this.addFact(context, "SCENARIO.run", sanitizeRunForAgent(run), [runCitation(run)]);
  }

  private async collectReportFacts(context: RequestContext, runId: string): Promise<void> {
    const summary = await this.callTool<ReportSummary | null>(
      context,
      "report.getSummary",
      "REPORT",
      runId,
      () => this.dependencies.reports.getSummary(runId, context.userId),
      z.union([reportSummarySchema, z.null()]),
    );
    if (!summary) {
      this.addSafeError(context, "REPORT", "Отчёт для запуска не найден или ещё не сформирован.", false);
      return;
    }
    const snapshot = context.run?.completedAt ?? context.run?.updatedAt ?? "current";
    this.addFact(context, "REPORT.summary", summary, [
      {
        sourceSystem: "REPORT",
        entityId: runId,
        versionOrSnapshot: snapshot,
        clauseId: null,
      },
    ]);
  }

  private async collectPositionResult(
    context: RequestContext,
    runId: string,
    positionId: string,
  ): Promise<void> {
    const getPositionResult = this.dependencies.scenarios.getPositionResult;
    if (!getPositionResult) return;
    const result = await this.callTool<PositionAnalysisResult | null>(
      context,
      "scenario.getPositionResult",
      "SCENARIO",
      `${runId}:${positionId}`,
      () => getPositionResult.call(this.dependencies.scenarios, runId, positionId, context.userId),
      z.union([z.object({ position: positionSchema, status: z.string() }).passthrough(), z.null()]),
    );
    if (!result) return;
    const snapshot = context.run?.completedAt ?? context.run?.updatedAt ?? "current";
    this.addFact(context, "SCENARIO.position-result", result, [
      {
        sourceSystem: "SCENARIO",
        entityId: `${runId}:${positionId}`,
        versionOrSnapshot: snapshot,
        clauseId: null,
      },
    ]);
  }

  private async ensureAppiusAvailable(context: RequestContext): Promise<boolean> {
    if (context.appiusStateChecked) return context.appiusAvailable;
    context.appiusStateChecked = true;
    const state = await this.callTool<IntegrationState>(
      context,
      "appius.getState",
      "APPIUS",
      "integration-state",
      () => this.dependencies.appius.getState(context.userId),
      integrationStateSchema,
    );
    if (!state) return false;
    context.appiusState = state;
    this.addFact(context, "APPIUS.integration-state", state, [integrationCitation("APPIUS", state)]);
    context.appiusAvailable = state.state === "AVAILABLE" || state.state === "SLOW";
    if (!context.appiusAvailable) {
      this.addSafeError(context, "APPIUS", integrationStateMessage("APPIUS", state), true);
    }
    return context.appiusAvailable;
  }

  private async ensureSapAvailable(context: RequestContext): Promise<boolean> {
    if (context.sapStateChecked) return context.sapAvailable;
    context.sapStateChecked = true;
    const state = await this.callTool<IntegrationState>(
      context,
      "sap.getState",
      "SAP",
      "integration-state",
      () => this.dependencies.sap.getState(context.userId),
      integrationStateSchema,
    );
    if (!state) return false;
    context.sapState = state;
    this.addFact(context, "SAP.integration-state", state, [integrationCitation("SAP", state)]);
    context.sapAvailable = ["AVAILABLE", "SLOW", "STALE"].includes(state.state);
    if (!context.sapAvailable) {
      this.addSafeError(context, "SAP", integrationStateMessage("SAP", state), true);
    }
    return context.sapAvailable;
  }

  private async callTool<T>(
    context: RequestContext,
    tool: string,
    sourceSystem: "APPIUS" | "SAP" | "CATALOG" | "NORMATIVE" | "SCENARIO" | "REPORT",
    entityId: string,
    invoke: () => Promise<unknown>,
    schema: z.ZodType,
  ): Promise<T | undefined> {
    const startedAt = performance.now();
    await this.safeAudit(context.userId, {
      action: "agent.tool.request",
      entityType: "agent_tool_call",
      entityId,
      outcome: "SUCCESS",
      details: {
        tool,
        sourceSystem,
        arguments: { entityId },
        attempts: 1,
        conversationId: context.threadId,
        runId: context.runId,
        correlationId: context.correlationId,
        promptVersion: context.promptVersion,
        ...llmAuditDetails(this.dependencies.llm),
      },
    }, context.correlationId);
    try {
      const raw = await invoke();
      const result = schema.parse(raw) as T;
      const durationMs = elapsedMs(startedAt);
      context.toolCalls.push({ tool, outcome: "OK", durationMs });
      await this.safeAudit(context.userId, {
        action: "agent.tool.result",
        entityType: "agent_tool_call",
        entityId,
        outcome: "SUCCESS",
        details: {
          tool,
          sourceSystem,
          arguments: { entityId },
          result: summarizeResult(result),
          durationMs,
          attempts: 1,
          conversationId: context.threadId,
          runId: context.runId,
          correlationId: context.correlationId,
          promptVersion: context.promptVersion,
          ...llmAuditDetails(this.dependencies.llm),
        },
      }, context.correlationId);
      return result;
    } catch (error) {
      const durationMs = elapsedMs(startedAt);
      context.toolCalls.push({ tool, outcome: "ERROR", durationMs });
      const safe = safeToolError(sourceSystem, error);
      await this.safeAudit(context.userId, {
        action: "agent.tool.result",
        entityType: "agent_tool_call",
        entityId,
        outcome: "FAILURE",
        details: {
          tool,
          sourceSystem,
          arguments: { entityId },
          durationMs,
          attempts: 1,
          conversationId: context.threadId,
          runId: context.runId,
          correlationId: context.correlationId,
          promptVersion: context.promptVersion,
          ...llmAuditDetails(this.dependencies.llm),
          errorCode: safe.code,
          errorMessage: safe.message,
        },
      }, context.correlationId);
      this.addSafeError(context, sourceSystem, safe.message, sourceSystem === "APPIUS" || sourceSystem === "SAP");
      return undefined;
    }
  }

  private addFact<T>(
    context: RequestContext,
    source: string,
    data: T,
    citations: GroundedCitation[] = [],
  ): void {
    const safeCitations = dedupeCitations(citations);
    const envelope: GroundedFactEnvelope<T> = { data, citations: safeCitations };
    context.facts.push({ source, payload: envelope });
    context.citations.push(...safeCitations);
  }

  private addSafeError(
    context: RequestContext,
    sourceSystem: string,
    safeMessage: string,
    manualImport: boolean,
  ): void {
    const exists = context.facts.some((fact) => {
      if (fact.source !== "ERROR.tool" || typeof fact.payload !== "object" || fact.payload === null) return false;
      const envelope = fact.payload as GroundedFactEnvelope<unknown>;
      if (typeof envelope.data !== "object" || envelope.data === null) return false;
      return (envelope.data as { sourceSystem?: string }).sourceSystem === sourceSystem;
    });
    if (exists) return;
    this.addFact(context, "ERROR.tool", { sourceSystem, safeMessage, manualImport });
  }

  private async loadSearchDictionary(
    context: RequestContext,
  ): Promise<SearchDictionaryEntry[]> {
    if (!this.dependencies.dictionaries) return [];
    try {
      const entries = await this.dependencies.dictionaries.listActive(context.userId);
      await this.safeAudit(context.userId, {
        action: "agent.config.dictionary.loaded",
        entityType: "dictionary",
        entityId: "MTR_SEARCH_SYNONYMS",
        outcome: "SUCCESS",
        details: { activeEntryCount: entries.length },
      }, context.correlationId);
      return entries.filter(
        (entry) =>
          entry.active !== false &&
          entry.key.trim().length > 0 &&
          entry.values.some((value) => value.trim().length > 0),
      );
    } catch {
      await this.safeAudit(context.userId, {
        action: "agent.config.dictionary.loaded",
        entityType: "dictionary",
        entityId: "MTR_SEARCH_SYNONYMS",
        outcome: "FAILURE",
        details: { errorCode: "DICTIONARY_UNAVAILABLE" },
      }, context.correlationId);
      return [];
    }
  }

  private async safeAudit(
    userId: string,
    entry: Omit<Parameters<AuditPort["write"]>[0], "userId">,
    requestId?: string,
  ): Promise<void> {
    try {
      await this.dependencies.audit.write({
        ...entry,
        userId,
        requestId: entry.requestId ?? requestId,
        details: redactSensitiveRecord(entry.details),
      });
    } catch {
      // Audit backend failure must not leak details or turn a safe read into an unsafe answer.
    }
  }
}

export function createAgentService(dependencies: AgentServiceDependencies): AgentService {
  return new AgentService(dependencies);
}

function stockSearchResultSchema(): z.ZodType {
  return z
    .object({
      items: z.array(sapMaterialSchema),
      total: z.number().nonnegative(),
      snapshotAt: z.string(),
      nextSkip: z.number().nonnegative().optional(),
    })
    .passthrough();
}

function classifyIntents(
  message: string,
  dictionary: SearchDictionaryEntry[] = [],
): Set<AgentIntent> {
  const normalized = normalizeText(
    [message, ...resolveDictionaryKeys(message, dictionary)].join(" "),
  );
  const intents = new Set<AgentIntent>();
  if (
    extractCatalogItemCode(message) ||
    /(?:каталог|номенклатур|промышленн.+каталог|взаимозамен|\bBOM\b|состав.+(?:узл|сборк)|комплектующ.+(?:узл|сборк)|catalog(?:ue)?|interchangeab)/iu.test(
      normalized,
    )
  ) {
    intents.add("CATALOG");
  }
  if (/(?:спецификац|актуальн\w* верси|верси\w* appius|перечень позиц|specification|latest version)/iu.test(normalized)) {
    intents.add("SPECIFICATION");
  }
  if (/(?:остат|склад|sap|материал|legacy|доступн\w* количеств|stock|warehouse|inventory|available quantity)/iu.test(normalized)) {
    intents.add("STOCK");
  }
  if (/(?:ответствен|заказчик|подрядчик|кто отвечает|чья позиция|responsibility|responsible)/iu.test(normalized)) {
    intents.add("RESPONSIBILITY");
  }
  if (/(?:аналог|замен|эквивалент|покрыти|analogue|analog|substitute|replacement)/iu.test(normalized)) {
    intents.add("ANALOGUE");
  }
  if (/(?:запуск|сценари|run[-_ ]|статус обработки|прогресс|run status|scenario)/iu.test(normalized)) {
    intents.add("RUN");
  }
  if (/(?:отч[её]т|сводк|итог анализа|report|summary)/iu.test(normalized)) {
    intents.add("REPORT");
  }
  if (extractMaterialCode(message)) intents.add("STOCK");
  if (extractSpecificationId(message)) intents.add("SPECIFICATION");
  return intents;
}

function containsPromptInjection(message: string): boolean {
  return promptInjectionPatterns.some((pattern) => pattern.test(message));
}

function extractAttemptedUserIds(message: string): string[] {
  userIdPattern.lastIndex = 0;
  return [...message.matchAll(userIdPattern)].map((match) => match[1]);
}

function stripUserIdDirectives(message: string): string {
  userIdPattern.lastIndex = 0;
  return message.replace(userIdPattern, " ").replace(/\s+/g, " ").trim();
}

function extractSpecificationId(message: string): string | undefined {
  return message.match(/\bspec-demo-[a-z0-9-]+\b/iu)?.[0]?.toLocaleLowerCase("ru-RU");
}

function extractPositionId(message: string): string | undefined {
  return message.match(/\bposition-[a-z0-9-]+\b/iu)?.[0]?.toLocaleLowerCase("ru-RU");
}

function extractAppiusCode(message: string): string | undefined {
  return message.match(/\bAPP-DEMO-[A-Z0-9-]+\b/iu)?.[0]?.toLocaleUpperCase("ru-RU");
}

function extractMaterialCode(message: string): string | undefined {
  return message
    .match(/\b(?:SAP|LEGACY)-DEMO-[A-Z0-9-]+\b/iu)?.[0]
    ?.toLocaleUpperCase("ru-RU");
}

function extractCatalogItemCode(message: string): string | undefined {
  return message
    .match(/\bCAT-DEMO-[A-Z0-9-]+\b/iu)?.[0]
    ?.toLocaleUpperCase("ru-RU");
}

function extractRunId(message: string): string | undefined {
  const named = message.match(/\b(?:run|scenario-run)[-_][a-z0-9][a-z0-9-]*\b/iu)?.[0];
  if (named) return named;
  return message.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu)?.[0];
}

function cleanStockQuery(message: string): string {
  const quoted = message.match(/[«"']([^»"']{2,160})[»"']/u)?.[1];
  if (quoted) return quoted.trim();
  return message
    .replace(/(?:покажи|найди|скажи|какой|каков|сколько|есть|ли|текущий|текущая|остаток|остатки|на складе|в sap|материал|find|show|stock|for|in sap)/giu, " ")
    .replace(/[?!.,;:]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function cleanCatalogueQuery(message: string): string {
  const quoted = message.match(/[«"']([^»"']{2,160})[»"']/u)?.[1];
  if (quoted) return quoted.trim();
  return message
    .replace(
      /(?:на\s+складе|из\s+чего|что\s+входит|(?<![\p{L}\p{N}])(?:покажи|найди|подбери|скажи|какой|каков|сколько|есть|ли|текущий|текущая|для|в|из|по)(?![\p{L}\p{N}])|(?:остат|промышленн|каталог|каталожн|номенклатур|аналог|замен|взаимозамен|эквивалент|состав|спецификац|компонент|комплектующ|детал|узл|сборк)[\p{L}\p{N}_-]*|\b(?:BOM|find|show|catalog|catalogue|stock|analog|substitute|replacement|component)s?\b)/giu,
      " ",
    )
    .replace(/[?!.,;:]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function isCatalogueSubstituteRequest(message: string): boolean {
  return /(?:аналог|замен|эквивалент|взаимозамен|совместим|analogue|analog|substitute|replacement|interchangeab)/iu.test(
    message,
  );
}

function isCatalogueBomRequest(message: string): boolean {
  return /(?:\bBOM\b|состав|спецификац\w*\s+(?:узл|сборк)|компонент|комплектующ|детал|из чего|что входит|assembly contents?)/iu.test(
    message,
  );
}

interface AgentStockSearchQuery {
  label: string;
  text?: string;
  equipmentType?: string;
}

function stockSearchQueries(
  message: string,
  materialCode?: string,
  dictionary: SearchDictionaryEntry[] = [],
): AgentStockSearchQuery[] {
  if (materialCode) return [{ label: materialCode, text: materialCode }];
  const cleaned = cleanStockQuery(message);
  const normalized = normalizeText(cleaned);
  const candidates = [cleaned];
  const equipmentHints = [
    "электродвиг",
    "манометр",
    "проклад",
    "задвиж",
    "клапан",
    "флан",
    "отвод",
    "труб",
    "кабел",
    "лоток",
    "насос",
    "переход",
    "тройник",
    "шпиль",
    "болт",
    "motor",
    "gauge",
    "gasket",
    "valve",
    "flange",
    "elbow",
    "pipe",
    "cable",
    "pump",
    "reducer",
  ];
  const originalLower = cleaned.toLocaleLowerCase("ru-RU");
  const hint =
    equipmentHints.find((candidate) => originalLower.includes(candidate)) ??
    equipmentHints.find((candidate) => normalized.includes(candidate));
  if (hint) candidates.push(hint);
  const dimension = cleaned.match(/\b(?:DN|ДУ|PN|РУ)\s*[-–]?\s*\d+(?:[.,]\d+)?\b/iu)?.[0];
  if (dimension) candidates.push(dimension);
  const identifier = cleaned.match(/\b[A-ZА-Я0-9]+(?:-[A-ZА-Я0-9]+)+\b/iu)?.[0];
  if (identifier) candidates.push(identifier);
  const textQueries = unique(candidates.map((candidate) => candidate.trim()).filter(Boolean)).map(
    (text): AgentStockSearchQuery => ({ label: text, text }),
  );
  const dictionaryQueries = resolveDictionaryKeys(message, dictionary).map(
    (equipmentType): AgentStockSearchQuery => ({
      label: `equipment:${equipmentType}`,
      equipmentType,
    }),
  );
  return [...textQueries, ...dictionaryQueries];
}

function rankStockItems(
  items: SapMaterial[],
  message: string,
  dictionary: SearchDictionaryEntry[] = [],
): SapMaterial[] {
  const queryTokens = tokenizeWithDictionary([cleanStockQuery(message)], dictionary);
  return [...items].sort((left, right) => {
    const rightScore = tokenSimilarity(
      queryTokens,
      tokenizeWithDictionary(
        [
          right.materialCode,
          right.legacyCode,
          right.nameRu,
          right.nameEn,
          right.equipmentType,
          ...right.synonyms,
        ],
        dictionary,
      ),
    );
    const leftScore = tokenSimilarity(
      queryTokens,
      tokenizeWithDictionary(
        [
          left.materialCode,
          left.legacyCode,
          left.nameRu,
          left.nameEn,
          left.equipmentType,
          ...left.synonyms,
        ],
        dictionary,
      ),
    );
    if (rightScore !== leftScore) return rightScore - leftScore;
    return left.materialCode.localeCompare(right.materialCode, "ru");
  });
}

function cleanPositionQuery(message: string): string {
  return message
    .replace(/(?:кто|какая|какой|чья|ответственность|отвечает|подбери|найди|покажи|аналоги?|замены?|для|позиции?)/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function specificationCitation(specification: Specification): GroundedCitation {
  return {
    sourceSystem: "APPIUS",
    entityId: specification.id,
    versionOrSnapshot: `v${specification.latestVersionNumber}`,
    clauseId: null,
  };
}

function versionCitation(version: SpecificationVersion): GroundedCitation {
  return {
    sourceSystem: "APPIUS",
    entityId: version.specificationId,
    versionOrSnapshot: version.id,
    clauseId: null,
  };
}

function positionCitation(position: Position): GroundedCitation {
  return {
    sourceSystem: "APPIUS",
    entityId: position.id,
    versionOrSnapshot: position.versionId,
    clauseId: null,
  };
}

function materialCitation(material: SapMaterial): GroundedCitation {
  return {
    sourceSystem: "SAP",
    entityId: material.materialCode,
    versionOrSnapshot: material.snapshotAt,
    clauseId: null,
  };
}

function catalogItemCitation(item: CatalogItem | CatalogSearchItem): GroundedCitation {
  const snapshot =
    "latestSnapshotAt" in item && typeof item.latestSnapshotAt === "string"
      ? item.latestSnapshotAt
      : "CATALOGUE_SYNTHETIC_V1";
  return {
    sourceSystem: "CATALOG",
    entityId: item.itemCode,
    versionOrSnapshot: snapshot,
    clauseId: null,
  };
}

function catalogFamilyCitation(familyCode: string): GroundedCitation {
  return {
    sourceSystem: "CATALOG",
    entityId: familyCode,
    versionOrSnapshot: "CATALOGUE_SYNTHETIC_V1",
    clauseId: null,
  };
}

function catalogSearchCitation(query: string): GroundedCitation {
  return {
    sourceSystem: "CATALOG",
    entityId: `catalogue-search:${query}`,
    versionOrSnapshot: "CATALOGUE_SYNTHETIC_V1",
    clauseId: null,
  };
}

function sapSearchCitation(query: string, snapshotAt: string): GroundedCitation {
  return {
    sourceSystem: "SAP",
    entityId: `stock-search:${query}`,
    versionOrSnapshot: snapshotAt,
    clauseId: null,
  };
}

function sanitizeCatalogueSubstitutes(
  result: CatalogSubstituteResult,
): CatalogSubstituteResult {
  const family = result.family;
  if (!family?.active) return { ...result, items: [] };
  return {
    ...result,
    items: result.items.filter(
      (item) =>
        item.familyId === family.id &&
        item.equipmentType === family.equipmentType &&
        item.itemKind === family.itemKind &&
        item.unit === family.unit &&
        isValidCatalogueFamilyMember(item),
    ),
  };
}

function isValidCatalogueFamilyMember(item: CatalogItem): boolean {
  return (
    item.characteristics.compatibilityStatus === "VALID_MEMBER" &&
    !item.fixtureTags.some((tag) => /decoy|incompatible/iu.test(tag))
  );
}

function ruleCitation(rule: ResponsibilityRule | AnalogueRule): GroundedCitation {
  return {
    sourceSystem: "NORMATIVE",
    entityId: rule.documentId,
    versionOrSnapshot: rule.version,
    clauseId: rule.clauseId,
  };
}

function runCitation(run: ScenarioRun): GroundedCitation {
  return {
    sourceSystem: "SCENARIO",
    entityId: run.id,
    versionOrSnapshot: `v${run.version}:${run.updatedAt}`,
    clauseId: null,
  };
}

function integrationCitation(
  sourceSystem: "APPIUS" | "SAP",
  state: IntegrationState,
): GroundedCitation {
  return {
    sourceSystem,
    entityId: "integration-state",
    versionOrSnapshot: state.snapshotAt ?? state.lastSynchronizedAt ?? state.state,
    clauseId: null,
  };
}

function integrationStateMessage(system: "APPIUS" | "SAP", state: IntegrationState): string {
  const label = system === "APPIUS" ? "Appius" : "SAP";
  switch (state.state) {
    case "ACCESS_DENIED":
      return `Доступ к данным ${label} запрещён.`;
    case "RATE_LIMITED":
      return `${label} временно ограничил частоту запросов.`;
    case "MALFORMED_RESPONSE":
      return `${label} вернул ответ, не прошедший проверку контракта.`;
    case "STALE_VERSION":
      return "Appius сообщил об устаревшей версии; актуальные позиции не подтверждены.";
    default:
      return `${label} временно недоступен.`;
  }
}

function sanitizeRunForAgent(run: ScenarioRun): ScenarioRun {
  return {
    ...run,
    inputSnapshot: {},
    outputSnapshot: {},
    steps: run.steps.map((step) => ({ ...step, details: undefined })),
    ...(run.errorMessage
      ? { errorMessage: safeScenarioFailureMessage(run.errorCode) }
      : { errorMessage: undefined }),
  };
}

function safeScenarioFailureMessage(errorCode?: string): string {
  if (errorCode?.startsWith("SAP_")) {
    return "Шаг SAP завершился ошибкой; проверьте интеграцию или используйте ручной импорт.";
  }
  if (errorCode?.startsWith("APPIUS_")) {
    return "Шаг Appius завершился ошибкой; проверьте актуальную версию или загрузите спецификацию вручную.";
  }
  return "Запуск завершился ошибкой. Откройте журнал аудита с безопасным кодом ошибки.";
}

function safeToolError(
  sourceSystem: "APPIUS" | "SAP" | "CATALOG" | "NORMATIVE" | "SCENARIO" | "REPORT",
  error: unknown,
): { code: string; message: string } {
  const code = getErrorCode(error);
  const label =
    sourceSystem === "NORMATIVE"
      ? "Нормативное хранилище"
      : sourceSystem === "CATALOG"
        ? "Промышленный каталог"
        : sourceSystem;
  if (
    sourceSystem === "NORMATIVE" &&
    /^RAG_(?:UNAVAILABLE|RATE_LIMITED|MALFORMED_RESPONSE|STATE_NOT_CONFIGURED)$/u.test(code)
  ) {
    if (code === "RAG_RATE_LIMITED") {
      return { code, message: `${label} временно ограничило частоту запросов.` };
    }
    if (code === "RAG_MALFORMED_RESPONSE") {
      return { code, message: `${label} вернуло ответ, не прошедший проверку контракта.` };
    }
    return { code, message: `${label} временно недоступно.` };
  }
  if (/ACCESS|FORBIDDEN|UNAUTHORIZED/u.test(code)) {
    return { code: "ACCESS_DENIED", message: `Доступ к данным ${label} запрещён.` };
  }
  if (/RATE/u.test(code)) {
    return { code: "RATE_LIMITED", message: `${label} временно ограничил частоту запросов.` };
  }
  if (/MALFORMED|VALIDATION|PARSE/u.test(code) || error instanceof z.ZodError) {
    return { code: "MALFORMED_RESPONSE", message: `${label} вернул ответ, не прошедший проверку контракта.` };
  }
  if (/STALE/u.test(code)) {
    return { code: "STALE_DATA", message: `Актуальность данных ${label} не подтверждена.` };
  }
  return { code: `${sourceSystem}_UNAVAILABLE`, message: `${label} временно недоступен.` };
}

function safeLlmFailure(error: unknown): { code: string; message: string } {
  const code = getErrorCode(error);
  if (/RATE/u.test(code)) {
    return {
      code: "LLM_RATE_LIMITED",
      message:
        "Не удалось безопасно сформировать ответ: LLM-провайдер временно ограничил частоту запросов. Подтверждённые источники сохранены; повторите запрос позднее.",
    };
  }
  if (/MALFORMED|VALIDATION|PARSE/u.test(code) || error instanceof z.ZodError) {
    return {
      code: "LLM_MALFORMED_RESPONSE",
      message:
        "Не удалось безопасно сформировать ответ: ответ LLM-провайдера не прошёл проверку контракта. Подтверждённые источники сохранены; повторите запрос позднее.",
    };
  }
  if (/TIMEOUT/u.test(code)) {
    return {
      code: "LLM_TIMEOUT",
      message:
        "Не удалось безопасно сформировать ответ: LLM-провайдер не ответил в установленный срок. Подтверждённые источники сохранены; повторите запрос позднее.",
    };
  }
  if (/DISABLED|CANCELLED|BUDGET/u.test(code)) {
    return {
      code: code.startsWith("LLM_") ? code : "LLM_UNAVAILABLE",
      message:
        "Не удалось безопасно сформировать ответ: выполнение остановлено политикой безопасности LLM. Подтверждённые источники сохранены; обратитесь к оператору или повторите запрос позднее.",
    };
  }
  return {
    code: "LLM_UNAVAILABLE",
    message:
      "Не удалось безопасно сформировать ответ: LLM-провайдер временно недоступен. Подтверждённые источники сохранены; повторите запрос позднее.",
  };
}

function llmAuditDetails(provider: LLMProvider): Record<string, unknown> {
  const metadata = provider.metadata;
  if (!metadata) return { model: "Mock LLM" };
  return {
    provider: metadata.provider,
    model: metadata.model,
    modelVersion: metadata.version,
    trainingAllowed: metadata.trainingAllowed,
    retentionAllowed: metadata.retentionAllowed,
    reasoningPersistence: metadata.reasoningPersistence,
  };
}

function getErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "UNKNOWN";
  const record = error as Record<string, unknown>;
  const code = record.code ?? record.name;
  return typeof code === "string" ? code.toLocaleUpperCase("en-US") : "UNKNOWN";
}

function summarizeResult(result: unknown): Record<string, unknown> {
  if (Array.isArray(result)) return { kind: "array", count: result.length };
  if (typeof result !== "object" || result === null) return { kind: typeof result };
  const record = result as Record<string, unknown>;
  return {
    kind: "object",
    id: typeof record.id === "string" ? record.id : undefined,
    state: typeof record.state === "string" ? record.state : undefined,
    status: typeof record.status === "string" ? record.status : undefined,
    count: Array.isArray(record.items) ? record.items.length : undefined,
    total: typeof record.total === "number" ? record.total : undefined,
  };
}

function dedupeCitations(citations: GroundedCitation[]): GroundedCitation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = `${citation.sourceSystem}:${citation.entityId}:${citation.versionOrSnapshot}:${citation.clauseId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
