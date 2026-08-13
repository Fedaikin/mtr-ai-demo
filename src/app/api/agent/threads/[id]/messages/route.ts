import { getRepository } from "@/adapters/persistence/repository";
import { AuthorizationError } from "@/application/authorization-service";
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

    const thread = await requireOwnedAgentThread(repository, session.user.id, threadId);
    if (!thread) {
      throw new ApiError(404, "AGENT_THREAD_NOT_FOUND", "Диалог агента не найден");
    }

    const messages = await repository.listAgentMessages(session.user.id, threadId);
    return ok(
      { items: messages.filter(isUserVisibleAgentMessage).map(serializeAgentMessage) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
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
    const output = result.output;
    const assistantMessage = await repository.appendAgentMessage(subjectId, {
      threadId,
      role: "assistant",
      content: output.answer,
      structuredOutput: output as unknown as Record<string, unknown>,
      promptVersion: activePrompt?.promptVersion ?? "mtr-agent-system-v1",
      citations: output.citations,
    });

    return created({
      items: [serializeAgentMessage(userMessage), serializeAgentMessage(assistantMessage)],
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
