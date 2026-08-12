// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { ScenarioRun } from "@/domain/models";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: navigation.refresh }),
}));

import { RunDetailClient } from "@/components/run-detail-client";

const queuedRun: ScenarioRun = {
  id: "run-detail-cache",
  userId: "demo-user-001",
  scenarioId: "scenario-full-analysis",
  specificationId: "ALL_CURRENT_SPECIFICATIONS",
  status: "QUEUED",
  currentStep: "QUEUED",
  progress: 0,
  mode: "NORMAL",
  seed: "BASE",
  version: 1,
  createdAt: "2026-08-12T10:00:00.000Z",
  updatedAt: "2026-08-12T10:00:00.000Z",
  inputSnapshot: {},
  outputSnapshot: {},
  steps: [],
};

const completedRun: ScenarioRun = {
  ...queuedRun,
  status: "COMPLETED",
  currentStep: "COMPLETED",
  progress: 100,
  version: 2,
  completedAt: "2026-08-12T10:00:01.000Z",
  updatedAt: "2026-08-12T10:00:01.000Z",
};

const cancelledRun: ScenarioRun = {
  ...queuedRun,
  status: "CANCELLED",
  currentStep: "CANCELLED",
  version: 2,
  updatedAt: "2026-08-12T10:00:01.000Z",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigation.refresh.mockReset();
});

describe("run detail cache freshness", () => {
  it("invalidates prefetched summaries after terminal background status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => completedRun,
    } as Response);

    render(<RunDetailClient initialRun={queuedRun} />);

    await waitFor(() => expect(navigation.refresh).toHaveBeenCalledTimes(1));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `/api/scenario-runs/${queuedRun.id}`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("invalidates prefetched summaries after cancellation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => cancelledRun,
    } as Response);

    render(<RunDetailClient initialRun={queuedRun} />);
    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));

    await waitFor(() => expect(navigation.refresh).toHaveBeenCalledTimes(1));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `/api/scenario-runs/${queuedRun.id}/cancel`,
      expect.objectContaining({ method: "POST" }),
    );
  });
});
