import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { AdminScenarioToggle } from "@/components/admin-scenario-toggle";

describe("ACC-FUNC-009: стабильное доступное имя переключателя сценария", () => {
  it("не меняет aria-label при изменении aria-checked", () => {
    const name = "Полный анализ спецификации";
    const enabled = renderToStaticMarkup(
      <AdminScenarioToggle initialScenarios={[{ id: "scenario-full", name, enabled: true }]} />,
    );
    const disabled = renderToStaticMarkup(
      <AdminScenarioToggle initialScenarios={[{ id: "scenario-full", name, enabled: false }]} />,
    );

    expect(enabled).toContain(`aria-label="Сценарий «${name}»"`);
    expect(disabled).toContain(`aria-label="Сценарий «${name}»"`);
    expect(enabled).toContain('aria-checked="true"');
    expect(disabled).toContain('aria-checked="false"');
    expect(enabled).not.toContain(`aria-label="Отключить сценарий`);
    expect(disabled).not.toContain(`aria-label="Включить сценарий`);
  });
});
