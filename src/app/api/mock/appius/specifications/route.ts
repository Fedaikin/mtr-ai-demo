import { AppiusMockError, createAppiusMockAdapter } from "@/adapters/mock/appius-adapter";
import { ApiError, ok, toErrorResponse } from "@/lib/api";
import { getDemoSession } from "@/lib/session";

export async function GET() {
  try {
    const [adapter, session] = await Promise.all([createAppiusMockAdapter(), getDemoSession()]);
    const [specifications, integrationState] = await Promise.all([
      adapter.listSpecifications(session.user.id),
      adapter.getState(session.user.id),
    ]);
    return ok({
      specifications,
      total: specifications.length,
      integrationState,
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
