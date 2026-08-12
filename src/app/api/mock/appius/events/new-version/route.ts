import { z } from "zod";

import { AppiusMockError, createAppiusMockAdapter } from "@/adapters/mock/appius-adapter";
import { ApiError, ok, parseJson, toErrorResponse } from "@/lib/api";
import { requireDemoRole } from "@/lib/session";

const eventSchema = z
  .object({
    eventId: z.string().trim().min(1).max(200).optional(),
    specificationId: z.string().min(1).max(120).optional(),
    previousVersionId: z.string().min(1).max(120).optional(),
    currentVersionId: z.string().min(1).max(120).optional(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const [adapter, session, input] = await Promise.all([
      createAppiusMockAdapter(),
      requireDemoRole("ADMIN"),
      parseJson(request).then((body) => eventSchema.parse(body)),
    ]);
    const event = await adapter.processNewVersionEvent(input, session.user.id);
    return ok({ event, isSyntheticDemo: true });
  } catch (error) {
    return toErrorResponse(toAppiusApiError(error));
  }
}

function toAppiusApiError(error: unknown): unknown {
  return error instanceof AppiusMockError
    ? new ApiError(error.status, error.code, error.safeMessage, error.details)
    : error;
}
