import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createModelAnalyticalReadPort } from "@/adapters/mock/agent-analytical-read-port";
import { generateAgentAnalyticalDataset } from "@/adapters/mock/fixtures/agent-analytical-dataset";
import type { TrustedRequestContext } from "@/application/authorization-service";
import { createAgentCommandRegistry } from "@/application/agent-orchestrator/command-registry";
import { projectAgentCommandResult } from "@/application/agent-orchestrator/public-projection";
import { AgentCommandResult } from "@/components/agent-command-result";
import { createAgentExecutionContext } from "@/domain/agent/context";
import type { AgentOrchestratorPorts } from "@/ports/agent-orchestrator";

describe("analytical command through the unified runtime", () => {
  it("executes with canonical context and renders verified analytics without technical leakage", async () => {
    const dataset = generateAgentAnalyticalDataset();
    const position = dataset.positions.find((item) =>
      dataset.shortages.some((shortage) => shortage.positionId === item.positionId),
    )!;
    const context = createAgentExecutionContext(trusted(), {
      selection: {
        projectId: "demo-project-001",
        specificationId: position.specificationId,
        positionId: position.positionId,
      },
      correlationId: "analytical-command-1",
    });
    const registry = createAgentCommandRegistry(ports());
    const output = await registry.execute(context, {
      commandKey: "ANALYSIS",
      context: context.selection,
      filters: { horizonWeeks: 6, demandMultiplier: 1.2, deliveryDelayDays: 5 },
    });
    const publicResult = projectAgentCommandResult(output, "analytical-command-1");
    const html = renderToStaticMarkup(<AgentCommandResult result={publicResult} />);
    const text = html.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ");

    expect(output.responseType).toBe("ANALYSIS");
    expect(publicResult.analysis).toMatchObject({
      executiveSummary: expect.stringContaining("дефицит"),
      forecast: { horizonWeeks: 6 },
      recommendation: expect.stringContaining("специалисту"),
    });
    expect(html).toContain('aria-label="Доказательная аналитика"');
    expect(text).toContain("Подтверждённые факты");
    expect(text).toContain("Главные факторы");
    expect(text).toContain("Прогноз и backtest");
    expect(text).toContain("Сравнение вариантов");
    expect(text).toContain("Требуется проверка специалиста");
    expect(text).not.toMatch(/SUPPORTED|CAUSAL|COMPOSITE_SUBSTITUTE|toolCalls|chain.of.thought|raw JSON/iu);
    expect(JSON.stringify(publicResult)).not.toMatch(/technicalTrace|evidenceNodeIds|inputEvidenceNodeIds/iu);
  });

  it("rejects the command before retrieval when analytical permissions are incomplete", async () => {
    const dataset = generateAgentAnalyticalDataset();
    const context = createAgentExecutionContext(
      trusted({ permissionKeys: new Set(["agent.chat", "analysis.read"]) }),
      {
        selection: {
          projectId: "demo-project-001",
          positionId: dataset.positions[0].positionId,
        },
      },
    );

    await expect(
      createAgentCommandRegistry(ports()).execute(context, {
        commandKey: "ANALYSIS",
        context: context.selection,
      }),
    ).rejects.toMatchObject({ code: "AGENT_COMMAND_FORBIDDEN" });
  });
});

function ports(): AgentOrchestratorPorts {
  const unavailable = async () => ({
    items: [],
    evidence: {
      availability: "UNAVAILABLE" as const,
      confidence: 0,
      coverage: { requestedScope: [], checkedScope: [], complete: false },
      citations: [],
      missingData: [],
    },
  });
  return {
    summary: { read: async () => ({ facts: [], evidence: (await unavailable()).evidence }) },
    tasks: { listMine: unavailable },
    risks: { evaluate: unavailable },
    stocks: { search: unavailable },
    metrics: { calculate: async () => ({ metrics: [], evidence: (await unavailable()).evidence }) },
    analytics: createModelAnalyticalReadPort(),
  };
}

function trusted(patch: Partial<TrustedRequestContext> = {}): TrustedRequestContext {
  return {
    subjectId: "demo-user-001",
    displayName: "Аналитик",
    activeRoleAssignmentIds: ["assign-demo-manager"],
    globalRoleKeys: [],
    activeProjectId: "demo-project-001",
    projectRoleKeys: ["PROJECT_MANAGER"],
    permissionKeys: new Set([
      "agent.chat",
      "analysis.read",
      "specification.read",
      "catalog.read",
      "stock.search",
    ]),
    catalogScopeIds: ["demo-catalog-001"],
    sourceScopeIds: ["demo-appius-001", "demo-sap-001", "demo-normative-001"],
    accessClaims: { warehouseIds: ["WH-NORTH", "WH-SOUTH", "WH-EAST", "WH-WEST"] },
    authorizationVersion: 1,
    requestId: "request-analysis-1",
    ...patch,
  };
}
