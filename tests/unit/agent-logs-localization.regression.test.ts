import { describe, expect, it } from "vitest";

import { AGENT_LOG_UI_LABELS, findRawUserEnums } from "@/lib/localization";

describe("ACC-AIUX-003: локализация журнала AI-агента", () => {
  it("не выводит технический enum и английскую подпись источников", () => {
    expect(AGENT_LOG_UI_LABELS).toEqual({
      errorTypePlaceholder: "Например: недоступность SAP",
      citations: "Источники",
    });
    expect(findRawUserEnums(Object.values(AGENT_LOG_UI_LABELS).join(" "))).toEqual([]);
  });
});
