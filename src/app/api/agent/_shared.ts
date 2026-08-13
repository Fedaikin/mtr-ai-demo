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
import { createUniversalAgentReadPort } from "@/adapters/persistence/universal-agent-read-port";
import { loadUniversalChatMemory } from "@/adapters/persistence/universal-chat-memory";
import type { MtrRepository } from "@/adapters/persistence/repository";
import { toPublicAgentDecision } from "@/application/agent-presentation";
import { AuditedAgentCommandCapability } from "@/application/agent-orchestrator/audited-command-capability";
import { createAgentCommandRegistry } from "@/application/agent-orchestrator/command-registry";
import { readAgentFeaturePolicy } from "@/application/agent-orchestrator/feature-policy";
import { createOfflineProviderConformance } from "@/application/agent-orchestrator/provider-conformance";
import { restorePublicAgentCommandResult } from "@/application/agent-orchestrator/public-projection";
import { createUniversalReadCapabilityRegistry } from "@/application/agent-orchestrator/universal-chat/read-capabilities";
import { UniversalChatService } from "@/application/agent-orchestrator/universal-chat/universal-chat-service";
import {
  agentChatInputSchema,
  MtrAgentOrchestrator,
} from "@/application/agent-orchestrator/orchestrator";
import type { AgentEventCapability } from "@/application/agent-orchestrator/orchestrator";
import { createAgentService, type AgentService } from "@/application/agent-service";
import type { PositionAnalysisResult, ReportSummary } from "@/domain/models";

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
      ? new UniversalChatService(
        createUniversalReadCapabilityRegistry(
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
        ),
      )
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
  return {
    id: bundle.message.id,
    threadId: bundle.message.threadId,
    role: bundle.message.role,
    content: commandResult?.answer ?? decision?.answer ?? bundle.message.content,
    structuredOutput: commandResult ?? (decision
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
