import { describe, expect, test } from "vitest";

import { generateUniversalChatDataset } from "@/adapters/mock/fixtures/universal-chat-dataset";
import {
  calculateProjectMaterialBalance,
  calculateQuantityCoveragePercent,
} from "@/application/agent-orchestrator/universal-chat/project-stock-formulas";
import { createFixedScenarioClock } from "@/domain/agent/universal-chat/scenario-clock";

const dataset = generateUniversalChatDataset(
  createFixedScenarioClock("2026-08-13T09:15:00.000Z"),
);

describe("universal-chat-v1 project stock oracles", () => {
  test("matches every versioned project-material balance oracle", () => {
    expect(dataset.projectMaterialOracles.length).toBeGreaterThan(0);
    for (const oracle of dataset.projectMaterialOracles) {
      expect(calculateProjectMaterialBalance(oracle.inputs)).toEqual(oracle.expected);
      expect(oracle.formulaVersion).toBe("project-material-balance-v1");
    }
  });

  test("never allocates one snapshot balance twice for the same project need", () => {
    const keys = dataset.projectAllocations.map(
      (allocation) =>
        `${allocation.snapshotId}:${allocation.businessProjectId}:${allocation.materialCode}`,
    );
    expect(new Set(keys).size).toBe(keys.length);

    const allocatedBySnapshot = new Map<string, number>();
    for (const allocation of dataset.projectAllocations) {
      allocatedBySnapshot.set(
        allocation.snapshotId,
        (allocatedBySnapshot.get(allocation.snapshotId) ?? 0) + allocation.quantity,
      );
    }
    for (const material of dataset.operationalMaterials) {
      expect(allocatedBySnapshot.get(material.stock.snapshotId) ?? 0).toBeLessThanOrEqual(
        material.stock.onHandQuantity -
          material.stock.reservedQuantity -
          material.stock.quarantinedQuantity,
      );
    }
  });

  test("keeps association, compatibility, quantity coverage and data confidence independent", () => {
    const sample = dataset.projectMaterialOracles.find(
      (oracle) => oracle.expected.shortageAtNeedDate > 0,
    );
    expect(sample).toBeDefined();
    if (!sample) return;

    expect(sample.indicators.projectAssociationConfidencePercent).toBe(100);
    expect(sample.indicators.technicalCompatibilityPercent).toBe(100);
    expect(sample.indicators.quantityCoveragePercent).toBe(
      calculateQuantityCoveragePercent(
        sample.expected.netAvailableAtNeedDate,
        sample.expected.requiredAtNeedDate,
      ),
    );
    expect(sample.indicators.quantityCoveragePercent).toBeLessThan(100);
    expect(sample.indicators.dataConfidencePercent).toBeGreaterThanOrEqual(80);
    expect(sample.indicators.dataConfidencePercent).not.toBe(
      sample.indicators.quantityCoveragePercent,
    );
  });

  test("uses integer quantities and pack-size rounding for reorder recommendations", () => {
    for (const oracle of dataset.projectMaterialOracles) {
      const result = oracle.expected;
      expect(Number.isInteger(result.netAvailableNow)).toBe(true);
      expect(Number.isInteger(result.netAvailableAtNeedDate)).toBe(true);
      expect(Number.isInteger(result.requiredAtNeedDate)).toBe(true);
      expect(Number.isInteger(result.shortageAtNeedDate)).toBe(true);
      expect(Number.isInteger(result.reorderQuantity)).toBe(true);
      expect(result.reorderQuantity % oracle.inputs.packSize).toBe(0);
    }
  });
});
