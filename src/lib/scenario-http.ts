import { OptimisticLockError } from "@/adapters/persistence/repository";
import { ScenarioServiceError } from "@/application/scenario-service";
import { ApiError, toErrorResponse } from "@/lib/api";

export function toScenarioErrorResponse(error: unknown): Response {
  if (error instanceof ScenarioServiceError) {
    return toErrorResponse(new ApiError(error.status, error.code, error.message));
  }
  if (error instanceof OptimisticLockError) {
    return toErrorResponse(
      new ApiError(409, error.code, "Состояние запуска уже изменилось. Обновите данные и повторите действие."),
    );
  }
  return toErrorResponse(error);
}

export function parseIfMatch(request: Request): number | undefined {
  const value = request.headers.get("if-match")?.replaceAll('"', "").trim();
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ApiError(400, "INVALID_IF_MATCH", "Заголовок If-Match должен содержать версию запуска");
  }
  return parsed;
}
