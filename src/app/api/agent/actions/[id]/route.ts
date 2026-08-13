import { ok } from "@/lib/api";
import { requirePermission } from "@/lib/session";

import { actionErrorResponse, assertActionsEnabled, createActionService } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: RouteContext<"/api/agent/actions/[id]">) {
  try {
    assertActionsEnabled();
    const [{ id }, session, service] = await Promise.all([
      params,
      requirePermission("agent.chat"),
      createActionService(),
    ]);
    return ok(await service.get(id, session.authorization), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return actionErrorResponse(error);
  }
}
