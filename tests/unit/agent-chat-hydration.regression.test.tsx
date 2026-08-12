import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AgentChat } from "@/components/agent-chat";

describe("ACC-AIUX-006: детерминированная гидратация дат чата", () => {
  it("форматирует одинаковый UTC timestamp в фиксированной зоне Москвы", () => {
    const html = renderToStaticMarkup(
      <AgentChat
        displayName="Демо-пользователь 1"
        initialThreads={[{
          id: "thread-1",
          title: "Проверка времени",
          createdAt: "2026-08-12T10:00:00.000Z",
          updatedAt: "2026-08-12T10:00:00.000Z",
          version: 1,
        }]}
        initialThreadId="thread-1"
        initialMessages={[]}
      />,
    );

    expect(html).toMatch(/12 авг\.?[^<]*13:00/u);
  });
});
