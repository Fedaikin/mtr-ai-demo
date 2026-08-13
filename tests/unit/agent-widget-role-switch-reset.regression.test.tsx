// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/mtr-analysis",
  useRouter: () => ({ replace, refresh }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

import { AgentWidget } from "@/components/agent-widget";
import { RoleSwitcher } from "@/components/role-switcher";

describe("reset контекста МТР-агента при смене роли", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    replace.mockReset();
    refresh.mockReset();
  });

  it("закрывает widget и удаляет загруженные диалоги до навигации", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/agent/threads") {
        return new Response(JSON.stringify({ items: [{ id: "private-thread-1", title: "Закрытый диалог" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "/api/auth/switch-role") {
        return new Response(JSON.stringify({ redirectTo: "/mtr-analysis" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(null, { status: 404 });
    });

    render(<>
      <RoleSwitcher currentLogin="demo" />
      <AgentWidget
        displayName="Демо-пользователь"
        subjectId="demo-user-001"
        authorizationVersion={7}
        activeProjectId="demo-project-001"
      />
    </>);

    fireEvent.click(screen.getByRole("button", { name: "МТР-агент" }));
    expect(await screen.findByRole("complementary", { name: "МТР-агент" })).not.toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/agent/threads", { cache: "no-store" }));

    fireEvent.change(screen.getByRole("combobox", { name: "Демонстрационная роль" }), {
      target: { value: "viewer" },
    });

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/mtr-analysis"));
    expect(screen.queryByRole("complementary", { name: "МТР-агент" })).toBeNull();
    expect(screen.getByRole("button", { name: "МТР-агент" }).getAttribute("aria-expanded")).toBe("false");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
