import { getRepository } from "@/adapters/persistence/repository";
import { AuthorizationError } from "@/application/authorization-service";
import { projectAgentCommandResult } from "@/application/agent-orchestrator/public-projection";
import { reauthorizeSavedAgentCitations } from "@/application/agent-orchestrator/citation-authorization";
import { AgentContextError } from "@/domain/agent/context";
import { ApiError, created, ok, parseJson, toErrorResponse } from "@/lib/api";
import { requirePermission } from "@/lib/session";

import {
  agentChatInputSchema,
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

    const [userMessage, activePrompt] = await Promise.all([
      repository.appendAgentMessage(subjectId, {
        threadId,
        role: "user",
        content: input.message,
      }),
      repository.getActivePrompt(subjectId),
    ]);

    const orchestrator = createMtrAgentOrchestrator(repository);
    const result = await orchestrator.handle({
      kind: "CHAT",
      message: input.message,
      threadId,
      ...(input.selection === undefined ? {} : { selection: input.selection }),
      correlationId: `agent-${crypto.randomUUID()}`,
      promptVersion: activePrompt?.promptVersion ?? "mtr-agent-system-v1",
    }, session.authorization);
    const learningProjectId = session.authorization.activeProjectId;
    const assistant = result.kind === "COMMAND"
      ? (() => {
          const projection = projectAgentCommandResult(
            result.output,
            result.output.responseType + "-" + crypto.randomUUID(),
          );
          return {
            answer: projection.answer,
            structuredOutput: {
              ...projection,
              learningProvenance: {
                projectId: learningProjectId,
                caseId: null,
                modelVersion: "deterministic-runtime-v1",
                ruleVersions: result.output.responseType === "ANALYSIS"
                  ? [result.output.analysis.technicalTrace.semanticRegistryVersion]
                  : [],
                evidenceVersion: result.output.responseType === "ANALYSIS"
                  ? result.output.analysis.technicalTrace.evidenceGraphId
                  : null,
              },
            } as unknown as Record<string, unknown>,
            citations: result.output.citations.map((citation) => ({
              sourceSystem: citation.sourceSystem,
              entityId: citation.entityId,
              versionOrSnapshot: citation.sourceSnapshot,
              clauseId: citation.clauseId ?? null,
            })),
          };
        })()
      : {
          answer: result.output.answer,
          structuredOutput: {
            ...result.output,
            learningProvenance: {
              projectId: learningProjectId,
              caseId: null,
              modelVersion: "deterministic-runtime-v1",
              ruleVersions: [],
              evidenceVersion: null,
            },
          } as unknown as Record<string, unknown>,
          citations: result.output.citations,
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
