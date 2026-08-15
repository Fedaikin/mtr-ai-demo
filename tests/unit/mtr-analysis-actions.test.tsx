// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: navigation.refresh }),
}));

import { MtrAnalysisActions } from "@/components/mtr-analysis-actions";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigation.refresh.mockReset();
});

describe("MTR analysis actions", () => {
  it("renders compact section buttons and clears only after confirmation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ runId: "run-1", clearedAt: "2026-08-15T12:00:00.000Z" }),
    } as Response);

    render(<MtrAnalysisActions runId="run-1" canClear />);

    expect(screen.getByRole("link", { name: "01 Ответственность по позициям" }).getAttribute("href")).toBe("#responsibility");
    expect(screen.getByRole("link", { name: "02 Даблчекер МТР" }).getAttribute("href")).toBe("#doublechecker");
    expect(screen.getByRole("link", { name: "03 Полный отчет" }).getAttribute("href")).toBe("#full-report");

    fireEvent.click(screen.getByRole("button", { name: "Очистить предыдущий анализ" }));
    expect(screen.getByText("Скрыть предыдущий анализ с этого экрана?")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Подтвердить очистку" }));

    await waitFor(() => expect(navigation.refresh).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/mtr-analysis/clear", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "run-1" }),
    });
  });

  it("keeps the analysis visible when confirmation is cancelled", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<MtrAnalysisActions runId="run-1" canClear />);

    fireEvent.click(screen.getByRole("button", { name: "Очистить предыдущий анализ" }));
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(screen.queryByText("Скрыть предыдущий анализ с этого экрана?")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the compact navigation read-only without the analysis permission", () => {
    render(<MtrAnalysisActions runId="run-1" canClear={false} />);

    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Очистить предыдущий анализ" })).toBeNull();
  });
});
