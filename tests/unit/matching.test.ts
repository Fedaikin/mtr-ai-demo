import { categoryForScore, findBestMaterial, scoreMaterial } from "@/domain/matching";
import type { Position, SapMaterial } from "@/domain/models";

const position = (overrides: Partial<Position> = {}): Position => ({
  id: "position-test-001",
  userId: "demo-user-001",
  internalCode: "APP-DEMO-PUMP-001",
  nameRu: "Насос центробежный DN 50",
  nameEn: "Centrifugal pump DN 50",
  synonyms: ["pump DN50"],
  equipmentType: "PUMP",
  standard: "TU-DEMO-PUMP-001",
  materialGrade: "POLYMER-DEMO-PVDF",
  dimensions: { nominalDiameterMm: 50, flowM3h: 20 },
  requiredQuantity: 2,
  unit: "EA",
  specificationId: "spec-test-001",
  versionId: "spec-test-001-v2",
  versionNumber: 2,
  isCurrentVersion: true,
  classification: { criticality: "MEDIUM" },
  access: { allowedUserIds: ["demo-user-001"] },
  ...overrides,
});

const material = (overrides: Partial<SapMaterial> = {}): SapMaterial => ({
  id: "stock-test-001",
  userId: "demo-user-001",
  materialCode: "SAP-DEMO-PUMP-001",
  nameRu: "Насос центробежный DN 50",
  nameEn: "Centrifugal pump DN 50",
  synonyms: ["pump DN50"],
  equipmentType: "PUMP",
  standard: "TU-DEMO-PUMP-001",
  materialGrade: "POLYMER-DEMO-PVDF",
  dimensions: { nominalDiameterMm: 50, flowM3h: 20 },
  plant: "PLANT-DEMO-01",
  storageLocation: "WH-DEMO-01",
  availableQuantity: 4,
  unit: "EA",
  snapshotAt: "2026-08-11T07:30:00.000Z",
  cardUrl: "/materials/SAP-DEMO-PUMP-001",
  ...overrides,
});

describe("matching thresholds", () => {
  it.each([
    [100, "EXACT"],
    [99, "LIKELY"],
    [95, "LIKELY"],
    [94, "REVIEW"],
    [80, "REVIEW"],
    [79, "NO_MATCH"],
    [0, "NO_MATCH"],
  ] as const)("maps score %i to %s", (score, category) => {
    expect(categoryForScore(score)).toBe(category);
  });

  it("recognizes an exact legacy-code match", () => {
    const result = scoreMaterial(
      position(),
      material({
        legacyCode: "app_demo pump 001",
        nameRu: "Другое демонстрационное обозначение",
        nameEn: undefined,
        synonyms: [],
      }),
    );

    expect(result).toMatchObject({ score: 100, category: "EXACT" });
    expect(result.matched).toContain("код/legacy-код");
  });

  it("does not let a legacy code erase hard characteristic incompatibilities", () => {
    const result = scoreMaterial(
      position(),
      material({
        legacyCode: "app_demo pump 001",
        standard: "OTHER-DEMO-STANDARD",
        materialGrade: "OTHER-DEMO-GRADE",
      }),
    );

    expect(result.score).toBeLessThan(80);
    expect(result.category).toBe("NO_MATCH");
    expect(result.matched).toContain("код/legacy-код");
  });

  it("matches bilingual names through normalized synonyms", () => {
    const result = scoreMaterial(
      position({ nameRu: "Насос DN 50", nameEn: undefined, synonyms: [] }),
      material({ nameRu: "Pump DN50", nameEn: undefined, synonyms: [] }),
    );

    expect(result.matched).toContain("наименование/синонимы");
    expect(result.category).not.toBe("NO_MATCH");
  });

  it("rejects a different equipment type before fuzzy scoring", () => {
    expect(scoreMaterial(position(), material({ equipmentType: "PIPE" }))).toMatchObject({
      score: 0,
      category: "NO_MATCH",
      requiresHumanReview: false,
    });
  });

  it("returns no material when every candidate is below the review threshold", () => {
    const result = findBestMaterial(position(), [
      material({ id: "stock-other", materialCode: "SAP-OTHER", equipmentType: "CABLE" }),
    ]);

    expect(result.category).toBe("NO_MATCH");
    expect(result.material).toBeNull();
  });

  it("breaks equal-score ties by stable material code order", () => {
    const result = findBestMaterial(position(), [
      material({ id: "stock-b", materialCode: "SAP-DEMO-B" }),
      material({ id: "stock-a", materialCode: "SAP-DEMO-A" }),
    ]);

    expect(result.material?.materialCode).toBe("SAP-DEMO-A");
  });
});
