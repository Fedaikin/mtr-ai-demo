import { ScenarioService } from "@/application/scenario-service";
import { scheduleScenarioRunDrain } from "@/application/scenario-background";
import { TERMINAL_STATUSES } from "@/domain/scenario";
import { ok } from "@/lib/api";
import { toScenarioErrorResponse } from "@/lib/scenario-http";
import { requireDemoRole } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(_request: Request, { params }: RouteContext<"/api/scenario-runs/[id]">) {
  try {
    const [{ id }, { user }, service] = await Promise.all([
      params,
      requireDemoRole("USER"),
      ScenarioService.create(),
    ]);
    const run = await service.getRun(user.id, id);
    if (!TERMINAL_STATUSES.has(run.status)) scheduleScenarioRunDrain(user.id, run.id);
    return ok(run);
  } catch (error) {
    return toScenarioErrorResponse(error);
  }
}
