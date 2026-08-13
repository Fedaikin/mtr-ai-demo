import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/mtr-analysis" }));

import { AgentWidget } from "@/components/agent-widget";

describe("изоляция widget context после смены роли", () => {
  it("получает authorizationVersion и subject key в client boundary", () => {
    const markup = renderToStaticMarkup(
      <AgentWidget
        displayName="Аналитик"
        subjectId="demo-analyst-001"
        authorizationVersion={12}
        activeProjectId="demo-project-001"
      />,
    );

    expect(markup).toContain("МТР-агент");
    expect(markup).not.toContain("demo-analyst-001");
  });
});
