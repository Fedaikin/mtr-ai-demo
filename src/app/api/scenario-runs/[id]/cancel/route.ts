import { ScenarioService } from "@/application/scenario-service";
import { ok } from "@/lib/api";
import { toScenarioErrorResponse } from "@/lib/scenario-http";
import { SessionError, requireAnyPermission } from "@/lib/session";

export async function POST(_request: Request, { params }: RouteContext<"/api/scenario-runs/[id]/cancel">) {
  try {
    const [{ id }, session, service] = await Promise.all([
      params,
      requireAnyPermission(["analysis.cancel.own", "analysis.cancel.any"]),
      ScenarioService.create(),
    ]);
    const run = await service.getRun(session.user.id, id);
    if (!session.authorization.permissionKeys.has("analysis.cancel.any") && run.inputSnapshot.requestedBy !== (session.user.subjectId ?? session.user.id)) throw new SessionError("Можно отменять только собственные запуски", 403);
    return ok(await service.cancel(session.user.id, id));
  } catch (error) {
    return toScenarioErrorResponse(error);
  }
}
