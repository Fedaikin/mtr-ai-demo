import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InfoHint } from "@/components/info-hint";
import { CONTEXT_HELP, getContextHelp } from "@/lib/context-help";

describe("presentation-only contextual explanations", () => {
  it("covers every navigation entry and never invents a missing explanation", () => {
    const source = readFileSync("src/components/app-shell.tsx", "utf8");
    const routes = [...source.matchAll(/href: "([^"]+)"/g)].map((match) => match[1]);
    expect(routes.length).toBeGreaterThan(10);
    for (const route of routes) expect(getContextHelp(route), route).toBeTruthy();
    expect(getContextHelp("unknown")).toBeUndefined();
    expect(getContextHelp("toString")).toBeUndefined();
  });
  it("uses a small labelled non-submit trigger and no automatic data requests", () => {
    const html = renderToStaticMarkup(<InfoHint title="Общий остаток" />);
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Пояснение: Общий остаток"');
    expect(html).toContain("h-[18px]");
    expect(renderToStaticMarkup(<InfoHint title="unknown" />)).toBe("");
    const source = readFileSync("src/components/info-hint.tsx", "utf8");
    expect(source).not.toMatch(/fetch\(|localStorage|sessionStorage|router\.|setInterval|useEffect/);
  });
  it("keeps source, forecast and human-approval boundaries explicit", () => {
    expect(CONTEXT_HELP["Риск на 90 дней"]).toContain("не обученная ML-модель");
    expect(CONTEXT_HELP["Команда"]).toContain("люди");
    expect(CONTEXT_HELP["Очередь Даблчекера МТР"]).toContain("не заменяет решение специалиста");
    expect(CONTEXT_HELP["/admin/integrations"]).toContain("имитатора");
    for (const text of Object.values(CONTEXT_HELP)) {
      expect(text.length).toBeGreaterThan(70);
      expect(text).not.toMatch(/https?:\/\/|sk-[a-zA-Z0-9]|scrypt\$/);
    }
  });
});
