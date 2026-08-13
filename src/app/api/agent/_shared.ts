import "server-only";

import { z } from "zod";

import { AppiusMockAdapter } from "@/adapters/mock/appius-adapter";
import { IntegrationAwareLlmProvider } from "@/adapters/mock/integration-aware-llm-provider";
import { createMockLLMProvider } from "@/adapters/mock/mock-llm-provider";
import { createModelAnalyticalReadPort } from "@/adapters/mock/agent-analytical-read-port";
import { NormativeMockAdapter } from "@/adapters/mock/normative-adapter";
import { SapMockAdapter } from "@/adapters/mock/sap-adapter";
import { createCatalogRepositoryPort } from "@/adapters/persistence/catalog-port";
import { createAgentOrchestratorPersistencePorts } from "@/adapters/persistence/agent-orchestrator-ports";
import { createAgentActionStore } from "@/adapters/persistence/agent-action-store";
import { createAgentCaseStore } from "@/adapters/persistence/agent-case-store";
import { createUniversalAgentReadPort } from "@/adapters/persistence/universal-agent-read-port";
import { loadUniversalChatMemory } from "@/adapters/persistence/universal-chat-memory";
import type { MtrRepository } from "@/adapters/persistence/repository";
import { toPublicAgentDecision } from "@/application/agent-presentation";
import { AuditedAgentCommandCapability } from "@/application/agent-orchestrator/audited-command-capability";
import { PlatformAgentActionExecutor } from "@/application/agent-orchestrator/action-executor";
import { AgentActionService } from "@/application/agent-orchestrator/action-service";
import { AgentCaseService } from "@/application/agent-orchestrator/case-service";
import { createAgentCommandRegistry } from "@/application/agent-orchestrator/command-registry";
import { readAgentFeaturePolicy } from "@/application/agent-orchestrator/feature-policy";
import { createOfflineProviderConformance } from "@/application/agent-orchestrator/provider-conformance";
import { PrivilegedActionChatService } from "@/application/agent-orchestrator/privileged-action-chat-service";
import { restorePublicAgentCommandResult } from "@/application/agent-orchestrator/public-projection";
import { createUniversalReadCapabilityRegistry } from "@/application/agent-orchestrator/universal-chat/read-capabilities";
import { UniversalChatService } from "@/application/agent-orchestrator/universal-chat/universal-chat-service";
import { LiveUniversalChatService } from "@/application/agent-orchestrator/universal-chat/live-universal-chat-service";
import {
  OpenAIResponsesPlanner,
  readOpenAIResponsesPlannerConfig,
} from "@/application/agent-orchestrator/universal-chat/live-planner";
import { MTR_AGENT_UNIVERSAL_PROMPT } from "@/application/agent-orchestrator/system-prompt";
import {
  agentChatInputSchema,
  MtrAgentOrchestrator,
} from "@/application/agent-orchestrator/orchestrator";
import type { AgentEventCapability } from "@/application/agent-orchestrator/orchestrator";
import { createAgentService, type AgentService } from "@/application/agent-service";
import { scheduleScenarioRunDrain } from "@/application/scenario-background";
import type { PositionAnalysisResult, ReportSummary } from "@/domain/models";
import { AGENT_ACTION_TYPES } from "@/domain/agent/actions";

export { agentChatInputSchema };

export const createThreadInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const threadIdSchema = z.string().trim().min(1).max(200);

const reportSummarySchema = z
  .object({
    total: z.number().nonnegative(),
    exact: z.number().nonnegative(),
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

type ThreadRow = Awaited<ReturnType<MtrRepository["listAgentThreads"]>>[number];
type MessageBundle = Awaited<ReturnType<MtrRepository["listAgentMessages"]>>[number];

export function createAgentRuntime(repository: MtrRepository): AgentService {
  return createAgentService({
    appius: new AppiusMockAdapter(repository),
    sap: new SapMockAdapter(repository),
    catalog: createCatalogRepositoryPort(repository),
    norms: new NormativeMockAdapter(repository),
    scenarios: {
      getRun: (id: string, userId: string) => repository.getRun(userId, id),
      getPositionResult: async (runId: string, positionId: string, userId: string) => {
        const records = await repository.listAnalysisResults(userId, runId);
        const record = records.find((item) => item.positionId === positionId);
        return record ? (record.result as unknown as PositionAnalysisResult) : null;
      },
    },
    reports: {
      getSummary: async (runId: string, userId: string) => {
        const run = await repository.getRun(userId, runId);
        if (!run) return null;
        const records = await repository.listAnalysisResults(userId, runId);
        if (records.length > 0) return summarizeResults(records);
        const report = asRecord(run.outputSnapshot.report);
        const parsed = reportSummarySchema.safeParse(report?.summary);
        if (parsed.success) return parsed.data as ReportSummary;
        return null;
      },
    },
    llm: createOfflineProviderConformance(
      new IntegrationAwareLlmProvider(repository, createMockLLMProvider()),
    ),
    dictionaries: {
      listActive: (userId: string) =>
        repository.listDictionaries(userId, "MTR_SEARCH_SYNONYMS"),
    },
    audit: {
      write: async (entry) => {
        const { userId, ...input } = entry;
        await repository.writeAudit(userId, input);
      },
    },
  });
}

export function createMtrAgentOrchestrator(
  repository: MtrRepository,
  events?: AgentEventCapability,
): MtrAgentOrchestrator {
  const policy = readAgentFeaturePolicy();
  const commandCapability = policy.orchestratorEnabled && policy.executionAllowed
    ? new AuditedAgentCommandCapability(
        createAgentCommandRegistry(
          createAgentOrchestratorPersistencePorts(repository, createModelAnalyticalReadPort()),
        ),
        repository,
        undefined,
        repository,
      )
    : undefined;
  const universalService = policy.universalChatEnabled
    ? createUniversalService(repository, policy.liveLlmEnabled === true)
    : undefined;
  return new MtrAgentOrchestrator(
    createAgentRuntime(repository),
    commandCapability,
    events,
    universalService
      ? {
          respond: async (request, context) => universalService.respond({
            message: request.message,
            threadId: request.threadId,
            memory: await loadUniversalChatMemory(
              repository,
              context.trusted.subjectId,
              request.threadId,
            ),
          }, context),
        }
      : undefined,
  );
}

export async function createPrivilegedActionChatService(
  repository: MtrRepository,
): Promise<PrivilegedActionChatService | null> {
  const policy = readAgentFeaturePolicy();
  if (!policy.actionsEnabled || !policy.executionAllowed) return null;
  const [actionStore, caseStore] = await Promise.all([
    createAgentActionStore(),
    createAgentCaseStore(),
  ]);
  return new PrivilegedActionChatService(
    new AgentActionService(
      actionStore,
      new PlatformAgentActionExecutor(repository, {
        scheduleScenarioRun: scheduleScenarioRunDrain,
      }),
    ),
    new AgentCaseService(caseStore),
  );
}

function createUniversalService(
  repository: MtrRepository,
  liveLlmEnabled: boolean,
) {
  const registry = createUniversalReadCapabilityRegistry(
    createUniversalAgentReadPort(),
    undefined,
    {
      write: async (context, event) => {
        await repository.writeAudit(context.trusted.subjectId, {
          actorDisplayName: context.trusted.displayName,
          action: event.outcome === "SUCCESS"
            ? "agent.universal.capability.completed"
            : "agent.universal.capability.failed",
          entityType: "AGENT_CAPABILITY",
          entityId: event.capabilityKey,
          outcome: event.outcome,
          details: {
            capabilityKey: event.capabilityKey,
            projectId: context.trusted.activeProjectId,
            authorizationVersion: context.trusted.authorizationVersion,
            durationMs: event.durationMs,
            ...(event.safeErrorCode ? { safeErrorCode: event.safeErrorCode } : {}),
          },
          requestId: context.correlationId,
        });
      },
    },
  );
  const deterministic = new UniversalChatService(registry);
  const config = liveLlmEnabled ? readOpenAIResponsesPlannerConfig() : null;
  if (!config) return deterministic;
  return new LiveUniversalChatService(
    new OpenAIResponsesPlanner(config),
    registry,
    deterministic,
    MTR_AGENT_UNIVERSAL_PROMPT,
    {
      write: async (context, event) => {
        await repository.writeAudit(context.trusted.subjectId, {
          actorDisplayName: context.trusted.displayName,
          action: event.outcome === "SUCCESS"
            ? "agent.universal.live.completed"
            : "agent.universal.live.fallback",
          entityType: "AGENT_LLM_RESPONSE",
          entityId: context.correlationId,
          outcome: event.outcome === "SUCCESS" ? "SUCCESS" : "ERROR",
          details: {
            provider: event.trace?.provider ?? "OPENAI",
            model: event.trace?.model ?? config.model,
            providerVersion: event.trace?.providerVersion ?? config.providerVersion,
            promptVersion: event.trace?.promptVersion ?? config.promptVersion,
            authorizationVersion: context.trusted.authorizationVersion,
            durationMs: event.trace?.durationMs ?? null,
            inputTokens: event.trace?.inputTokens ?? null,
            outputTokens: event.trace?.outputTokens ?? null,
            totalTokens: event.trace?.totalTokens ?? null,
            ...(event.safeErrorCode ? { safeErrorCode: event.safeErrorCode } : {}),
          },
          requestId: context.correlationId,
        });
      },
    },
  );
}

export async function requireOwnedAgentThread(
  repository: MtrRepository,
  userId: string,
  threadId: string,
): Promise<ThreadRow | null> {
  const threads = await repository.listAgentThreads(userId);
  return threads.find((thread) => thread.id === threadId) ?? null;
}

export function serializeAgentThread(thread: ThreadRow) {
  return {
    id: thread.id,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    version: thread.version,
  };
}

export function serializeAgentMessage(
  bundle: MessageBundle,
  authorizedCitations: MessageBundle["citations"] = bundle.citations,
) {
  const assistant = bundle.message.role === "assistant";
  const commandResult = assistant
    ? restorePublicAgentCommandResult(bundle.message.structuredOutput, authorizedCitations)
    : null;
  const decision = assistant
    ? toPublicAgentDecision(bundle.message.content, bundle.message.structuredOutput)
    : null;
  const attachmentOutput = toPublicAttachmentOutput(bundle.message.structuredOutput, assistant);
  const privilegedActionOutput = assistant
    ? toPublicPrivilegedActionOutput(bundle.message.structuredOutput)
    : null;
  return {
    id: bundle.message.id,
    threadId: bundle.message.threadId,
    role: bundle.message.role,
    content: commandResult?.answer ?? decision?.answer ?? bundle.message.content,
    structuredOutput: commandResult ?? attachmentOutput ?? privilegedActionOutput ?? (decision
      ? {
          ...(decision.confidence === undefined ? {} : { confidence: decision.confidence }),
          ...(decision.requiresHumanReview === undefined
            ? {}
            : { requiresHumanReview: decision.requiresHumanReview }),
        }
      : null),
    createdAt: bundle.message.createdAt,
    citations: authorizedCitations.map((citation) => ({
      sourceSystem: citation.sourceSystem,
      entityId: citation.entityId,
      versionOrSnapshot: citation.versionOrSnapshot,
      clauseId: citation.clauseId,
    })),
  };
}

function toPublicPrivilegedActionOutput(value: unknown): Record<string, unknown> | null {
  const root = asRecord(value);
  if (!root || root.schemaVersion !== "agent-privileged-action-v1") return null;
  const raw = asRecord(root.actionProposal);
  const clarification = typeof root.clarification === "string" ? root.clarification.slice(0, 500) : null;
  if (!raw) {
    return { schemaVersion: "agent-privileged-action-v1", actionProposal: null, clarification };
  }
  const actionType = typeof raw.actionType === "string" && (AGENT_ACTION_TYPES as readonly string[]).includes(raw.actionType)
    ? raw.actionType
    : null;
  const status = typeof raw.status === "string" && ["PROPOSED", "EXECUTING", "SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"].includes(raw.status)
    ? raw.status
    : null;
  if (!actionType || !status || typeof raw.id !== "string") return null;
  const parameters = asRecord(raw.parameters);
  const impact = asRecord(parameters?.impact);
  const result = asRecord(raw.result);
  const safeLink = typeof result?.link === "string" && result.link.startsWith("/") && !result.link.startsWith("//")
    ? result.link
    : null;
  return {
    schemaVersion: "agent-privileged-action-v1",
    actionProposal: {
      id: raw.id.slice(0, 200),
      actionType,
      summary: typeof raw.summary === "string" ? raw.summary.slice(0, 300) : "Действие доступа",
      consequences: safeStringArray(raw.consequences).slice(0, 8),
      parameters: impact ? { impact: safeImpact(impact) } : {},
      status,
      expiresAt: typeof raw.expiresAt === "string" ? raw.expiresAt : "",
      result: result
        ? {
            resourceType: typeof result.resourceType === "string" ? result.resourceType.slice(0, 120) : "",
            resourceId: "",
            status: result.status === "ACCEPTED" ? "ACCEPTED" : "COMPLETED",
            safeSummary: typeof result.safeSummary === "string" ? result.safeSummary.slice(0, 300) : "Действие выполнено",
            link: safeLink,
          }
        : null,
    },
    clarification,
  };
}

function safeImpact(value: Record<string, unknown>): Record<string, unknown> {
  return {
    targetDisplayName: typeof value.targetDisplayName === "string" ? value.targetDisplayName.slice(0, 300) : "",
    targetLogin: typeof value.targetLogin === "string" ? value.targetLogin.slice(0, 200) : null,
    currentStatus: typeof value.currentStatus === "string" ? value.currentStatus.slice(0, 120) : "",
    currentRoles: safeStringArray(value.currentRoles),
    projectLabel: typeof value.projectLabel === "string" ? value.projectLabel.slice(0, 300) : null,
    newState: typeof value.newState === "string" ? value.newState.slice(0, 300) : "",
    affectedSessions: finiteNumber(value.affectedSessions),
    affectedAssignments: finiteNumber(value.affectedAssignments),
    segregationOfDuties: value.segregationOfDuties === "PASS" ? "PASS" : "BLOCKED",
    lastAdministratorRisk: value.lastAdministratorRisk === true,
    lastProjectManagerRisk: value.lastProjectManagerRisk === true,
  };
}

function toPublicAttachmentOutput(value: unknown, assistant: boolean): Record<string, unknown> | null {
  const root = asRecord(value);
  if (!root) return null;
  if (!assistant && root.schemaVersion === "agent-attachment-refs-v1" && Array.isArray(root.attachments)) {
    return {
      schemaVersion: "agent-attachment-refs-v1",
      attachments: root.attachments.slice(0, 4).map((item) => {
        const record = asRecord(item);
        return { purpose: safeAttachmentPurpose(record?.purpose) };
      }),
    };
  }
  if (!assistant || root.schemaVersion !== "agent-attachment-import-v1") return null;
  const raw = asRecord(root.attachmentImport);
  if (!raw) return null;
  const status = ["PREVIEW", "REVIEW_REQUIRED", "PUBLISHED"].includes(String(raw.status))
    ? String(raw.status)
    : "REVIEW_REQUIRED";
  const previewRows = Array.isArray(raw.previewRows)
    ? raw.previewRows.slice(0, 20).flatMap((item) => {
        const row = asRecord(item);
        return row && typeof row.code === "string" && typeof row.name === "string"
          ? [{
              code: row.code.slice(0, 160),
              name: row.name.slice(0, 500),
              quantity: finiteNumber(row.quantity),
              unit: typeof row.unit === "string" ? row.unit.slice(0, 30) : "",
            }]
          : [];
      })
    : [];
  const published = asRecord(raw.published);
  const safeHref = typeof published?.href === "string" && /^\/specifications\/[A-Za-z0-9._%/-]+$/u.test(published.href)
    ? published.href
    : null;
  return {
    schemaVersion: "agent-attachment-import-v1",
    attachmentImport: {
      status,
      fileName: typeof raw.fileName === "string" ? raw.fileName.slice(0, 200) : "Вложение",
      totalRows: finiteNumber(raw.totalRows),
      validRows: finiteNumber(raw.validRows),
      invalidRows: finiteNumber(raw.invalidRows),
      warnings: safeStringArray(raw.warnings),
      errors: safeStringArray(raw.errors),
      previewRows,
      targetMode: raw.targetMode === "NEW" || raw.targetMode === "NEW_VERSION" ? raw.targetMode : null,
      targetLabel: typeof raw.targetLabel === "string" ? raw.targetLabel.slice(0, 500) : null,
      ...(safeHref
        ? {
            published: {
              href: safeHref,
              versionNumber: finiteNumber(published?.versionNumber),
              positionCount: finiteNumber(published?.positionCount),
            },
          }
        : {}),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeAttachmentPurpose(value: unknown): string {
  return ["SPECIFICATION", "SAP_IMPORT", "REFERENCE", "AUTO"].includes(String(value))
    ? String(value)
    : "AUTO";
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, 20).map((item) => item.slice(0, 500))
    : [];
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function isUserVisibleAgentMessage(bundle: MessageBundle): boolean {
  return bundle.message.role === "user" || bundle.message.role === "assistant";
}

function summarizeResults(
  records: Awaited<ReturnType<MtrRepository["listAnalysisResults"]>>,
): ReportSummary {
  const countCategory = (category: string) =>
    records.filter((record) => record.matchCategory === category).length;
  return {
    total: records.length,
    exact: countCategory("EXACT"),
    found: records.filter((record) => record.status === "FOUND").length,
    likely: countCategory("LIKELY"),
    review: countCategory("REVIEW"),
    noMatch: countCategory("NO_MATCH"),
    analogues: records.filter((record) => Boolean(asRecord(record.result)?.analogueCoverage)).length,
    insufficient: records.filter((record) => record.status === "INSUFFICIENT").length,
    procurement: records.filter(
      (record) => record.status === "INSUFFICIENT" || record.status === "NOT_FOUND",
    ).length,
    customerResponsibility: records.filter((record) => record.responsibility === "CUSTOMER").length,
    contractorResponsibility: records.filter((record) => record.responsibility === "CONTRACTOR").length,
  };
}
