import { createSapMockAdapter, SapMockError } from "@/adapters/mock/sap-adapter";
import { ApiError, ok, toErrorResponse } from "@/lib/api";
import { getDemoSession } from "@/lib/session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ materialCode: string }> },
) {
  try {
    const [{ materialCode }, adapter, session] = await Promise.all([
      params,
      createSapMockAdapter(),
      getDemoSession(),
    ]);
    if (!/^[A-Z0-9-]{1,120}$/iu.test(materialCode)) {
      throw new ApiError(400, "SAP_MATERIAL_CODE_INVALID", "Некорректный код материала SAP.");
    }
    const [materials, integrationState] = await Promise.all([
      adapter.getMaterialStock(materialCode, session.user.id),
      adapter.getState(session.user.id),
    ]);
    if (materials.length === 0) {
      throw new ApiError(
        404,
        "SAP_MATERIAL_NOT_FOUND",
        "Материал SAP не найден или недоступен текущему пользователю.",
      );
    }
    return ok({
      materialCode,
      materials,
      total: materials.length,
      integrationState,
      source: "SAP_MOCK",
      isSyntheticDemo: true,
    });
  } catch (error) {
    return toErrorResponse(toSapApiError(error));
  }
}

function toSapApiError(error: unknown): unknown {
  return error instanceof SapMockError
    ? new ApiError(error.status, error.code, error.safeMessage, error.details)
    : error;
}
