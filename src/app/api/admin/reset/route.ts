import { z } from "zod";

import { EXPECTED_BASE_COUNTS, initializeDatabase } from "@/adapters/persistence/bootstrap";
import { getRepository } from "@/adapters/persistence/repository";
import { ApiError, ok, parseJson, toErrorResponse } from "@/lib/api";
import { requireDemoRole } from "@/lib/session";

export const runtime = "nodejs";

const resetSchema = z
  .object({ confirmation: z.literal("RESET_DEMO_DATA") })
  .strict();

export async function POST(request: Request) {
  try {
    assertDemoMode();
    const [session, repository] = await Promise.all([
      requireDemoRole("ADMIN"),
      initializeDatabase().then(() => getRepository()),
      parseJson(request).then((body) => resetSchema.parse(body)),
    ]);
    const counts = await repository.resetDemoData(session.user.id);
    if (
      counts.canonicalPositions !== EXPECTED_BASE_COUNTS.canonicalPositions ||
      counts.sapMaterials !== EXPECTED_BASE_COUNTS.sapMaterials ||
      counts.sapBalances !== EXPECTED_BASE_COUNTS.sapBalances
    ) {
      throw new ApiError(500, "RESET_COUNT_MISMATCH", "Контрольные количества после сброса не совпали.");
    }
    await repository.writeAudit(session.user.id, {
      action: "ADMIN_DEMO_DATA_RESET",
      entityType: "DEMO_DATASET",
      entityId: "BASE",
      outcome: "SUCCESS",
      details: {
        canonicalPositions: counts.canonicalPositions,
        sapMaterials: counts.sapMaterials,
        sapBalances: counts.sapBalances,
      },
    });
    return ok({ reset: true, counts, isSyntheticDemo: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

function assertDemoMode(): void {
  const localDefault = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  const appMode = process.env.APP_MODE ?? (localDefault ? "demo" : "");
  if (appMode !== "demo") {
    throw new ApiError(403, "RESET_DISABLED", "Сброс данных доступен только в демонстрационном режиме.");
  }
}
