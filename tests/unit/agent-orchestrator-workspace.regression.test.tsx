import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/agent-chat", () => ({
  AgentChat: ({ context }: { context: Record<string, unknown> }) => (
    <div data-testid="shared-agent-chat">{JSON.stringify(context)}</div>
  ),
}));

import { AgentOrchestratorWorkspace } from "@/components/agent-orchestrator-workspace";

describe("рабочее пространство единого МТР-агента", () => {
  it("показывает полный context bar и не создаёт отдельный legacy-портал", () => {
    const html = renderToStaticMarkup(
      <AgentOrchestratorWorkspace
        displayName="Аналитик"
        project={{ id: "project-1", label: "Проект МТР" }}
        specifications={[{ id: "spec-1", label: "Спецификация 1" }]}
        positions={[{ id: "position-1", specificationId: "spec-1", label: "P-001 · Труба" }]}
        runs={[{ id: "run-1", label: "Завершено · 13 авг." }]}
        initialContext={{ projectId: "project-1", specificationId: "spec-1", runId: "run-1" }}
        initialThreads={[]}
        initialPeriod={{ from: "2026-08-06T00:00:00.000Z", to: "2026-08-13T23:59:59.999Z" }}
      />,
    );

    expect(html).toContain("Рабочее пространство МТР-агента");
    expect(html).toContain("Единый оркестратор");
    expect(html).toContain("Синтетический демо-контур");
    expect(html).toContain('aria-label="Проект МТР-агента"');
    expect(html).toContain('aria-label="Спецификация МТР-агента"');
    expect(html).toContain('aria-label="Позиция МТР-агента"');
    expect(html).toContain('aria-label="Запуск МТР-агента"');
    expect(html).toContain('aria-label="Начало периода МТР-агента"');
    expect(html).toContain('aria-label="Конец периода МТР-агента"');
    expect(html).toContain('data-testid="shared-agent-chat"');
    expect(html).toContain("Кейсы · 0");
    expect(html).toContain("Действия · 0");
    expect(html).not.toContain("/agent");
  });
});
