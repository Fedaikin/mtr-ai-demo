import { ok } from "@/lib/api";
import { requirePermission } from "@/lib/session";

import { actionErrorResponse, assertActionsEnabled, createActionService } from "../../_shared";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: RouteContext<"/api/agent/actions/[id]/cancel">) {
  try {
    assertActionsEnabled();
    const [{ id }, session, service] = await Promise.all([
      params,
      requirePermission("agent.chat"),
      createActionService(),
    ]);
    return ok(await service.cancel(id, session.authorization));
  } catch (error) {
    return actionErrorResponse(error);
  }
}
