import { createSapMockAdapter, SapMockError } from "@/adapters/mock/sap-adapter";
import { ApiError, ok, toErrorResponse } from "@/lib/api";
import { requireDemoRole } from "@/lib/session";

export async function POST() {
  try {
    const [adapter, session] = await Promise.all([createSapMockAdapter(), requireDemoRole("ADMIN")]);
    const result = await adapter.reset(session.user.id);
    return ok({ reset: true, ...result, isSyntheticDemo: true });
  } catch (error) {
    return toErrorResponse(toSapApiError(error));
  }
}

function toSapApiError(error: unknown): unknown {
  return error instanceof SapMockError
    ? new ApiError(error.status, error.code, error.safeMessage, error.details)
    : error;
}
