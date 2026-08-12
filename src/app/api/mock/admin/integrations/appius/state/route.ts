import { z } from "zod";

import { AppiusMockError, createAppiusMockAdapter } from "@/adapters/mock/appius-adapter";
import { ApiError, ok, parseJson, toErrorResponse } from "@/lib/api";
import { requireDemoRole } from "@/lib/session";

const stateSchema = z
  .object({
    state: z.enum(["AVAILABLE", "UNAVAILABLE", "SLOW", "ACCESS_DENIED", "STALE_VERSION"]),
    delayMs: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

export async function GET() {
  try {
    const [adapter, session] = await Promise.all([createAppiusMockAdapter(), requireDemoRole("ADMIN")]);
    return ok({ state: await adapter.getState(session.user.id), isSyntheticDemo: true });
  } catch (error) {
    return toErrorResponse(toAppiusApiError(error));
  }
}

export async function POST(request: Request) {
  try {
    const [adapter, session, input] = await Promise.all([
      createAppiusMockAdapter(),
      requireDemoRole("ADMIN"),
      parseJson(request).then((body) => stateSchema.parse(body)),
    ]);
    return ok({ state: await adapter.setState(input, session.user.id), isSyntheticDemo: true });
  } catch (error) {
    return toErrorResponse(toAppiusApiError(error));
  }
}

function toAppiusApiError(error: unknown): unknown {
  return error instanceof AppiusMockError
    ? new ApiError(error.status, error.code, error.safeMessage, error.details)
    : error;
}
