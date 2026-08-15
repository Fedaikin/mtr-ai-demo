import { describe, expect, it } from "vitest";

import {
  ANALYTICAL_METRIC_KEYS,
  ANALYTICAL_SEMANTIC_REGISTRY,
} from "@/domain/agent/analytics/semantic";
import { assessDataQuality } from "@/domain/agent/analytics/quality";
import {
  validateEvidenceGraph,
  type EvidenceGraphVersion,
} from "@/domain/agent/analytics/evidence-graph";

describe("agent analytical foundation", () => {
  it("defines every metric with versioned semantics and fail-closed freshness", () => {
    expect(Object.keys(ANALYTICAL_SEMANTIC_REGISTRY).sort()).toEqual(
      [...ANALYTICAL_METRIC_KEYS].sort(),
    );

    for (const definition of Object.values(ANALYTICAL_SEMANTIC_REGISTRY)) {
      expect(definition.version).toBe("semantic-registry-1.0.0");
      expect(definition.formula).not.toHaveLength(0);
      expect(definition.sourcePriority.some((source) => source.required)).toBe(true);
      expect(definition.freshness).toEqual({
        maxAgeMinutes: 15,
        maxCrossSourceSkewMinutes: 15,
        staleBehavior: "ABSTAIN",
      });
      expect(definition.unknownPolicy).toBe("RETURN_UNKNOWN");
    }
  });

  it("caps confidence and requires review for stale, incomplete or conflicting data", () => {
    const quality = assessDataQuality(
      [
        {
          sourceSystem: "SAP",
          requestedCount: 100,
          resolvedCount: 80,
          completeness: 0.8,
          observedAt: "2026-08-10T00:00:00.000Z",
          ageMinutes: 120,
          fresh: false,
          unitIssueCount: 1,
          conflictCount: 0,
          unusableFieldCount: 0,
        },
      ],
      {
        minimumCompleteness: 0.95,
        maxAgeMinutes: 15,
        requiredSourceSystems: ["SAP", "APPIUS"],
      },
    );

    expect(quality.availability).toBe("UNAVAILABLE");
    expect(quality.freshness).toBe("UNKNOWN");
    expect(quality.confidenceCeiling).toBe(0);
    expect(quality.requiresHumanReview).toBe(true);
    expect(quality.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["SOURCE_INCOMPLETE", "SOURCE_STALE", "SOURCE_CONFLICT", "SOURCE_UNAVAILABLE"]),
    );
  });

  it("accepts only complete, fresh and conflict-free required sources", () => {
    const quality = assessDataQuality(
      ["SAP", "APPIUS"].map((sourceSystem) => ({
        sourceSystem,
        requestedCount: 10,
        resolvedCount: 10,
        completeness: 1,
        observedAt: "2026-08-10T23:50:00.000Z",
        ageMinutes: 5,
        fresh: true,
        unitIssueCount: 0,
        conflictCount: 0,
        unusableFieldCount: 0,
      })),
      {
        minimumCompleteness: 0.95,
        maxAgeMinutes: 15,
        requiredSourceSystems: ["SAP", "APPIUS"],
      },
    );

    expect(quality).toMatchObject({
      availability: "COMPLETE",
      completeness: 1,
      freshness: "FRESH",
      confidenceCeiling: 1,
      requiresHumanReview: false,
      issues: [],
    });
  });

  it("rejects a derived evidence node without complete lineage", () => {
    const graph: EvidenceGraphVersion = {
      id: "graph-1",
      schemaVersion: "1.0.0",
      datasetVersion: "g1-vertical-v1",
      createdAt: "2026-08-11T00:00:00.000Z",
      nodes: [
        {
          id: "source-1",
          kind: "SOURCE",
          labelRu: "Остаток SAP",
          value: 10,
          observedAt: "2026-08-10T23:50:00.000Z",
          checksum: "source-checksum",
          sourceRef: {
            sourceSystem: "SAP",
            entityType: "MATERIAL_STOCK",
            entityId: "SAP-G1-001",
            versionOrSnapshot: "snapshot-1",
          },
        },
        {
          id: "derived-1",
          kind: "DERIVED",
          labelRu: "Прогнозный остаток",
          value: 7,
          observedAt: "2026-08-11T00:00:00.000Z",
          checksum: "derived-checksum",
          serviceVersion: "forecast-engine-1.0.0",
          ruleOrModelVersion: "naive-1.0.0",
          inputNodeIds: ["source-1"],
        },
      ],
      edges: [],
    };

    expect(validateEvidenceGraph(graph)).toEqual({
      valid: false,
      errors: ["Derived-узел derived-1 не имеет lineage edge для source-1."],
    });
    expect(
      validateEvidenceGraph({
        ...graph,
        edges: [
          {
            id: "edge-1",
            fromNodeId: "source-1",
            toNodeId: "derived-1",
            kind: "DERIVED_FROM",
          },
        ],
      }),
    ).toEqual({ valid: true, errors: [] });
  });
});
