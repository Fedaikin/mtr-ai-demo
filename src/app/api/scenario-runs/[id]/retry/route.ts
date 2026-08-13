import { ScenarioService } from "@/application/scenario-service";
import { scheduleScenarioRunDrain } from "@/application/scenario-background";
import { created } from "@/lib/api";
import { toScenarioErrorResponse } from "@/lib/scenario-http";
import { SessionError, requireAnyPermission } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(_request: Request, { params }: RouteContext<"/api/scenario-runs/[id]/retry">) {
  try {
    const [{ id }, session, service] = await Promise.all([
      params,
      requireAnyPermission(["analysis.retry.own", "analysis.retry.any"]),
      ScenarioService.create(),
    ]);
    const previous = await service.getRun(session.user.id, id);
    if (!session.authorization.permissionKeys.has("analysis.retry.any") && previous.inputSnapshot.requestedBy !== (session.user.subjectId ?? session.user.id)) throw new SessionError("Можно повторять только собственные запуски", 403);
    const run = await service.retry(session.user.id, id);
    scheduleScenarioRunDrain(session.user.id, run.id);
    return created(run);
  } catch (error) {
    return toScenarioErrorResponse(error);
  }
}
