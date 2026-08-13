import { createAgentCaseStore } from "@/adapters/persistence/agent-case-store";
import { AgentCaseService } from "@/application/agent-orchestrator/case-service";
import { readAgentFeaturePolicy } from "@/application/agent-orchestrator/feature-policy";
import { ApiError, ok } from "@/lib/api";
import { requirePermission } from "@/lib/session";

import { caseErrorResponse } from "../route";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: RouteContext<"/api/agent/cases/[id]">) {
  try {
    assertEnabled();
    const [{ id }, session, store] = await Promise.all([
      params,
      requirePermission("agent.chat"),
      createAgentCaseStore(),
    ]);
    const item = await new AgentCaseService(store).get(id, session.authorization);
    if (!item) throw new ApiError(404, "AGENT_CASE_NOT_FOUND", "Кейс не найден");
    return ok(item, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return caseErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext<"/api/agent/cases/[id]">) {
  try {
    assertEnabled();
    const [{ id }, session, store] = await Promise.all([
      params,
      requirePermission("agent.chat"),
      createAgentCaseStore(),
    ]);
    return ok(await new AgentCaseService(store).close(id, session.authorization));
  } catch (error) {
    return caseErrorResponse(error);
  }
}

function assertEnabled(): void {
  const policy = readAgentFeaturePolicy();
  if (!policy.orchestratorEnabled) {
    throw new ApiError(404, "MTR_AGENT_ORCHESTRATOR_DISABLED", "Кейсы МТР-агента недоступны");
  }
  if (!policy.executionAllowed) {
    throw new ApiError(503, "MTR_AGENT_KILL_SWITCH_ACTIVE", "МТР-агент временно остановлен");
  }
}
