import { getRepository } from "@/adapters/persistence/repository";
import { ApiError, ok, parseJson, toErrorResponse } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { requirePermission } from "@/lib/session";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const [{ id }, { user }, body, repository] = await Promise.all([params, requirePermission("review.decide"), parseJson(request), getRepository()]);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "INVALID_REVIEW_BODY", "Некорректное тело запроса");
    const input = body as Record<string, unknown>;
    const decision = input.decision;
    if (decision !== "CONFIRMED" && decision !== "REJECTED" && decision !== "RETURNED") throw new ApiError(400, "INVALID_REVIEW_DECISION", "Неизвестное решение проверки");
    if (typeof input.reason !== "string") throw new ApiError(400, "REVIEW_REASON_REQUIRED", "Укажите причину решения");
    return ok({ review: await repository.decideAnalysisReview(user.id, id, decision, input.reason, user.displayName) });
  } catch (error) { return toErrorResponse(error); }
}
