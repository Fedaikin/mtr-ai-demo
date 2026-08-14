import { describe, expect, it } from "vitest";

import type { Position, ResponsibilityRule } from "@/domain/models";
import {
  buildResponsibilityRuleManifest,
  classifyResponsibility,
} from "@/domain/responsibility";

const sourceScope = {
  projectId: "demo-project-001",
  sourceScopeId: "demo-normative-001",
  datasetVersion: "normative-base-v1",
} as const;

describe("corrective responsibility decision state", () => {
  it("keeps a 92% applicable rule resolved without inventing a review condition", () => {
    expect(classifyResponsibility(position(), [rule({ conditions: { confidence: 0.92 } })])).toMatchObject({
      decisionState: "RESOLVED",
      responsibility: "CUSTOMER",
      confidence: 0.92,
      requiresHumanReview: false,
      citation: { clauseId: "KT-DEMO-2.2" },
    });
  });

  it("returns insufficient data without hidden customer or contractor assignment", () => {
    expect(classifyResponsibility(position(), [])).toEqual(expect.objectContaining({
      decisionState: "INSUFFICIENT_DATA",
      responsibility: null,
      confidence: null,
      citation: null,
      candidateCitations: [],
      requiresHumanReview: true,
    }));
  });

  it("keeps conflicting equally specific rules out of both responsibility totals", () => {
    expect(classifyResponsibility(position(), [
      rule({ responsibility: "CUSTOMER", clauseId: "KT-DEMO-2.2" }),
      rule({ responsibility: "CONTRACTOR", clauseId: "KT-DEMO-2.3" }),
    ])).toMatchObject({
      decisionState: "REVIEW_REQUIRED",
      responsibility: null,
      confidence: null,
      citation: null,
      candidateCitations: [
        { clauseId: "KT-DEMO-2.2" },
        { clauseId: "KT-DEMO-2.3" },
      ],
      requiresHumanReview: true,
    });
  });

  it("builds a versioned manifest bound to the trusted project and normative source", () => {
    const manifest = buildResponsibilityRuleManifest([
      rule({ equipmentTypes: ["CABLE", "ELECTRIC_MOTOR"] }),
      rule({ equipmentTypes: ["PIPE"], clauseId: "KT-DEMO-2.4", version: "1.1-DEMO" }),
    ], sourceScope);

    expect(manifest).toMatchObject({
      schemaVersion: "responsibility-rule-manifest-v1",
      projectId: "demo-project-001",
      sourceScopeId: "demo-normative-001",
      datasetVersion: "normative-base-v1",
      ruleCount: 2,
      equipmentTypes: ["CABLE", "ELECTRIC_MOTOR", "PIPE"],
      documents: [
        expect.objectContaining({ documentId: "KT-374-DEMO", version: "1.0-DEMO" }),
        expect.objectContaining({ documentId: "KT-374-DEMO", version: "1.1-DEMO" }),
      ],
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });
});

function position(): Position {
  return {
    id: "position-corrective-001",
    userId: "demo-user-001",
    internalCode: "APP-DEMO-CABLE-001",
    nameRu: "Кабель силовой",
    synonyms: [],
    equipmentType: "CABLE",
    dimensions: { crossSectionMm2: 16 },
    requiredQuantity: 100,
    unit: "M",
    specificationId: "spec-corrective-001",
    versionId: "spec-corrective-001-v1",
    versionNumber: 1,
    isCurrentVersion: true,
    classification: { criticality: "MEDIUM" },
    access: { allowedUserIds: ["demo-user-001"] },
  };
}

function rule(overrides: Partial<ResponsibilityRule> = {}): ResponsibilityRule {
  return {
    documentId: "KT-374-DEMO",
    version: "1.0-DEMO",
    clauseId: "KT-DEMO-2.2",
    title: "Синтетические правила ответственности",
    isSyntheticDemo: true,
    equipmentTypes: ["CABLE"],
    responsibility: "CUSTOMER",
    text: "Кабель относится к ответственности заказчика.",
    ...overrides,
  };
}
