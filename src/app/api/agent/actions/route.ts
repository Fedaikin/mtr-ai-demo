import { toPublicAgentActionProposal } from "@/domain/agent/actions";
import { createAgentCaseStore } from "@/adapters/persistence/agent-case-store";
import { AgentCaseService } from "@/application/agent-orchestrator/case-service";
import { ApiError, created, ok, parseJson } from "@/lib/api";
import { requirePermission } from "@/lib/session";

import {
  actionErrorResponse,
  actionProposalSchema,
  assertActionsEnabled,
  createActionService,
} from "./_shared";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    assertActionsEnabled();
    const [session, service] = await Promise.all([
      requirePermission("agent.chat"),
      createActionService(),
    ]);
    return ok({ items: await service.list(session.authorization) }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return actionErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertActionsEnabled();
    const [session, body, service, caseStore] = await Promise.all([
      requirePermission("agent.chat"),
      parseJson(request),
      createActionService(),
      createAgentCaseStore(),
    ]);
    const input = actionProposalSchema.parse(body);
    const ownedCase = await new AgentCaseService(caseStore).get(input.caseId, session.authorization);
    if (!ownedCase) throw new ApiError(404, "AGENT_CASE_NOT_FOUND", "Кейс не найден");
    return created(toPublicAgentActionProposal(await service.propose(input, session.authorization)));
  } catch (error) {
    return actionErrorResponse(error);
  }
}
