import { renderToStaticMarkup } from "react-dom/server";

import { toPublicAgentCommandResult } from "@/application/agent-orchestrator/public-projection";
import { AgentCommandResult } from "@/components/agent-command-result";

describe("D-09: пользовательский результат команды МТР-агента", () => {
  it("показывает русские статусы и семантически доступную карточку источника", () => {
    const html = renderToStaticMarkup(
      <AgentCommandResult
        result={toPublicAgentCommandResult({
          messageId: "message-1",
          responseType: "RISK_LIST",
          status: "PARTIAL",
          answer: "Найдены два риска по выбранному проекту.",
          riskLevel: "HIGH",
          confidence: 0.82,
          requiresHumanReview: true,
          sources: [
            {
              sourceSystem: "SAP",
              entityId: "SAP-DEMO-0001",
              versionOrSnapshot: "snapshot-2026-08-13",
              freshness: "FRESH",
              availability: "AVAILABLE",
              href: "/materials/SAP-DEMO-0001",
              accessible: true,
            },
          ],
        })}
      />,
    );
    const text = visibleText(html);

    expect(text).toContain("Список рисков");
    expect(text).toContain("Доступен частичный результат");
    expect(text).toContain("Высокий риск");
    expect(text).toContain("Источники");
    expect(text).toContain("SAP S/4HANA");
    expect(text).toContain("Актуальные данные");
    expect(text).toContain("Доступно");
    expect(text).toContain("Требуется проверка специалиста");
    expect(html).toMatch(/<section[^>]+aria-labelledby="agent-command-result-message-1-title"/u);
    expect(html).toContain('aria-live="polite"');
    expect(html).toMatch(/<article[^>]+aria-label="Источник: SAP S\/4HANA"/u);
    expect(html).toMatch(/<a[^>]+aria-label="Открыть источник: SAP S\/4HANA"[^>]+href="\/materials\/SAP-DEMO-0001"/u);
    expect(text).not.toMatch(/RISK_LIST|PARTIAL|HIGH|FRESH|AVAILABLE|Evidence/u);
    expect(html).not.toMatch(/toolCalls|raw JSON|sap\.getMaterialStock/u);
  });

  it("не делает карточку ссылкой после отзыва доступа и не показывает закрытые метаданные", () => {
    const html = renderToStaticMarkup(
      <AgentCommandResult
        result={toPublicAgentCommandResult({
          messageId: "message-2",
          responseType: "FUTURE_RESPONSE",
          status: "INTERNAL_STATE",
          answer: "Повторно проверьте доступ к источнику.",
          riskLevel: "EXTREME",
          sources: [
            {
              sourceSystem: "PRIVATE_CONNECTOR",
              entityId: "CLOSED-42",
              versionOrSnapshot: "closed-version",
              href: "/closed/42",
              accessible: false,
            },
          ],
        })}
      />,
    );
    const text = visibleText(html);

    expect(text).toContain("Результат МТР-агента");
    expect(text).toContain("Статус не определён");
    expect(text).toContain("Уровень риска не определён");
    expect(text).toContain("Источник больше недоступен");
    expect(text).toContain("Доступ запрещён");
    expect(html).not.toMatch(/<a(?:\s|>)/u);
    expect(text).not.toMatch(/FUTURE_RESPONSE|INTERNAL_STATE|EXTREME|PRIVATE_CONNECTOR|CLOSED-42|closed-version/u);
  });
});

function visibleText(html: string): string {
  return html.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ");
}
