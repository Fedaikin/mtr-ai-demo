import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  projectUniversalAgentOutput,
  restorePublicUniversalResult,
} from "@/application/agent-orchestrator/universal-chat/public-projection";
import { UniversalAgentResult } from "@/components/universal-agent-result";

describe("universal chat public projection", () => {
  it("keeps business cards and removes private context, source copies and runtime internals", () => {
    const projected = projectUniversalAgentOutput(privateAnswer());
    const json = JSON.stringify(projected);

    expect(projected).toMatchObject({
      schemaVersion: "universal-agent-answer-public-v1",
      kind: "ANSWER",
      summary: "По проекту найден дефицит.",
      facts: [{ label: "Дефицит", value: 12, unit: "EA", statusLabel: "Критично" }],
      compatibility: [{
        technicalCompatibilityPercent: 92,
        quantityCoveragePercent: 75,
        verdictLabel: "Условно совместимо",
      }],
      recommendations: [{ kindLabel: "Дозаказ", quantity: 12 }],
      confidence: 0.86,
      requiresHumanReview: true,
    });
    expect(json).not.toMatch(/private-project-id|private-source-id|toolCalls|runtime|providerVersion|scoreBreakdown|engineVersion|resolvedContext|citations/u);
  });

  it("round-trips the public whitelist and renders localized accessible business sections", () => {
    const projected = projectUniversalAgentOutput(privateAnswer());
    const restored = restorePublicUniversalResult(projected);
    expect(restored).toEqual(projected);
    if (!restored) throw new Error("public result missing");

    const html = renderToStaticMarkup(<UniversalAgentResult result={restored} />);
    const text = html.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ");
    expect(html).toContain("data-testid=\"universal-agent-result\"");
    expect(text).toContain("Дефицит 12 EA");
    expect(text).toContain("Техническая совместимость: 92%");
    expect(text).toContain("покрытие количества: 75%");
    expect(text).toContain("Дозаказать материал");
    expect(text).not.toMatch(/CRITICAL|CONDITIONAL|REORDER|Evidence|toolCalls/u);
  });

  it("renders clarification candidates without internal entity ids", () => {
    const projected = projectUniversalAgentOutput({
      schemaVersion: "universal-agent-answer-v1",
      output: {
        kind: "ASK_CLARIFICATION",
        question: "Уточните проект.",
        candidates: [{
          kind: "BUSINESS_PROJECT",
          id: "private-project-id",
          code: "PRJ-001",
          name: "Проект Север",
          confidence: 0.9,
        }],
      },
    });
    expect(projected).toMatchObject({
      kind: "CLARIFICATION",
      candidates: [{ kindLabel: "Бизнес-проект", code: "PRJ-001", name: "Проект Север" }],
    });
    expect(JSON.stringify(projected)).not.toContain("private-project-id");
  });

  it("projects a stable structured NOT_FOUND status without leaking the private code", () => {
    const value = privateAnswer();
    value.output.missingData = [{
      code: "MATERIAL_NOT_FOUND",
      message: "Материал не найден.",
      impact: "Расчёт не выполнен.",
    }];
    const projected = projectUniversalAgentOutput(value);
    expect(projected).toMatchObject({
      kind: "ANSWER",
      limitations: [{ status: "NOT_FOUND", message: "Материал не найден." }],
    });
    expect(JSON.stringify(projected)).not.toContain("MATERIAL_NOT_FOUND");
    expect(restorePublicUniversalResult(projected)).toEqual(projected);
  });
});

function privateAnswer() {
  return {
    schemaVersion: "universal-agent-answer-v1",
    output: {
      summary: "По проекту найден дефицит.",
      resolvedContext: { businessProject: { id: "private-project-id", code: "PRJ-001", name: "Проект Север" } },
      facts: [{ key: "shortage", label: "Дефицит", value: 12, unit: "EA", status: "CRITICAL" }],
      tables: [{ id: "balance", title: "Баланс", columns: ["Материал", "Дефицит"], rows: [{ Материал: "MAT-001", Дефицит: 12 }], totalRows: 1 }],
      risks: [{ id: "risk-1", level: "HIGH", title: "Недостаток", explanation: "Не хватает 12 EA." }],
      compatibility: [{
        sourceMaterialCode: "MAT-001",
        candidateMaterialCode: "MAT-002",
        technicalCompatibilityPercent: 92,
        quantityCoveragePercent: 75,
        verdict: "CONDITIONAL",
        scoreBreakdown: [{ key: "diameter", label: "Диаметр", weight: 50, awarded: 50 }],
        deviations: ["Материал корпуса"],
        normativeBasis: "Правило v1",
        requiresHumanReview: true,
        engineVersion: "private-engine-v1",
      }],
      recommendations: [{ id: "rec-1", kind: "REORDER", title: "Дозаказать материал", explanation: "Закрыть дефицит.", quantity: 12, unit: "EA", residualRisk: "Срок поставки" }],
      actions: [{ id: "action-1", kind: "PURCHASE_REQUEST_DRAFT", title: "Подготовить черновик", enabled: true, requiresConfirmation: true }],
      citations: [{ sourceSystem: "SAP", entityId: "private-source-id", versionOrSnapshot: "snapshot-1", label: "SAP", observedAt: "2026-08-13T09:00:00.000Z" }],
      missingData: [{ code: "LEAD_TIME", message: "Не подтверждён срок поставки.", impact: "Нужна проверка." }],
      confidence: 0.86,
      requiresHumanReview: true,
      generatedAt: "2026-08-13T09:15:00.000Z",
      mode: "PRIMARY_LLM",
      runtime: { provider: "OPENAI", model: "private-model", providerVersion: "private-provider", promptVersion: "4.1.0" },
      toolCalls: [{ name: "project.listMaterials" }],
    },
  };
}
