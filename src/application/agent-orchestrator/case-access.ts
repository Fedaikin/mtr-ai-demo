import "server-only";

import type { MtrRepository } from "@/adapters/persistence/repository";
import {
  can,
  type TrustedRequestContext,
} from "@/application/authorization-service";
import type { ScenarioRun } from "@/domain/models";

export type AuthorizedScenarioCase = ScenarioRun & Readonly<{ projectId: string }>;

/**
 * Loads a case source only inside the current server-derived project. Returning
 * null for both missing and denied resources avoids an existence side channel.
 */
export async function loadAuthorizedScenarioCase(
  repository: MtrRepository,
  context: TrustedRequestContext,
  runId: string,
): Promise<AuthorizedScenarioCase | null> {
  if (!context.activeProjectId || !context.permissionKeys.has("analysis.read")) return null;
  const run = await repository.getScenarioRunInProject(
    context.subjectId,
    context.activeProjectId,
    runId,
  );
  if (!run) return null;
  return can(context, "analysis.read", {
    resourceType: "SCENARIO_RUN",
    resourceId: run.id,
    projectId: context.activeProjectId,
    ownerUserId: run.userId,
    status: run.status,
  })
    ? { ...run, projectId: context.activeProjectId }
    : null;
}
