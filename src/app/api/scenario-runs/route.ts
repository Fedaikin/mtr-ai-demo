import { ScenarioService } from "@/application/scenario-service";
import { scheduleScenarioRunDrain } from "@/application/scenario-background";
import { TERMINAL_STATUSES } from "@/domain/scenario";
import { created, ok, parseJson } from "@/lib/api";
import { toScenarioErrorResponse } from "@/lib/scenario-http";
import { requireDemoRole } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  try {
    const [{ user }, service] = await Promise.all([requireDemoRole("USER"), ScenarioService.create()]);
    const runs = await service.listRuns(user.id);
    for (const run of runs.filter((item) => !TERMINAL_STATUSES.has(item.status)).slice(0, 4)) {
      scheduleScenarioRunDrain(user.id, run.id);
    }
    return ok({ items: runs });
  } catch (error) {
    return toScenarioErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const sessionPromise = requireDemoRole("ADMIN");
    const servicePromise = ScenarioService.create();
    const bodyPromise = parseJson(request);
    const [{ user }, service, body] = await Promise.all([sessionPromise, servicePromise, bodyPromise]);
    const run = await service.createRun(user.id, body);
    scheduleScenarioRunDrain(user.id, run.id);
    return created(run);
  } catch (error) {
    return toScenarioErrorResponse(error);
  }
}
