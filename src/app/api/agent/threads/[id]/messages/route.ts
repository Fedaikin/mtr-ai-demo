import { getRepository } from "@/adapters/persistence/repository";
import { agentInputSchema } from "@/application/agent-service";
import { ApiError, created, ok, parseJson, toErrorResponse } from "@/lib/api";
import { requireDemoRole } from "@/lib/session";

import {
  createAgentRuntime,
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
    const sessionPromise = requireDemoRole("USER");
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
    const sessionPromise = requireDemoRole("USER");
    const repositoryPromise = getRepository();
    const bodyPromise = parseJson(request);
    const [threadId, session, repository, body] = await Promise.all([
      paramsPromise,
      sessionPromise,
      repositoryPromise,
      bodyPromise,
    ]);

    const input = agentInputSchema.parse(body);
    if (!input.threadId || input.threadId !== threadId) {
      throw new ApiError(
        400,
        "AGENT_THREAD_MISMATCH",
        "Идентификатор диалога в запросе не совпадает с адресом",
      );
    }

    const thread = await requireOwnedAgentThread(repository, session.user.id, threadId);
    if (!thread) {
      throw new ApiError(404, "AGENT_THREAD_NOT_FOUND", "Диалог агента не найден");
    }

    const [userMessage, activePrompt] = await Promise.all([
      repository.appendAgentMessage(session.user.id, {
        threadId,
        role: "user",
        content: input.message,
      }),
      repository.getActivePrompt(session.user.id),
    ]);

    const service = createAgentRuntime(repository);
    const output = await service.respond({
      ...input,
      userId: session.user.id,
      correlationId: `agent-${crypto.randomUUID()}`,
      promptVersion: activePrompt?.promptVersion ?? "mtr-agent-system-v1",
    });
    const assistantMessage = await repository.appendAgentMessage(session.user.id, {
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
    return toErrorResponse(error);
  }
}
