// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { ScenarioRun } from "@/domain/models";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: navigation.refresh }),
}));

import { ScenarioLauncher } from "@/components/scenario-launcher";

const completedRun: ScenarioRun = {
  id: "run-cache-invalidation",
  userId: "demo-user-001",
  scenarioId: "scenario-full-analysis",
  specificationId: "ALL_CURRENT_SPECIFICATIONS",
  status: "COMPLETED",
  currentStep: "COMPLETED",
  progress: 100,
  mode: "NORMAL",
  seed: "BASE",
  version: 1,
  createdAt: "2026-08-12T10:00:00.000Z",
  updatedAt: "2026-08-12T10:00:01.000Z",
  completedAt: "2026-08-12T10:00:01.000Z",
  inputSnapshot: {},
  outputSnapshot: {},
  steps: [],
};

const queuedRun: ScenarioRun = {
  ...completedRun,
  status: "QUEUED",
  currentStep: "QUEUED",
  progress: 0,
  completedAt: undefined,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigation.refresh.mockReset();
});

describe("scenario launcher cache freshness", () => {
  it("invalidates prefetched routes after creation and terminal background status", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => queuedRun,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => completedRun,
      } as Response);

    render(
      <ScenarioLauncher
        scenarios={[
          {
            id: "scenario-full-analysis",
            name: "Полный анализ",
            description: "Проверка Appius, SAP и нормативов",
            defaultSeed: "BASE",
          },
        ]}
        specifications={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Запустить сценарий" }));

    await waitFor(() => expect(navigation.refresh).toHaveBeenCalledTimes(1));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/scenario-runs",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
    await waitFor(() => expect(navigation.refresh).toHaveBeenCalledTimes(2));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `/api/scenario-runs/${completedRun.id}`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
