// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ScenarioRun } from "@/domain/models";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { RunDetailClient } from "@/components/run-detail-client";

afterEach(cleanup);

describe("ACC-FUNC-002 manual import affordance", () => {
  it("offers every approved Appius document and image extension", () => {
    render(<RunDetailClient initialRun={failedRun("APPIUS_UNAVAILABLE")} />);

    const input = screen.getByLabelText("Файл спецификации Appius");
    expect(input.getAttribute("accept")).toBe(
      ".csv,.xls,.xlsx,.txt,.pdf,.docx,.jpeg,.jpg,.png,.tiff",
    );
    expect(screen.getByText(/TXT, PDF, DOCX, JPEG, JPG, PNG или TIFF/u)).toBeTruthy();
  });

  it("keeps SAP manual import constrained to tabular formats", () => {
    render(<RunDetailClient initialRun={failedRun("SAP_UNAVAILABLE")} />);

    const input = screen.getByLabelText("Файл остатков SAP");
    expect(input.getAttribute("accept")).toBe(".csv,.xls,.xlsx");
    expect(screen.getByText(/CSV, XLS или XLSX с данными остатков SAP/u)).toBeTruthy();
  });
});

function failedRun(errorCode: string): ScenarioRun {
  return {
    id: `run-${errorCode.toLocaleLowerCase("en-US")}`,
    userId: "demo-user-001",
    scenarioId: "scenario-full-analysis",
    specificationId: "ALL_CURRENT_SPECIFICATIONS",
    status: "FAILED",
    currentStep: "FAILED",
    progress: 0,
    mode: "NORMAL",
    seed: "BASE",
    version: 2,
    createdAt: "2026-08-12T10:00:00.000Z",
    updatedAt: "2026-08-12T10:00:01.000Z",
    errorCode,
    errorMessage: "Синтетический отказ источника",
    inputSnapshot: {},
    outputSnapshot: {},
    steps: [],
  };
}
