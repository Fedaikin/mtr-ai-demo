import { describe, expect, it } from "vitest";

import {
  buildAnalogueCoverage,
  extendAnalogueCoverageWithDirectStock,
} from "@/domain/analogues";
import type { AnalogueRule, Position, SapMaterial } from "@/domain/models";

describe("ACC-FUNC-001: совместное покрытие прямым материалом и аналогами", () => {
  it("полностью закрывает дефицит двумя подтверждёнными компонентами", () => {
    const analogue = buildAnalogueCoverage(
      position(3),
      [material("SAP-ANALOGUE-A", 1), material("SAP-ANALOGUE-B", 2)],
      [rule()],
    );

    expect(extendAnalogueCoverageWithDirectStock(analogue!, 10, 7)).toMatchObject({
      requiredQuantity: 10,
      directCoveredQuantity: 7,
      coveredQuantity: 10,
      complete: true,
      primaryPlan: {
        coveredQuantity: 10,
        complete: true,
        allocations: [{ allocatedQuantity: 1 }, { allocatedQuantity: 2 }],
      },
    });
  });

  it("явно сохраняет частично незакрытый дефицит после одного аналога", () => {
    const analogue = buildAnalogueCoverage(
      position(3),
      [material("SAP-ANALOGUE-C", 1)],
      [rule()],
    );

    expect(extendAnalogueCoverageWithDirectStock(analogue!, 10, 7)).toMatchObject({
      requiredQuantity: 10,
      directCoveredQuantity: 7,
      coveredQuantity: 8,
      complete: false,
      primaryPlan: {
        coveredQuantity: 8,
        complete: false,
        allocations: [{ allocatedQuantity: 1 }],
      },
    });
  });
});

function position(requiredQuantity: number): Position {
  return {
    id: "position-shortage-regression",
    userId: "demo-user-001",
    internalCode: "SHORTAGE-DEMO",
    nameRu: "Труба для проверки дефицита",
    synonyms: [],
    equipmentType: "PIPE",
    standard: "GOST-DEMO-PIPE-001",
    materialGrade: "STEEL-DEMO-C20",
    requiredQuantity,
    unit: "M",
    dimensions: { dn: 50, wallThickness: 3.5 },
    specificationId: "spec-shortage-regression",
    versionId: "version-shortage-regression",
    versionNumber: 1,
    isCurrentVersion: true,
    classification: { criticality: "MEDIUM" },
    access: { allowedUserIds: ["demo-user-001"] },
  };
}

function material(materialCode: string, availableQuantity: number): SapMaterial {
  return {
    id: `material-${materialCode}`,
    userId: "demo-user-001",
    materialCode,
    nameRu: `Аналог ${materialCode}`,
    synonyms: [],
    equipmentType: "PIPE",
    standard: "GOST-DEMO-PIPE-001",
    materialGrade: "STEEL-DEMO-C20",
    availableQuantity,
    unit: "M",
    plant: "PLANT-DEMO-01",
    storageLocation: "WH-DEMO-01",
    snapshotAt: "2026-08-12T00:00:00.000Z",
    cardUrl: `/materials/${materialCode}`,
    dimensions: { dn: 50, wallThickness: 3.5 },
  };
}

function rule(): AnalogueRule {
  return {
    documentId: "ANALOGUE-DEMO-RULES",
    version: "1.0.0",
    clauseId: "AR-DEMO-1.1",
    title: "Синтетическое правило для проверки дефицита",
    isSyntheticDemo: true,
    equipmentTypes: ["PIPE"],
    allowedStandardPairs: [["GOST-DEMO-PIPE-001", "GOST-DEMO-PIPE-001"]],
    allowedMaterialPairs: [["STEEL-DEMO-C20", "STEEL-DEMO-C20"]],
    dimensionTolerances: { dn: 0, wallThickness: 0 },
    text: "Допускается совместное покрытие подтверждёнными аналогами.",
  };
}
