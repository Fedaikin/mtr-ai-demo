import { z } from "zod";

import { createAgentLearningStore } from "@/adapters/persistence/agent-learning-store";
import {
  AgentFeedbackService,
  AgentLearningError,
} from "@/application/agent-orchestrator/learning-service";
import { AGENT_FEEDBACK_KINDS } from "@/domain/agent/learning";
import { ApiError, created, parseJson, toErrorResponse } from "@/lib/api";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

const messageIdSchema = z.string().trim().min(1).max(200);
const feedbackSchema = z.object({
  feedbackKind: z.enum(AGENT_FEEDBACK_KINDS),
  summary: z.string().trim().min(1).max(500).optional(),
}).strict();

interface FeedbackRouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: FeedbackRouteContext) {
  try {
    const [{ id }, session, body, store] = await Promise.all([
      params,
      requirePermission("agent.chat"),
      parseJson(request),
      createAgentLearningStore(),
    ]);
    const responseMessageId = messageIdSchema.parse(id);
    const input = feedbackSchema.parse(body);
    const receipt = await new AgentFeedbackService(store).submit({
      responseMessageId,
      ...input,
    }, session.authorization);
    const response = created({ feedback: receipt });
    response.headers.set("cache-control", "no-store, private");
    return response;
  } catch (error) {
    if (error instanceof AgentLearningError) return toErrorResponse(apiError(error));
    return toErrorResponse(error);
  }
}

function apiError(error: AgentLearningError): ApiError {
  const status = error.code === "AGENT_FEEDBACK_ACCESS_DENIED" ? 404 : 400;
  return new ApiError(status, error.code, error.message);
}
