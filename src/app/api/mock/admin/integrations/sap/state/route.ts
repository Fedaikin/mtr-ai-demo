import { z } from "zod";

import { createSapMockAdapter, SapMockError } from "@/adapters/mock/sap-adapter";
import { ApiError, ok, parseJson, toErrorResponse } from "@/lib/api";
import { requireDemoRole } from "@/lib/session";

const stateSchema = z
  .object({
    state: z.enum([
      "AVAILABLE",
      "UNAVAILABLE",
      "SLOW",
      "STALE",
      "RATE_LIMITED",
      "MALFORMED_RESPONSE",
    ]),
    delayMs: z.number().int().min(0).max(10_000).optional(),
    snapshotAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state === "STALE" && !value.snapshotAt) {
      context.addIssue({
        code: "custom",
        path: ["snapshotAt"],
        message: "Для состояния STALE укажите snapshotAt.",
      });
    }
  });

export async function GET() {
  try {
    const [adapter, session] = await Promise.all([createSapMockAdapter(), requireDemoRole("ADMIN")]);
    return ok({ state: await adapter.getState(session.user.id), isSyntheticDemo: true });
  } catch (error) {
    return toErrorResponse(toSapApiError(error));
  }
}

export async function POST(request: Request) {
  try {
    const [adapter, session, input] = await Promise.all([
      createSapMockAdapter(),
      requireDemoRole("ADMIN"),
      parseJson(request).then((body) => stateSchema.parse(body)),
    ]);
    return ok({ state: await adapter.setState(input, session.user.id), isSyntheticDemo: true });
  } catch (error) {
    return toErrorResponse(toSapApiError(error));
  }
}

function toSapApiError(error: unknown): unknown {
  return error instanceof SapMockError
    ? new ApiError(error.status, error.code, error.safeMessage, error.details)
    : error;
}
