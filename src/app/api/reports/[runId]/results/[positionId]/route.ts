import { z } from "zod";

import { getRepository, OptimisticLockError } from "@/adapters/persistence/repository";
import { ApiError, ok, parseJson, toErrorResponse } from "@/lib/api";
import { requirePermission } from "@/lib/session";

const overrideSchema = z
  .object({
    responsibility: z.enum(["CUSTOMER", "CONTRACTOR"]),
    reason: z.string().trim().min(10).max(500),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/reports/[runId]/results/[positionId]">,
) {
  try {
    const [{ runId, positionId }, { user }, input] = await Promise.all([
      params,
      requirePermission("result.override"),
      parseJson(request).then((body) => overrideSchema.parse(body)),
    ]);
    const updated = await (await getRepository()).overrideAnalysisResponsibility(user.id, {
      runId,
      positionId,
      responsibility: input.responsibility,
      reason: input.reason,
      expectedVersion: input.expectedVersion,
      actorDisplayName: user.displayName,
    });
    return ok({
      result: updated.result,
      version: updated.version,
      updatedAt: updated.updatedAt,
    });
  } catch (error) {
    if (error instanceof OptimisticLockError) {
      return toErrorResponse(
        new ApiError(409, "RESULT_VERSION_CONFLICT", "Результат уже изменён. Обновите отчёт и повторите действие."),
      );
    }
    if (error instanceof Error && error.message.includes("не найден")) {
      return toErrorResponse(new ApiError(404, "RESULT_NOT_FOUND", "Результат анализа не найден."));
    }
    if (error instanceof Error && error.message.includes("должно отличаться")) {
      return toErrorResponse(new ApiError(409, "RESULT_UNCHANGED", error.message));
    }
    return toErrorResponse(error);
  }
}
