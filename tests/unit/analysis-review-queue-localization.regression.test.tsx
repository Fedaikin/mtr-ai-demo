import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnalysisReviewQueue } from "@/components/analysis-review-queue";

describe("локализация доказательств Даблчекера", () => {
  it("не выводит внутренние match-category значения и rule literals", () => {
    const html = renderToStaticMarkup(<AnalysisReviewQueue initialReviews={[{
      id: "review-1",
      positionId: "position-1",
      doublecheckOutcome: "CONFIRMED_FOR_HUMAN_REVIEW",
      status: "PENDING",
      agentEvidence: { positionCode: "APP-001", category: "EXACT" },
      independentEvidence: {
        rule: "Только EXACT + 100% + отсутствие флага проверки",
        categoryEqual: true,
      },
      decisionReason: null,
      decidedBy: null,
      decidedAt: null,
    }]} />);

    expect(html).toContain("Точное совпадение");
    expect(html).toContain("Только точная категория + 100% + отсутствие флага проверки");
    expect(html).not.toMatch(/\b(?:EXACT|PENDING)\b/u);
  });
});
