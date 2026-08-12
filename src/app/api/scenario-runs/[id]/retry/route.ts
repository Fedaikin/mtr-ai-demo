import { ScenarioService } from "@/application/scenario-service";
import { scheduleScenarioRunDrain } from "@/application/scenario-background";
import { created } from "@/lib/api";
import { toScenarioErrorResponse } from "@/lib/scenario-http";
import { requireDemoRole } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(_request: Request, { params }: RouteContext<"/api/scenario-runs/[id]/retry">) {
  try {
    const [{ id }, { user }, service] = await Promise.all([
      params,
      requireDemoRole("ADMIN"),
      ScenarioService.create(),
    ]);
    const run = await service.retry(user.id, id);
    scheduleScenarioRunDrain(user.id, run.id);
    return created(run);
  } catch (error) {
    return toScenarioErrorResponse(error);
  }
}
