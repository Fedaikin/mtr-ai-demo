import { ok } from "@/lib/api";
import { requirePermission } from "@/lib/session";

import { actionErrorResponse, assertActionConfirmationAllowed, assertActionsEnabled, createActionService } from "../../_shared";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: RouteContext<"/api/agent/actions/[id]/confirm">) {
  try {
    assertActionsEnabled();
    assertActionConfirmationAllowed();
    const [{ id }, session, service] = await Promise.all([
      params,
      requirePermission("agent.chat"),
      createActionService(),
    ]);
    return ok(await service.confirm(id, session.authorization));
  } catch (error) {
    return actionErrorResponse(error);
  }
}
