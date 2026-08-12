import { z } from "zod";

import {
  getRepository,
  type IntegrationStateRecord,
} from "@/adapters/persistence/repository";
import type { IntegrationStatus, IntegrationSystem } from "@/domain/models";
import { ok, parseJson, toErrorResponse } from "@/lib/api";
import { requireDemoRole } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const integrationUpdateSchema = z
  .object({
    system: z.enum(["APPIUS", "SAP", "RAG", "LLM"]),
    state: z.enum([
      "AVAILABLE",
      "UNAVAILABLE",
      "SLOW",
      "ACCESS_DENIED",
      "STALE_VERSION",
      "STALE",
      "RATE_LIMITED",
      "MALFORMED_RESPONSE",
    ]),
    delayMs: z.number().int().min(0).max(10_000),
    snapshotAt: z.iso.datetime({ offset: true }).nullable().optional(),
    safeMessage: z.string().trim().max(240).nullable().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (!allowedStates(input.system).includes(input.state)) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "Состояние не поддерживается выбранной интеграцией.",
      });
    }
    if (input.system === "SAP" && input.state === "STALE" && !input.snapshotAt) {
      context.addIssue({
        code: "custom",
        path: ["snapshotAt"],
        message: "Для устаревшего снимка SAP укажите дату снимка.",
      });
    }
  });

export async function GET() {
  try {
    const [session, repository] = await Promise.all([
      requireDemoRole("ADMIN"),
      getRepository(),
    ]);
    const integrations = await repository.listIntegrationStates(session.user.id);
    return ok({ integrations: integrations.map(publicIntegration), isSyntheticDemo: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const [session, repository, input] = await Promise.all([
      requireDemoRole("ADMIN"),
      getRepository(),
      parseJson(request).then((body) => integrationUpdateSchema.parse(body)),
    ]);
    const integration = await repository.setIntegrationState(session.user.id, input.system, {
      state: input.state,
      delayMs: input.delayMs,
      snapshotAt: input.snapshotAt,
      safeMessage: input.safeMessage,
    });
    await repository.writeAudit(session.user.id, {
      action: "ADMIN_INTEGRATION_STATE_UPDATED",
      entityType: "INTEGRATION",
      entityId: input.system,
      outcome: "SUCCESS",
      details: { system: input.system, state: input.state, delayMs: input.delayMs },
    });
    return ok({ integration: publicIntegration(integration), isSyntheticDemo: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

function publicIntegration(state: IntegrationStateRecord) {
  return {
    system: state.system,
    state: state.state,
    delayMs: state.delayMs,
    snapshotAt: state.snapshotAt ?? null,
    lastSynchronizedAt: state.lastSynchronizedAt ?? null,
    safeMessage: state.safeMessage ?? null,
    version: state.version,
  };
}

function allowedStates(system: IntegrationSystem): IntegrationStatus[] {
  if (system === "APPIUS") {
    return ["AVAILABLE", "UNAVAILABLE", "SLOW", "ACCESS_DENIED", "STALE_VERSION"];
  }
  if (system === "SAP") {
    return ["AVAILABLE", "UNAVAILABLE", "SLOW", "STALE", "RATE_LIMITED", "MALFORMED_RESPONSE"];
  }
  return ["AVAILABLE", "UNAVAILABLE", "SLOW", "RATE_LIMITED", "MALFORMED_RESPONSE"];
}
