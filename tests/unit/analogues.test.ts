import { buildAnalogueCoverage } from "@/domain/analogues";
import type { AnalogueRule, Position, SapMaterial } from "@/domain/models";

const target = (overrides: Partial<Position> = {}): Position => ({
  id: "position-analogue-test",
  userId: "demo-user-001",
  internalCode: "APP-DEMO-PUMP-A",
  nameRu: "Насос демонстрационный",
  synonyms: [],
  equipmentType: "PUMP",
  standard: "TU-DEMO-PUMP-REQ",
  materialGrade: "POLYMER-DEMO-A",
  dimensions: { flowM3h: 20, headM: 30 },
  requiredQuantity: 4,
  unit: "EA",
  specificationId: "spec-test",
  versionId: "spec-test-v1",
  versionNumber: 1,
  isCurrentVersion: true,
  classification: { criticality: "MEDIUM" },
  access: { allowedUserIds: ["demo-user-001"] },
  ...overrides,
});

const stock = (code: string, quantity: number, overrides: Partial<SapMaterial> = {}): SapMaterial => ({
  id: `stock-${code}`,
  userId: "demo-user-001",
  materialCode: code,
  nameRu: "Аналог насоса демонстрационный",
  synonyms: [],
  equipmentType: "PUMP",
  standard: "TU-DEMO-PUMP-ALT",
  materialGrade: "POLYMER-DEMO-B",
  dimensions: { flowM3h: 20, headM: 30 },
  plant: "PLANT-DEMO-01",
  storageLocation: "WH-DEMO-01",
  availableQuantity: quantity,
  unit: "EA",
  snapshotAt: "2026-08-11T07:30:00.000Z",
  cardUrl: `/materials/${code}`,
  ...overrides,
});

const analogueRule = (overrides: Partial<AnalogueRule> = {}): AnalogueRule => ({
  documentId: "TU-DEMO-PUMP-ALT",
  version: "1.0-DEMO",
  clauseId: "TU-DEMO-4.2",
  title: "Синтетическое правило аналогов",
  isSyntheticDemo: true,
  equipmentTypes: ["PUMP"],
  allowedStandardPairs: [["TU-DEMO-PUMP-REQ", "TU-DEMO-PUMP-ALT"]],
  allowedMaterialPairs: [["POLYMER-DEMO-A", "POLYMER-DEMO-B"]],
  dimensionTolerances: { flowM3h: 1, headM: 1 },
  text: "Допустимость действует только в демонстрационном контуре.",
  ...overrides,
});

describe("analogue coverage", () => {
  it("combines several eligible stock records into full coverage", () => {
    const result = buildAnalogueCoverage(
      target(),
      [stock("SAP-DEMO-A", 1), stock("SAP-DEMO-B", 2), stock("SAP-DEMO-C", 1)],
      [analogueRule()],
    );

    expect(result).toMatchObject({
      requiredQuantity: 4,
      coveredQuantity: 4,
      complete: true,
    });
    expect(result?.allocations).toHaveLength(3);
    expect(result?.allocations.map(({ allocatedQuantity }) => allocatedQuantity)).toEqual([1, 2, 1]);
    expect(result?.primaryPlan).toMatchObject({ coveredQuantity: 4, complete: true });
    expect(result?.primaryPlan?.allocations).toEqual(result?.allocations);
    expect(result?.alternativePlans).toHaveLength(3);
    expect(result?.alternativePlans?.every((plan) => plan.coveredQuantity < 4)).toBe(true);
    expect(result?.allocations.every(({ citation }) => citation.isSyntheticDemo)).toBe(true);
  });

  it("reports combined insufficient coverage without overstating stock", () => {
    const result = buildAnalogueCoverage(
      target({ requiredQuantity: 3 }),
      [stock("SAP-DEMO-A", 1), stock("SAP-DEMO-B", 1)],
      [analogueRule()],
    );

    expect(result).toMatchObject({
      requiredQuantity: 3,
      coveredQuantity: 2,
      complete: false,
    });
    expect(result?.allocations.reduce((sum, item) => sum + item.allocatedQuantity, 0)).toBe(2);
  });

  it("uses a shared reservation ledger to prevent duplicate allocation", () => {
    const reservations = new Map<string, number>();
    const materials = [stock("SAP-DEMO-A", 4)];

    expect(buildAnalogueCoverage(target(), materials, [analogueRule()], reservations)?.complete).toBe(
      true,
    );
    expect(buildAnalogueCoverage(target(), materials, [analogueRule()], reservations)).toBeUndefined();
    expect(reservations.get("stock-SAP-DEMO-A")).toBe(4);
  });

  it("does not commit counterfactual alternative plans to the shared reservation ledger", () => {
    const reservations = new Map<string, number>();
    const result = buildAnalogueCoverage(
      target(),
      [stock("SAP-DEMO-A", 4), stock("SAP-DEMO-B", 4)],
      [analogueRule()],
      reservations,
    );

    expect(result?.primaryPlan?.allocations.map((item) => item.material.materialCode)).toEqual([
      "SAP-DEMO-A",
    ]);
    expect(result?.alternativePlans?.[0]).toMatchObject({ coveredQuantity: 4, complete: true });
    expect(result?.alternativePlans?.[0]?.allocations.map((item) => item.material.materialCode)).toEqual([
      "SAP-DEMO-B",
    ]);
    expect(reservations.get("stock-SAP-DEMO-A")).toBe(4);
    expect(reservations.has("stock-SAP-DEMO-B")).toBe(false);
  });

  it("builds deterministic alternatives only from eligible input candidates", () => {
    const materials = [
      stock("SAP-DEMO-A", 2),
      stock("SAP-DEMO-B", 3),
      stock("SAP-DEMO-C", 4, { unit: "KG" }),
    ];
    const first = buildAnalogueCoverage(target(), materials, [analogueRule()]);
    const second = buildAnalogueCoverage(target(), materials, [analogueRule()]);

    const signatures = (plans = first?.alternativePlans ?? []) => plans.map((plan) =>
      plan.allocations.map((item) => `${item.material.materialCode}:${item.allocatedQuantity}`).join("|"),
    );
    expect(signatures()).toEqual(signatures(second?.alternativePlans));
    expect(signatures().join("|")).not.toContain("SAP-DEMO-C");
  });

  it("returns no coverage without normative evidence", () => {
    expect(buildAnalogueCoverage(target(), [stock("SAP-DEMO-A", 4)], [])).toBeUndefined();
  });

  it("rejects a candidate outside the documented tolerance", () => {
    const outsideTolerance = stock("SAP-DEMO-A", 4, {
      dimensions: { flowM3h: 25, headM: 30 },
    });

    expect(
      buildAnalogueCoverage(target(), [outsideTolerance], [analogueRule()]),
    ).toBeUndefined();
  });

  it("prefers the same manufacturer when normative deviations are equal", () => {
    const result = buildAnalogueCoverage(
      target({ requiredQuantity: 1, manufacturer: "DEMO-PUMP-MAKER" }),
      [
        stock("SAP-DEMO-A", 1, { manufacturer: "OTHER-DEMO-MAKER" }),
        stock("SAP-DEMO-Z", 1, { manufacturer: "DEMO-PUMP-MAKER" }),
      ],
      [analogueRule()],
    );

    expect(result?.allocations[0]?.material.materialCode).toBe("SAP-DEMO-Z");
  });
});
