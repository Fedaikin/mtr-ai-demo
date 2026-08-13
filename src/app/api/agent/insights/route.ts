import { createAgentEventStore } from "@/adapters/persistence/agent-event-store";
import { AgentEventService } from "@/application/agent-orchestrator/event-service";
import { readAgentFeaturePolicy } from "@/application/agent-orchestrator/feature-policy";
import { ApiError, ok, toErrorResponse } from "@/lib/api";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!readAgentFeaturePolicy().orchestratorEnabled) {
      throw new ApiError(404, "MTR_AGENT_ORCHESTRATOR_DISABLED", "Сигналы МТР-агента недоступны");
    }
    const [session, store] = await Promise.all([
      requirePermission("agent.chat"),
      createAgentEventStore(),
    ]);
    return ok({ items: await new AgentEventService(store).listInsights(session.authorization) }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
