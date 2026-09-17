import { z } from "zod";

import { getRepository } from "@/adapters/persistence/repository";
import { ApiError, ok, parseJson, toErrorResponse } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { requirePermission } from "@/lib/session";

export const runtime = "nodejs";

const clearAnalysisSchema = z.object({
  runId: z.string().trim().min(1).max(200),
}).strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const [{ user, authorization }, repository, input] = await Promise.all([
      requirePermission("analysis.create"),
      getRepository(),
      parseJson(request).then((body) => clearAnalysisSchema.parse(body)),
    ]);
    if (!authorization.activeProjectId) {
      throw new ApiError(403, "PROJECT_SCOPE_REQUIRED", "Выберите доступный проект");
    }
    const cleared = await repository.clearAnalysisView(
      user.id,
      authorization.activeProjectId,
      input.runId,
      user.displayName,
      authorization.authorizationVersion,
      authorization.requestId,
    );
    if (!cleared) {
      throw new ApiError(404, "COMPLETED_ANALYSIS_NOT_FOUND", "Завершённый анализ не найден");
    }
    return ok(cleared);
  } catch (error) {
    return toErrorResponse(error);
  }
}
