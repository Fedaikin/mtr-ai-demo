import { describe, expect, it } from "vitest";

import { generateAgentAnalyticalDataset } from "@/adapters/mock/fixtures/agent-analytical-dataset";

describe("g1 analytical vertical dataset", () => {
  it("is deterministic, versioned and matches every declared count", () => {
    const dataset = generateAgentAnalyticalDataset();
    const second = generateAgentAnalyticalDataset();
    const counts = dataset.manifest.expectedCounts;

    expect(second).toEqual(dataset);
    expect(dataset.manifest).toMatchObject({
      datasetId: "g1-vertical-v1",
      schemaVersion: "1.0.0",
      datasetVersion: "1.0.0-DEMO",
      isSyntheticDemo: true,
    });
    expect(dataset.manifest.checksum).toMatch(/^fnv1a32-[0-9a-f]{8}$/);
    expect(new Set(dataset.positions.map((position) => position.specificationId))).toHaveLength(
      counts.specifications,
    );
    expect(dataset.positions).toHaveLength(counts.positions);
    expect(dataset.stockSnapshots).toHaveLength(counts.stockRows);
    expect(dataset.movements).toHaveLength(counts.movementRows);
    expect(dataset.reservationEvents).toHaveLength(counts.reservationEvents);
    expect(dataset.bomLinks).toHaveLength(counts.bomLinks);
    expect(dataset.shortages).toHaveLength(counts.shortages);
    expect(dataset.runs).toHaveLength(counts.scenarioRuns);
    expect(dataset.expertTasks).toHaveLength(counts.expertTasks);
    expect(dataset.outcomes).toHaveLength(counts.outcomeOracles);
    expect(dataset.qualityCases).toHaveLength(counts.qualityCases);
  });

  it("contains the certified 95% Appius-catalog-SAP crosswalk and intentional negatives", () => {
    const dataset = generateAgentAnalyticalDataset();
    const mapped = dataset.positions.filter((position) => !position.intentionalNegative);
    const negatives = dataset.positions.filter((position) => position.intentionalNegative);

    expect(mapped).toHaveLength(dataset.manifest.expectedCounts.mappedPositions);
    expect(negatives).toHaveLength(dataset.manifest.expectedCounts.intentionalUnmappedPositions);
    expect(mapped.every((position) => position.catalogItemCode && position.sapMaterialCode)).toBe(true);
    expect(negatives.every((position) => !position.catalogItemCode && !position.sapMaterialCode)).toBe(true);
    expect(dataset.positions.filter((position) => position.itemKind === "ASSEMBLY")).toHaveLength(24);
    expect(dataset.positions.filter((position) => position.itemKind === "COMPONENT")).toHaveLength(216);
    expect(new Set(mapped.map((position) => position.sapMaterialCode)).size).toBe(228);
  });

  it("models four warehouses, complete stock dimensions and thirteen weeks of all movement types", () => {
    const dataset = generateAgentAnalyticalDataset();
    const mappedCodes = dataset.positions
      .map((position) => position.sapMaterialCode)
      .filter((code): code is string => code !== null);
    const asOf = Date.parse(dataset.manifest.asOf);

    expect(new Set(dataset.stockSnapshots.map((row) => row.warehouseId))).toHaveLength(4);
    for (const code of mappedCodes) {
      expect(dataset.stockSnapshots.filter((row) => row.materialCode === code)).toHaveLength(4);
      const movements = dataset.movements.filter((row) => row.materialCode === code);
      expect(movements).toHaveLength(208);
      expect(new Set(movements.map((row) => row.type))).toEqual(
        new Set(["CONSUMPTION", "RECEIPT", "TRANSFER", "ADJUSTMENT"]),
      );
    }
    expect(
      dataset.stockSnapshots.every(
        (row) =>
          Number.isFinite(row.onHandQuantity) &&
          Number.isFinite(row.reservedQuantity) &&
          Number.isFinite(row.quarantinedQuantity),
      ),
    ).toBe(true);
    expect(dataset.movements.every((row) => Date.parse(row.occurredAt) <= asOf)).toBe(true);
    expect(
      dataset.reservationEvents.every((row) => Date.parse(row.occurredAt) <= asOf),
    ).toBe(true);
  });

  it("provides BOM, responsibility, shortage and future-outcome oracles without hidden null-to-zero", () => {
    const dataset = generateAgentAnalyticalDataset();
    const positive = dataset.shortages.filter(
      (shortage) => shortage.expectedAnalogueOutcome === "CANDIDATE_AVAILABLE",
    );
    const negative = dataset.shortages.filter(
      (shortage) => shortage.expectedAnalogueOutcome === "NO_CANDIDATE",
    );
    const resolved = dataset.responsibilities.filter(
      (responsibility) => responsibility.responsibility !== "UNKNOWN",
    );
    const unknown = dataset.responsibilities.filter(
      (responsibility) => responsibility.responsibility === "UNKNOWN",
    );

    expect(new Set(dataset.bomLinks.map((link) => link.assemblyCode))).toHaveLength(24);
    for (const assemblyCode of new Set(dataset.bomLinks.map((link) => link.assemblyCode))) {
      expect(dataset.bomLinks.filter((link) => link.assemblyCode === assemblyCode)).toHaveLength(6);
    }
    expect(positive).toHaveLength(36);
    expect(positive.every((shortage) => shortage.expectedCandidateCodes.length > 0)).toBe(true);
    expect(negative).toHaveLength(12);
    expect(negative.every((shortage) => shortage.expectedCandidateCodes.length === 0)).toBe(true);
    expect(positive.filter((shortage) => shortage.planKind === "SINGLE")).toHaveLength(18);
    expect(positive.filter((shortage) => shortage.planKind === "COMPOSITE")).toHaveLength(18);
    expect(dataset.inboundSupplies).toHaveLength(48);
    expect(dataset.inboundSupplies.every((supply) => Number.isFinite(supply.confirmedQuantity))).toBe(true);
    expect(
      dataset.inboundSupplies.every(
        (supply) =>
          Date.parse(supply.promisedAt) <= Date.parse(supply.updatedAt) &&
          (supply.actualAt === null || Date.parse(supply.updatedAt) <= Date.parse(supply.actualAt)),
      ),
    ).toBe(true);
    expect(resolved).toHaveLength(228);
    expect(unknown).toHaveLength(12);
    expect(unknown.every((item) => item.documentId === null && item.clauseId === null)).toBe(true);
    expect(
      dataset.outcomes.every(
        (outcome) =>
          Date.parse(outcome.originAt) < Date.parse(outcome.observedAt) &&
          Date.parse(outcome.observedAt) <= Date.parse(dataset.manifest.asOf),
      ),
    ).toBe(true);
  });

  it("contains at least sixty component families and sealed quality counterexamples", () => {
    const dataset = generateAgentAnalyticalDataset();
    const componentFamilies = new Set(
      dataset.positions
        .filter((position) => position.itemKind === "COMPONENT" && position.catalogFamilyId)
        .map((position) => position.catalogFamilyId),
    );

    expect(componentFamilies.size).toBeGreaterThanOrEqual(60);
    expect(dataset.qualityCases.map((item) => item.kind)).toEqual([
      "CURRENT_SNAPSHOT",
      "STALE_SNAPSHOT",
      "CONFLICTING_SNAPSHOT",
      "MISSING_WEEK",
      "UNIT_CONFLICT",
      "ZERO_CONSUMPTION",
    ]);
    expect(dataset.qualityCases.filter((item) => item.expectedDisposition === "UNAVAILABLE"))
      .toHaveLength(3);
  });
});
