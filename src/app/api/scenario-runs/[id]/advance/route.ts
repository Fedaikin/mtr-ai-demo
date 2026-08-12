import { ScenarioService } from "@/application/scenario-service";
import { ok } from "@/lib/api";
import { parseIfMatch, toScenarioErrorResponse } from "@/lib/scenario-http";
import { requireDemoRole } from "@/lib/session";

export async function POST(request: Request, { params }: RouteContext<"/api/scenario-runs/[id]/advance">) {
  try {
    const [{ id }, { user }, service] = await Promise.all([
      params,
      requireDemoRole("ADMIN"),
      ScenarioService.create(),
    ]);
    return ok(await service.advance(user.id, id, parseIfMatch(request)));
  } catch (error) {
    return toScenarioErrorResponse(error);
  }
}
