import { getRepository } from "@/adapters/persistence/repository";
import { createUniversalAgentReadPort } from "@/adapters/persistence/universal-agent-read-port";
import { AuthorizationError } from "@/application/authorization-service";
import { AttachmentImportService } from "@/application/agent-orchestrator/universal-chat/attachment-import-service";
import { projectAgentCommandResult } from "@/application/agent-orchestrator/public-projection";
import { reauthorizeSavedAgentCitations } from "@/application/agent-orchestrator/citation-authorization";
import { AgentContextError } from "@/domain/agent/context";
import { createAgentExecutionContext } from "@/domain/agent/context";
import { composeUniversalChatResult } from "@/application/agent-orchestrator/universal-chat/answer-composer";
import { ApiError, created, ok, parseJson, toErrorResponse } from "@/lib/api";
import { requirePermission } from "@/lib/session";

import {
  agentChatInputSchema,
  createPrivilegedActionChatService,
  createMtrAgentOrchestrator,
  isUserVisibleAgentMessage,
  requireOwnedAgentThread,
  serializeAgentMessage,
  threadIdSchema,
} from "../../../_shared";

export const dynamic = "force-dynamic";

interface MessagesRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: MessagesRouteContext) {
  try {
    const paramsPromise = params.then(({ id }) => threadIdSchema.parse(id));
    const sessionPromise = requirePermission("agent.chat");
    const repositoryPromise = getRepository();
    const [threadId, session, repository] = await Promise.all([
      paramsPromise,
      sessionPromise,
      repositoryPromise,
    ]);

    const subjectId = session.authorization.subjectId;
    const thread = await requireOwnedAgentThread(repository, subjectId, threadId);
    if (!thread) {
      throw new ApiError(404, "AGENT_THREAD_NOT_FOUND", "Диалог агента не найден");
    }

    const messages = await repository.listAgentMessages(subjectId, threadId);
    const visibleMessages = messages.filter(isUserVisibleAgentMessage);
    const authorizedCitations = await reauthorizeSavedAgentCitations(
      session.authorization,
      repository,
      visibleMessages.flatMap((message) => message.citations),
    );
    const authorizedCitationKeys = new Set(authorizedCitations.map(citationKey));
    const items = visibleMessages.map((message) => serializeAgentMessage(
      message,
      message.citations.filter((citation) => authorizedCitationKeys.has(citationKey(citation))),
    ));
    return ok(
      { items },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

function citationKey(citation: {
  readonly sourceSystem: string;
  readonly entityId: string;
  readonly versionOrSnapshot: string;
  readonly clauseId: string | null;
}): string {
  return [citation.sourceSystem, citation.entityId, citation.versionOrSnapshot, citation.clauseId ?? ""]
    .join("\u0000");
}

export async function POST(request: Request, { params }: MessagesRouteContext) {
  try {
    const paramsPromise = params.then(({ id }) => threadIdSchema.parse(id));
    const sessionPromise = requirePermission("agent.chat");
    const repositoryPromise = getRepository();
    const bodyPromise = parseJson(request);
    const [threadId, session, repository, body] = await Promise.all([
      paramsPromise,
      sessionPromise,
      repositoryPromise,
      bodyPromise,
    ]);

    const input = agentChatInputSchema.parse(body);
    if (!input.threadId || input.threadId !== threadId) {
      throw new ApiError(
        400,
        "AGENT_THREAD_MISMATCH",
        "Идентификатор диалога в запросе не совпадает с адресом",
      );
    }

    const subjectId = session.authorization.subjectId;
    const thread = await requireOwnedAgentThread(repository, subjectId, threadId);
    if (!thread) {
      throw new ApiError(404, "AGENT_THREAD_NOT_FOUND", "Диалог агента не найден");
    }

    const correlationId = `agent-${crypto.randomUUID()}`;
    const [userMessage, activePrompt] = await Promise.all([
      repository.appendAgentMessage(subjectId, {
        threadId,
        role: "user",
        content: input.message || "Приложен файл для проверки.",
        structuredOutput: input.attachments?.length
          ? {
              schemaVersion: "agent-attachment-refs-v1",
              attachments: input.attachments,
            }
          : undefined,
      }),
      repository.getActivePrompt(subjectId),
    ]);

    const attachmentResult = input.attachments?.length
      ? await new AttachmentImportService(
          repository,
          createUniversalAgentReadPort(),
        ).handle(
          input.message,
          input.attachments,
          createAgentExecutionContext(session.authorization, {
            selection: input.selection,
            correlationId,
          }),
        )
      : null;
    const privilegedActionService = !attachmentResult && input.message
      ? await createPrivilegedActionChatService(repository)
      : null;
    const privilegedActionResult = privilegedActionService
      ? await privilegedActionService.prepare(input.message, threadId, session.authorization)
      : null;
    const result = attachmentResult || privilegedActionResult
      ? null
      : await createMtrAgentOrchestrator(repository).handle({
          kind: "CHAT",
          message: input.message,
          threadId,
          ...(input.selection === undefined ? {} : { selection: input.selection }),
          correlationId,
          promptVersion: activePrompt?.promptVersion ?? "mtr-agent-system-v1",
        }, session.authorization);
    const learningProjectId = session.authorization.activeProjectId;
    const assistant = attachmentResult
      ? {
          answer: attachmentResult.content,
          structuredOutput: attachmentResult.structuredOutput as unknown as Record<string, unknown>,
          citations: [],
        }
      : privilegedActionResult
      ? {
          answer: privilegedActionResult.content,
          structuredOutput: privilegedActionResult.structuredOutput as unknown as Record<string, unknown>,
          citations: [],
        }
      : result!.kind === "UNIVERSAL"
      ? (() => {
          const universalOutput = result!.output;
          const content = composeUniversalChatResult(universalOutput);
          const clarification = "kind" in universalOutput;
          return {
            answer: content,
            structuredOutput: {
              schemaVersion: "universal-agent-answer-v1",
              output: universalOutput,
              learningProvenance: {
                projectId: learningProjectId,
                caseId: null,
                modelVersion: clarification
                  ? "deterministic-universal-runtime-v1"
                  : universalOutput.runtime?.model ?? "deterministic-universal-runtime-v1",
                ruleVersions: ["project-material-balance-v1", "technical-compatibility-v1", "reliability-comparison-v1"],
                evidenceVersion: "universal-chat-v1@1.0.0-DEMO",
              },
            } as unknown as Record<string, unknown>,
            citations: clarification ? [] : universalOutput.citations.flatMap((citation) => {
              const sourceSystem = universalCitationSource(citation.sourceSystem);
              return sourceSystem ? [{
                sourceSystem,
                entityId: citation.entityId,
                versionOrSnapshot: citation.versionOrSnapshot,
                clauseId: citation.clauseId ?? null,
              }] : [];
            }),
          };
        })()
      : result!.kind === "COMMAND"
      ? (() => {
          const projection = projectAgentCommandResult(
            result!.output,
            result!.output.responseType + "-" + crypto.randomUUID(),
          );
          return {
            answer: projection.answer,
            structuredOutput: {
              ...projection,
              learningProvenance: {
                projectId: learningProjectId,
                caseId: null,
                modelVersion: "deterministic-runtime-v1",
                ruleVersions: result!.output.responseType === "ANALYSIS"
                  ? [result!.output.analysis.technicalTrace.semanticRegistryVersion]
                  : [],
                evidenceVersion: result!.output.responseType === "ANALYSIS"
                  ? result!.output.analysis.technicalTrace.evidenceGraphId
                  : null,
              },
            } as unknown as Record<string, unknown>,
            citations: result!.output.citations.map((citation) => ({
              sourceSystem: citation.sourceSystem,
              entityId: citation.entityId,
              versionOrSnapshot: citation.sourceSnapshot,
              clauseId: citation.clauseId ?? null,
            })),
          };
        })()
      : {
          answer: result!.output.answer,
          structuredOutput: {
            ...result!.output,
            learningProvenance: {
              projectId: learningProjectId,
              caseId: null,
              modelVersion: "deterministic-runtime-v1",
              ruleVersions: [],
              evidenceVersion: null,
            },
          } as unknown as Record<string, unknown>,
          citations: result!.output.citations,
        };
    const assistantMessage = await repository.appendAgentMessage(subjectId, {
      threadId,
      role: "assistant",
      content: assistant.answer,
      structuredOutput: assistant.structuredOutput,
      promptVersion: activePrompt?.promptVersion ?? "mtr-agent-system-v1",
      citations: assistant.citations,
    });

    const authorizedAssistantCitations = await reauthorizeSavedAgentCitations(
      session.authorization,
      repository,
      assistantMessage.citations,
    );
    return created({
      items: [
        serializeAgentMessage(userMessage),
        serializeAgentMessage(assistantMessage, authorizedAssistantCitations),
      ],
    });
  } catch (error) {
    if (error instanceof AgentContextError) {
      return toErrorResponse(new ApiError(403, error.code, error.message));
    }
    if (error instanceof AuthorizationError) {
      return toErrorResponse(new ApiError(403, "AGENT_PERMISSION_DENIED", error.message));
    }
    return toErrorResponse(error);
  }
}

function universalCitationSource(
  sourceSystem: "APPIUS" | "SAP" | "CATALOG" | "NORMATIVE" | "FORECAST" | "PROCESS",
) {
  if (sourceSystem === "FORECAST") return "SAP" as const;
  if (sourceSystem === "PROCESS") return "PROCESS_ENGINE" as const;
  return sourceSystem;
}
