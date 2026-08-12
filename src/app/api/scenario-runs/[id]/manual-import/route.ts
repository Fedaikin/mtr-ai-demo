import { z } from "zod";

import { ScenarioService } from "@/application/scenario-service";
import { scheduleScenarioRunDrain } from "@/application/scenario-background";
import { ok, parseJson } from "@/lib/api";
import { parseIfMatch, toScenarioErrorResponse } from "@/lib/scenario-http";
import { requireDemoRole } from "@/lib/session";

const schema = z.object({ uploadedFileId: z.string().min(1).max(160) });

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request, { params }: RouteContext<"/api/scenario-runs/[id]/manual-import">) {
  try {
    const [{ id }, { user }, service, rawBody] = await Promise.all([
      params,
      requireDemoRole("ADMIN"),
      ScenarioService.create(),
      parseJson(request),
    ]);
    const { uploadedFileId } = schema.parse(rawBody);
    const run = await service.resumeWithManualImport(user.id, id, uploadedFileId, parseIfMatch(request));
    scheduleScenarioRunDrain(user.id, run.id);
    return ok(run);
  } catch (error) {
    return toScenarioErrorResponse(error);
  }
}
