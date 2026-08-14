import { assessNegativeEvidence } from "@/domain/agent/evidence";
import type { AgentEvidence } from "@/ports/agent-orchestrator";

function evidence(patch: Partial<AgentEvidence> = {}): AgentEvidence {
  return {
    availability: "COMPLETE",
    confidence: 0.9,
    coverage: {
      requestedScope: ["WH-01", "WH-02"],
      checkedScope: ["WH-01", "WH-02"],
      complete: true,
    },
    citations: [
      {
        sourceKind: "MATERIAL_MOVEMENT",
        sourceSystem: "SAP",
        entityId: "stock-snapshot-1",
        sourceSnapshot: "sap-snapshot-2026-08-13T08:00:00Z",
        observedAt: "2026-08-13T08:01:00.000Z",
      },
    ],
    missingData: [],
    ...patch,
  };
}

describe("политика отрицательного доказательства МТР-агента", () => {
  it("разрешает пустой вывод только при полном доказанном охвате", () => {
    expect(assessNegativeEvidence(0, evidence())).toEqual({
      conclusion: "PROVEN_EMPTY",
      confidence: 0.9,
      requiresHumanReview: false,
    });
  });

  it.each([
    evidence({ citations: [] }),
    evidence({ availability: "PARTIAL" }),
    evidence({ availability: "UNAVAILABLE" }),
    evidence({
      coverage: {
        requestedScope: ["WH-01", "WH-02"],
        checkedScope: ["WH-01"],
        complete: false,
      },
    }),
  ])("не выдаёт уверенный отрицательный вывод без существенного доказательства", (sourceEvidence) => {
    expect(assessNegativeEvidence(0, sourceEvidence)).toEqual({
      conclusion: "UNPROVEN_EMPTY",
      confidence: 0,
      requiresHumanReview: true,
    });
  });

  it("не маскирует частичный положительный результат высокой уверенностью", () => {
    expect(
      assessNegativeEvidence(2, evidence({ availability: "PARTIAL", confidence: 0.95 })),
    ).toEqual({
      conclusion: "NOT_EMPTY",
      confidence: 0.95,
      requiresHumanReview: true,
    });
  });
});
