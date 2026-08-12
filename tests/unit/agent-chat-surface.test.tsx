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
  });
});
