import { AppiusMockError, createAppiusMockAdapter } from "@/adapters/mock/appius-adapter";
import { ApiError, ok, toErrorResponse } from "@/lib/api";
import { getDemoSession } from "@/lib/session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const [{ id }, adapter, session] = await Promise.all([
      params,
      createAppiusMockAdapter(),
      getDemoSession(),
    ]);
    const search = new URL(request.url).searchParams;
    const history = search.get("history") === "1" || search.get("history") === "true";
    const requestedVersionId = search.get("version")?.trim();
    if (requestedVersionId && requestedVersionId.length > 120) {
      throw new ApiError(400, "APPIUS_VERSION_INVALID", "Идентификатор версии слишком длинный.");
    }
    const versionId =
      requestedVersionId || (await adapter.getLatestVersion(id, session.user.id)).id;
    const positions = await adapter.getPositions(id, versionId, session.user.id, { history });
    return ok({
      specificationId: id,
      versionId,
      history,
      positions,
      total: positions.length,
      source: "APPIUS_MOCK",
      isSyntheticDemo: true,
    });
  } catch (error) {
    return toErrorResponse(toAppiusApiError(error));
  }
}

function toAppiusApiError(error: unknown): unknown {
  return error instanceof AppiusMockError
    ? new ApiError(error.status, error.code, error.safeMessage, error.details)
    : error;
}
