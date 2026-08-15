import type { Position, ResponsibilityRule } from "@/domain/models";
import { classifyResponsibility } from "@/domain/responsibility";

const position = (overrides: Partial<Position> = {}): Position => ({
  id: "position-test-001",
  userId: "demo-user-001",
  internalCode: "APP-DEMO-CABLE-001",
  nameRu: "Кабель силовой",
  synonyms: [],
  equipmentType: "CABLE",
  dimensions: { crossSectionMm2: 16 },
  requiredQuantity: 100,
  unit: "M",
  specificationId: "spec-test-001",
  versionId: "spec-test-001-v1",
  versionNumber: 1,
  isCurrentVersion: true,
  classification: { criticality: "MEDIUM" },
  access: { allowedUserIds: ["demo-user-001"] },
  ...overrides,
});

const rule = (overrides: Partial<ResponsibilityRule> = {}): ResponsibilityRule => ({
  documentId: "KT-374-DEMO",
  version: "1.0-DEMO",
  clauseId: "KT-DEMO-2.2",
  title: "Синтетические правила ответственности",
  isSyntheticDemo: true,
  equipmentTypes: ["CABLE"],
  responsibility: "CUSTOMER",
  text: "В демонстрационном контуре кабель относится к ответственности заказчика.",
  ...overrides,
});

describe("responsibility classification", () => {
  it("returns a decision with traceable synthetic evidence", () => {
    const result = classifyResponsibility(position(), [rule()]);

    expect(result).toMatchObject({
      responsibility: "CUSTOMER",
      confidence: 0.96,
      requiresHumanReview: false,
      citation: {
        documentId: "KT-374-DEMO",
        version: "1.0-DEMO",
        clauseId: "KT-DEMO-2.2",
        isSyntheticDemo: true,
      },
    });
    expect(result.explanation).toContain("демонстрационном контуре");
  });

  it("uses an explicit wildcard rule as a controlled fallback", () => {
    const fallback = rule({
      equipmentTypes: ["*"],
      responsibility: "CONTRACTOR",
      clauseId: "KT-DEMO-FALLBACK",
    });

    expect(
      classifyResponsibility(position({ equipmentType: "UNMAPPED_DEMO_TYPE" }), [fallback]),
    ).toMatchObject({
      responsibility: "CONTRACTOR",
      citation: { clauseId: "KT-DEMO-FALLBACK" },
    });
  });

  it("requires expert review when the applicable evidence marks a critical position", () => {
    const result = classifyResponsibility(
      position({ classification: { criticality: "HIGH" } }),
      [rule({ conditions: { expertReviewForCritical: true } })],
    );

    expect(result).toMatchObject({ confidence: 0.82, requiresHumanReview: true });
  });

  it("selects a more specific rule by class, standard and dimensions", () => {
    const result = classifyResponsibility(
      position({
        equipmentType: "CABLE",
        standard: "TU-DEMO-CABLE-EX",
        dimensions: { crossSectionMm2: 16 },
        classification: {
          criticality: "HIGH",
          procurementGroup: "ELECTRICAL",
          classCode: "MTR.CABLE.POWER",
        },
      }),
      [
        rule({
          responsibility: "CUSTOMER",
          clauseId: "KT-DEMO-GENERIC",
        }),
        rule({
          responsibility: "CONTRACTOR",
          clauseId: "KT-DEMO-SPECIFIC",
          conditions: {
            standard: "TU-DEMO-CABLE-EX",
            classification: { procurementGroup: "ELECTRICAL", classCode: "MTR.CABLE.POWER" },
            dimensions: { crossSectionMm2: { min: 10, max: 25 } },
          },
        }),
      ],
    );

    expect(result).toMatchObject({
      responsibility: "CONTRACTOR",
      citation: { clauseId: "KT-DEMO-SPECIFIC" },
    });
  });

  it("rejects a type-compatible rule when a relevant attribute conflicts", () => {
    const result = classifyResponsibility(position(), [
      rule({
        conditions: { classification: { procurementGroup: "ROTATING" } },
      }),
    ]);

    expect(result).toMatchObject({
      decisionState: "INSUFFICIENT_DATA",
      responsibility: null,
      confidence: null,
      requiresHumanReview: true,
      citation: null,
    });
  });

  it("recognizes a hazardous-area review condition from position attributes", () => {
    const result = classifyResponsibility(
      position({
        equipmentType: "ELECTRIC_MOTOR",
        nameRu: "Электродвигатель взрывозащищённый",
        dimensions: { protectionClass: "EX-DEMO-IP65" },
        classification: { criticality: "MEDIUM", classCode: "MTR.MOTOR.EX" },
      }),
      [
        rule({
          equipmentTypes: ["ELECTRIC_MOTOR"],
          conditions: { requiresHumanReviewWhen: "HAZARDOUS_AREA" },
        }),
      ],
    );

    expect(result).toMatchObject({ requiresHumanReview: true, confidence: 0.82 });
  });

  it("fails safely without inventing an assignment when no rule applies", () => {
    const result = classifyResponsibility(position(), []);

    expect(result).toMatchObject({
      decisionState: "INSUFFICIENT_DATA",
      responsibility: null,
      confidence: null,
      requiresHumanReview: true,
      citation: null,
    });
  });
});
