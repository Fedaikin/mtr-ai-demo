import { createSapMockAdapter, SapMockError } from "@/adapters/mock/sap-adapter";
import { ApiError, ok, toErrorResponse } from "@/lib/api";
import { getDemoSession } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const [adapter, session] = await Promise.all([createSapMockAdapter(), getDemoSession()]);
    const url = new URL(request.url);
    const filter = url.searchParams.get("$filter")?.trim();
    if (filter && filter.length > 500) {
      throw new ApiError(400, "SAP_ODATA_FILTER_TOO_LONG", "Фильтр SAP OData слишком длинный.");
    }
    const top = parseInteger(url.searchParams.get("$top"), "$top", 20, 1, 100);
    const skip = parseInteger(url.searchParams.get("$skip"), "$skip", 0, 0, 10_000);
    const selectValue = url.searchParams.get("$select");
    const select = selectValue?.split(",").map((field) => field.trim()).filter(Boolean);
    const result = await adapter.searchOData({ filter, top, skip, select }, session.user.id);
    const { nextSkip, ...odata } = result.d;
    const nextUrl = nextSkip === undefined ? undefined : new URL(url);
    if (nextUrl) nextUrl.searchParams.set("$skip", String(nextSkip));

    return ok({
      d: {
        ...odata,
        ...(nextUrl ? { __next: `${nextUrl.pathname}${nextUrl.search}` } : {}),
      },
    });
  } catch (error) {
    return toErrorResponse(toSapApiError(error));
  }
}

function parseInteger(
  value: string | null,
  parameter: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === null) return fallback;
  if (!/^\d+$/u.test(value)) {
    throw new ApiError(400, "SAP_ODATA_PAGING_INVALID", `Параметр ${parameter} должен быть целым числом.`);
  }
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum) {
    throw new ApiError(
      400,
      "SAP_ODATA_PAGING_INVALID",
      `Параметр ${parameter} должен быть в диапазоне ${minimum}–${maximum}.`,
    );
  }
  return parsed;
}

function toSapApiError(error: unknown): unknown {
  return error instanceof SapMockError
    ? new ApiError(error.status, error.code, error.safeMessage, error.details)
    : error;
}
