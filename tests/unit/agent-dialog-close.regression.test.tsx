// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AgentChat } from "@/components/agent-chat";

describe("закрытие окна МТР-агента", () => {
  it("показывает доступный крестик и вызывает единый обработчик закрытия", () => {
    Element.prototype.scrollIntoView = vi.fn();
    const onClose = vi.fn();

    render(
      <AgentChat
        displayName="Демо-пользователь 1"
        initialThreads={[]}
        initialThreadId={null}
        initialMessages={[]}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Закрыть окно агента" }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
