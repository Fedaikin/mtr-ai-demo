import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AgentChat } from "@/components/agent-chat";

describe("user agent chat surface", () => {
  it("renders only answer, citations, confidence and expert-review decision", () => {
    const html = renderToStaticMarkup(
      <AgentChat
        displayName="Демо-пользователь 1"
        initialThreads={[
          {
            id: "thread-1",
            title: "Остаток материала",
            createdAt: "2026-08-12T10:00:00.000Z",
            updatedAt: "2026-08-12T10:00:00.000Z",
            version: 1,
          },
        ]}
        initialThreadId="thread-1"
        initialMessages={[
          {
            id: "message-1",
            threadId: "thread-1",
            role: "assistant",
            content: "На складе доступно 12 шт.",
            structuredOutput: {
              confidence: 0.9,
              requiresHumanReview: true,
              toolCalls: [{ tool: "sap.getMaterialStock", outcome: "OK", durationMs: 5 }],
              raw: { operationId: "internal-operation-id" },
            },
            createdAt: "2026-08-12T10:00:00.000Z",
            citations: [
              {
                sourceSystem: "SAP",
                entityId: "SAP-DEMO-0001",
                versionOrSnapshot: "2026-08-12",
                clauseId: null,
              },
            ],
          },
        ]}
      />,
    );

    expect(html).toContain("На складе доступно 12 шт.");
    expect(html).toContain("Уверенность 90%");
    expect(html).toContain("Нужна проверка специалиста");
    expect(html).toContain("Источники");
    expect(html).not.toContain("sap.getMaterialStock");
    expect(html).not.toContain("internal-operation-id");
    expect(html).not.toContain("Технический результат");
    expect(html).not.toContain("Вызовы инструментов");
    expect(html).toContain("Прикрепить");
    expect(html).toContain("agent-attachment-input");
  });

  it("renders a saved analytical command as the same rich public card", () => {
    const html = renderToStaticMarkup(
      <AgentChat
        displayName="Демо-пользователь 1"
        initialThreads={[]}
        initialThreadId="thread-analysis"
        initialMessages={[{
          id: "message-analysis",
          threadId: "thread-analysis",
          role: "assistant",
          content: "Остаточный дефицит 12 EA.",
          structuredOutput: {
            schemaVersion: "mtr-agent-command-public-v1",
            messageId: "analysis-1",
            responseLabel: "Анализ позиции",
            statusLabel: "Доступен частичный результат",
            answer: "Остаточный дефицит 12 EA.",
            riskLabel: null,
            confidence: 0.9,
            requiresHumanReview: true,
            technicalContentRemoved: false,
            generatedAt: "2026-08-13T10:00:00.000Z",
            sources: [],
            analysis: {
              executiveSummary: "Остаточный дефицит 12 EA.",
              facts: ["Потребность: 20 EA."],
              findings: ["Доступно: 8 EA."],
              drivers: [],
              forecast: null,
              scenarios: [{
                kind: "Проект закупки",
                score: 85,
                feasible: true,
                coveredQuantity: 20,
                remainingShortage: 0,
              }],
              recommendation: "Передать вариант специалисту.",
              limitations: ["Синтетический набор."],
              nextActions: ["Обновить расчёт."],
            },
          },
          createdAt: "2026-08-13T10:00:00.000Z",
          citations: [],
        }]}
      />,
    );
    const text = html.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ");

    expect(text).toContain("Подтверждённые факты");
    expect(text).toContain("Сравнение вариантов");
    expect(text).toContain("Проект закупки");
    expect(text).toContain("Передать вариант специалисту");
  });

  it("renders attachment validation preview and a safe published link", () => {
    const html = renderToStaticMarkup(
      <AgentChat
        displayName="Пользователь"
        initialThreads={[]}
        initialThreadId="thread-import"
        initialMessages={[{
          id: "message-import",
          threadId: "thread-import",
          role: "assistant",
          content: "Опубликована новая версия.",
          structuredOutput: {
            schemaVersion: "agent-attachment-import-v1",
            attachmentImport: {
              status: "PUBLISHED",
              fileName: "specification.xlsx",
              totalRows: 2,
              validRows: 2,
              invalidRows: 0,
              warnings: [],
              errors: [],
              previewRows: [{ code: "SAFE-001", name: "Труба", quantity: 2, unit: "EA" }],
              targetLabel: "новая версия «Спецификация»",
              published: { href: "/specifications/spec-1", versionNumber: 2, positionCount: 2 },
            },
          },
          createdAt: "2026-08-13T10:00:00.000Z",
          citations: [],
        }]}
      />,
    );

    expect(html).toContain("specification.xlsx");
    expect(html).toContain("SAFE-001");
    expect(html).toContain("Открыть версию 2");
    expect(html).toContain("href=\"/specifications/spec-1\"");
  });
});
