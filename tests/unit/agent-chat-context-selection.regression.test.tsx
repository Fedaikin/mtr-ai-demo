import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AgentChat } from "@/components/agent-chat";

describe("контекст и команды в общем AgentChat", () => {
  it("показывает быстрые команды и серверный project context", () => {
    const markup = renderToStaticMarkup(
      <AgentChat
        displayName="Аналитик"
        initialThreads={[]}
        initialThreadId={null}
        initialMessages={[]}
        context={{ projectId: "demo-project-001", specificationId: "spec-1" }}
      />,
    );

    expect(markup).toContain("Оперативная сводка");
    expect(markup).toContain("Мои задачи");
    expect(markup).toContain("Риски");
    expect(markup).toContain("Остатки");
    expect(markup).toContain("KPI и SLA");
    expect(markup).not.toContain("demo-project-001");
  });
});
