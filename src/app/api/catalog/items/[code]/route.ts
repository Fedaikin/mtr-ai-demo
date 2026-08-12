import { CatalogService, CatalogServiceError } from "@/application/catalog-service";
import { ApiError, ok, toErrorResponse } from "@/lib/api";
import { requireDemoRole } from "@/lib/session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const [{ code }, { user }, service] = await Promise.all([
      params,
      requireDemoRole("USER"),
      CatalogService.create(),
    ]);
    const normalizedCode = code.trim().toLocaleUpperCase("ru-RU");
    if (!/^[A-Z0-9][A-Z0-9._-]{0,119}$/u.test(normalizedCode)) {
      throw new ApiError(
        400,
        "CATALOG_ITEM_CODE_INVALID",
        "Некорректный код позиции промышленного каталога.",
      );
    }
    const detail = await service.getItemDetail(user.id, normalizedCode);
    return ok(
      { ...detail, source: "INDUSTRIAL_CATALOG", isSyntheticDemo: true },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof CatalogServiceError) {
      return toErrorResponse(new ApiError(error.status, error.code, error.message));
    }
    return toErrorResponse(error);
  }
}
