import { CatalogService } from "@/application/catalog-service";
import { ApiError, ok, toErrorResponse } from "@/lib/api";
import { requirePermission } from "@/lib/session";
import {
  CATALOGUE_CATEGORIES,
  type CatalogueCategory,
  type CatalogueItemKind,
} from "@/domain/catalogue";
import type { CatalogSearchQuery } from "@/ports";

const ITEM_KINDS = new Set<CatalogueItemKind>(["COMPONENT", "ASSEMBLY"]);

export async function GET(request: Request) {
  try {
    const [session, service] = await Promise.all([
      requirePermission("catalog.read"),
      CatalogService.create(),
    ]);
    const parameters = new URL(request.url).searchParams;
    const query: CatalogSearchQuery = {
      ...optionalText(parameters, "q", 240, "CATALOG_QUERY_TOO_LONG", "text"),
      ...optionalText(parameters, "code", 120, "CATALOG_CODE_FILTER_INVALID", "code"),
      ...optionalText(parameters, "name", 200, "CATALOG_NAME_FILTER_INVALID", "name"),
      ...optionalText(
        parameters,
        "manufacturer",
        120,
        "CATALOG_MANUFACTURER_FILTER_INVALID",
        "manufacturer",
      ),
      ...optionalToken(parameters, "category", "category"),
      ...optionalToken(parameters, "equipmentType", "equipmentType"),
      ...optionalItemKind(parameters),
      limit: integerParameter(parameters, "limit", 50, 1, 200),
      offset: integerParameter(parameters, "offset", 0, 0, 1_000_000),
    };
    const result = await service.search(session.user.id, query);
    const items = session.authorization.permissionKeys.has("stock.search") ? result.items : result.items.map((item) => ({ ...item, totalAvailableQuantity: undefined, latestSnapshotAt: undefined, balanceCount: undefined }));
    return ok(
      { ...result, items, source: "INDUSTRIAL_CATALOG", isSyntheticDemo: true },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

function optionalText(
  parameters: URLSearchParams,
  parameter: string,
  maximumLength: number,
  errorCode: string,
  property: "text" | "code" | "name" | "manufacturer",
): Partial<CatalogSearchQuery> {
  const value = parameters.get(parameter)?.trim();
  if (!value) return {};
  if (value.length > maximumLength) {
    throw new ApiError(
      400,
      errorCode,
      `Параметр ${parameter} не должен превышать ${maximumLength} символов.`,
    );
  }
  return { [property]: value };
}

function optionalToken(
  parameters: URLSearchParams,
  parameter: string,
  property: "category" | "equipmentType",
): Partial<CatalogSearchQuery> {
  const value = parameters.get(parameter)?.trim().toLocaleUpperCase("ru-RU");
  if (!value) return {};
  if (!/^[A-Z0-9][A-Z0-9_-]{0,79}$/u.test(value)) {
    throw new ApiError(
      400,
      "CATALOG_FILTER_INVALID",
      `Параметр ${parameter} содержит недопустимое значение.`,
    );
  }
  if (
    property === "category" &&
    !(CATALOGUE_CATEGORIES as readonly string[]).includes(value)
  ) {
    throw new ApiError(
      400,
      "CATALOG_CATEGORY_INVALID",
      `Параметр category должен иметь одно из значений: ${CATALOGUE_CATEGORIES.join(", ")}.`,
    );
  }
  return property === "category"
    ? { category: value as CatalogueCategory }
    : { equipmentType: value };
}

function optionalItemKind(parameters: URLSearchParams): Partial<CatalogSearchQuery> {
  const value = parameters.get("itemKind")?.trim().toLocaleUpperCase("ru-RU");
  if (!value) return {};
  if (!ITEM_KINDS.has(value as CatalogueItemKind)) {
    throw new ApiError(
      400,
      "CATALOG_ITEM_KIND_INVALID",
      "Параметр itemKind должен иметь значение COMPONENT или ASSEMBLY.",
    );
  }
  return { itemKind: value as CatalogueItemKind };
}

function integerParameter(
  parameters: URLSearchParams,
  parameter: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = parameters.get(parameter);
  if (value === null) return fallback;
  if (!/^\d+$/u.test(value)) {
    throw new ApiError(
      400,
      "CATALOG_PAGING_INVALID",
      `Параметр ${parameter} должен быть целым числом.`,
    );
  }
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum) {
    throw new ApiError(
      400,
      "CATALOG_PAGING_INVALID",
      `Параметр ${parameter} должен быть в диапазоне ${minimum}–${maximum}.`,
    );
  }
  return parsed;
}
