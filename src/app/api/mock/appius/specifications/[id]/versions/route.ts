import { AppiusMockError, createAppiusMockAdapter } from "@/adapters/mock/appius-adapter";
import { ApiError, ok, toErrorResponse } from "@/lib/api";
import { getDemoSession } from "@/lib/session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const [{ id }, adapter, session] = await Promise.all([
      params,
      createAppiusMockAdapter(),
      getDemoSession(),
    ]);
    const versions = await adapter.listVersions(id, session.user.id);
    return ok({
      specificationId: id,
      versions,
      total: versions.length,
      currentVersionId: versions.find((version) => version.isCurrent)?.id ?? null,
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
