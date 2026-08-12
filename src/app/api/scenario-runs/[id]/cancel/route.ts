import { ScenarioService } from "@/application/scenario-service";
import { ok } from "@/lib/api";
import { toScenarioErrorResponse } from "@/lib/scenario-http";
import { requireDemoRole } from "@/lib/session";

export async function POST(_request: Request, { params }: RouteContext<"/api/scenario-runs/[id]/cancel">) {
  try {
    const [{ id }, { user }, service] = await Promise.all([
      params,
      requireDemoRole("ADMIN"),
      ScenarioService.create(),
    ]);
    return ok(await service.cancel(user.id, id));
  } catch (error) {
    return toScenarioErrorResponse(error);
  }
}
