import { z } from "zod";

import { createAgentCaseStore } from "@/adapters/persistence/agent-case-store";
import { AgentCaseService } from "@/application/agent-orchestrator/case-service";
import { readAgentFeaturePolicy } from "@/application/agent-orchestrator/feature-policy";
import { ApiError, created, ok, parseJson } from "@/lib/api";
import { requirePermission } from "@/lib/session";

import { caseErrorResponse } from "./_errors";

export const dynamic = "force-dynamic";

const periodSchema = z.object({ from: z.string().datetime(), to: z.string().datetime() }).strict();
const createCaseSchema = z.object({
  title: z.string().trim().min(1).max(240),
  threadId: z.string().trim().min(1).max(200).optional(),
  requestKey: z.string().trim().min(1).max(200),
  contextSnapshot: z.object({
    specificationId: z.string().trim().min(1).max(200).optional(),
    positionId: z.string().trim().min(1).max(200).optional(),
    runId: z.string().trim().min(1).max(200).optional(),
    period: periodSchema.optional(),
  }).strict().optional(),
}).strict();

export async function GET() {
  try {
    assertEnabled();
    const session = await requirePermission("agent.chat");
    const service = new AgentCaseService(await createAgentCaseStore());
    return ok({ items: await service.list(session.authorization) }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return caseErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertEnabled();
    const [session, body, store] = await Promise.all([
      requirePermission("agent.chat"),
      parseJson(request),
      createAgentCaseStore(),
    ]);
    const service = new AgentCaseService(store);
    return created(await service.create(createCaseSchema.parse(body), session.authorization));
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
