import { z } from "zod";

import { getRepository } from "@/adapters/persistence/repository";
import { ApiError, ok, parseJson, toErrorResponse } from "@/lib/api";
import { requirePermission } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const routeParamsSchema = z.object({ id: z.string().trim().min(1).max(160) });
const updateSchema = z.object({ enabled: z.boolean() }).strict();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const [session, repository, input, routeParams] = await Promise.all([
      requirePermission("scenario_template.manage"),
      getRepository(),
      parseJson(request).then((body) => updateSchema.parse(body)),
      params.then((value) => routeParamsSchema.parse(value)),
    ]);
    const scenario = await repository.setScenarioEnabled(
      session.user.id,
      routeParams.id,
      input.enabled,
    );
    if (!scenario) {
      throw new ApiError(404, "SCENARIO_NOT_FOUND", "Сценарий не найден.");
    }
    await repository.writeAudit(session.user.id, {
      action: "ADMIN_SCENARIO_ENABLED_UPDATED",
      entityType: "SCENARIO",
      entityId: scenario.id,
      outcome: "SUCCESS",
      details: { enabled: scenario.enabled },
    });
    return ok({
      scenario: {
        id: scenario.id,
        name: scenario.name,
        enabled: scenario.enabled,
      },
      isSyntheticDemo: true,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
