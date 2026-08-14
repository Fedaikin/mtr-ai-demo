import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

import { PostgresAgentCaseStore } from "@/adapters/persistence/agent-case-store";
import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { getRepository } from "@/adapters/persistence/repository";
import type { TrustedRequestContext } from "@/application/authorization-service";
import { AgentCaseService } from "@/application/agent-orchestrator/case-service";
import type { AgentAnalysisHistoryInput } from "@/domain/agent/case";
import { DEMO_USER_ID } from "@/domain/models";

vi.mock("server-only", () => ({}));

describe.sequential("reauthorized analytical history", () => {
  beforeAll(async () => resetDemoDatabase(DEMO_USER_ID));
  afterAll(async () => closeDatabase());

  it("сохраняет версии расчёта, сравнивает вывод и скрывает отозванные источники", async () => {
    const repository = await getRepository();
    const first = await runHistory(repository, "history-run-1", "2026-08-13T10:00:00.000Z", {
      ...history("Остаточный дефицит 12 EA."),
      recommendation: "Передать вариант специалисту.",
    });
    const second = await runHistory(repository, "history-run-2", "2026-08-13T11:00:00.000Z", {
      ...history("Потребность закрыта подтверждёнными аналогами."),
      recommendation: "Проверить вариант и подтвердить решение.",
    });
    const service = new AgentCaseService(new PostgresAgentCaseStore(await getDatabase()));
    const visible = await service.get(second.caseId, context());
    const revoked = await service.get(second.caseId, context({
      permissions: ["agent.chat", "project.read", "specification.read", "analysis.read"],
      catalogScopeIds: [],
      sourceScopeIds: ["demo-normative-001"],
    }));

    expect(first.caseId).not.toBe(second.caseId);
    expect(visible?.contextSnapshot.analysisHistory).toMatchObject({
      schemaVersion: "mtr-agent-analysis-history-v1",
      previousCaseId: first.caseId,
      changedConclusion: true,
      datasetVersion: "1.0.0-DEMO",
      semanticRegistryVersion: "semantic-registry-1.0.0",
      forecastModelVersion: "linear-trend-v1",
      sourceCount: 4,
    });
    expect(visible?.evidence).toHaveLength(4);
    expect(revoked?.evidence.map((item) => item.sourceSystem).sort()).toEqual(["APPIUS", "NORMATIVE"]);
    expect(revoked?.revokedEvidenceCount).toBe(2);
    expect(JSON.stringify(visible)).not.toContain("conclusionFingerprint");
  });
});

async function runHistory(
  repository: Awaited<ReturnType<typeof getRepository>>,
  correlationId: string,
  occurredAt: string,
  analysisHistory: AgentAnalysisHistoryInput,
) {
  const plan = await repository.startAgentCommandPlan(DEMO_USER_ID, {
    projectId: "demo-project-001",
    commandKey: "ANALYSIS",
    correlationId,
    selection: { projectId: "demo-project-001", positionId: "position-portfolio-072-003" },
    actorDisplayName: "Демо-пользователь",
    authorizationVersion: 1,
    roleAssignmentSnapshot: ["assign-demo-manager"],
    occurredAt,
  });
  await repository.finishAgentCommandPlan(DEMO_USER_ID, {
    ...plan,
    projectId: "demo-project-001",
    correlationId,
    status: "SUCCEEDED",
    occurredAt,
    actorDisplayName: "Демо-пользователь",
    analysisHistory,
  });
  return plan;
}

function history(summary: string): AgentAnalysisHistoryInput {
  return {
    summary,
    confidence: 0.9,
    requiresHumanReview: true,
    generatedAt: "2026-08-13T10:00:00.000Z",
    datasetVersion: "1.0.0-DEMO",
    semanticRegistryVersion: "semantic-registry-1.0.0",
    forecastModelVersion: "linear-trend-v1",
    recommendation: null,
    citations: [
      citation("APPIUS", "position-portfolio-072-003", "appius-v1"),
      citation("SAP", "SAP-G1-001", "sap-v1"),
      citation("CATALOG", "CAT-G1-001", "catalog-v1"),
      citation("NORMATIVE", "doc-g1-responsibility", "normative-v1", "clause-1"),
    ],
  };
}

function citation(
  sourceSystem: AgentAnalysisHistoryInput["citations"][number]["sourceSystem"],
  entityId: string,
  versionOrSnapshot: string,
  clauseId: string | null = null,
) {
  return {
    sourceSystem,
    entityId,
    versionOrSnapshot,
    observedAt: "2026-08-13T09:00:00.000Z",
    clauseId,
  };
}

function context(
  patch: {
    readonly permissions?: readonly (TrustedRequestContext["permissionKeys"] extends ReadonlySet<infer T> ? T : never)[];
    readonly catalogScopeIds?: readonly string[];
    readonly sourceScopeIds?: readonly string[];
  } = {},
): TrustedRequestContext {
  return {
    subjectId: DEMO_USER_ID,
    displayName: "Демо-пользователь",
    activeRoleAssignmentIds: ["assign-demo-manager"],
    globalRoleKeys: [],
    activeProjectId: "demo-project-001",
    projectRoleKeys: ["PROJECT_MANAGER"],
    permissionKeys: new Set(patch.permissions ?? [
      "agent.chat",
      "project.read",
      "specification.read",
      "stock.search",
      "catalog.read",
      "analysis.read",
    ]),
    catalogScopeIds: patch.catalogScopeIds ?? ["demo-catalog-001"],
    sourceScopeIds: patch.sourceScopeIds ?? ["demo-sap-001", "demo-normative-001"],
    accessClaims: { warehouseIds: ["WH-G1-01"] },
    authorizationVersion: 1,
    requestId: "request-analysis-history",
  };
}
