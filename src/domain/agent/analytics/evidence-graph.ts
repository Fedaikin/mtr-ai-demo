export const EVIDENCE_NODE_KINDS = ["SOURCE", "OBSERVATION", "DERIVED", "ASSUMPTION"] as const;
export type EvidenceNodeKind = (typeof EVIDENCE_NODE_KINDS)[number];

export const EVIDENCE_EDGE_KINDS = [
  "SUPPORTS",
  "CONTRADICTS",
  "DERIVED_FROM",
  "DEPENDS_ON",
] as const;
export type EvidenceEdgeKind = (typeof EVIDENCE_EDGE_KINDS)[number];

interface EvidenceNodeBase {
  readonly id: string;
  readonly kind: EvidenceNodeKind;
  readonly labelRu: string;
  readonly value: unknown;
  readonly observedAt: string;
  readonly checksum: string;
}

export interface SourceEvidenceNode extends EvidenceNodeBase {
  readonly kind: "SOURCE" | "OBSERVATION";
  readonly sourceRef: {
    readonly sourceSystem: string;
    readonly entityType: string;
    readonly entityId: string;
    readonly versionOrSnapshot: string;
  };
}

export interface DerivedEvidenceNode extends EvidenceNodeBase {
  readonly kind: "DERIVED";
  readonly serviceVersion: string;
  readonly ruleOrModelVersion: string;
  readonly inputNodeIds: readonly string[];
}

export interface AssumptionEvidenceNode extends EvidenceNodeBase {
  readonly kind: "ASSUMPTION";
  readonly reasonRu: string;
}

export type EvidenceNode = SourceEvidenceNode | DerivedEvidenceNode | AssumptionEvidenceNode;

export interface EvidenceEdge {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly kind: EvidenceEdgeKind;
}

export interface EvidenceGraphVersion {
  readonly id: string;
  readonly schemaVersion: "1.0.0";
  readonly datasetVersion: string;
  readonly createdAt: string;
  readonly nodes: readonly EvidenceNode[];
  readonly edges: readonly EvidenceEdge[];
}

export interface EvidenceGraphValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validateEvidenceGraph(graph: EvidenceGraphVersion): EvidenceGraphValidation {
  const errors: string[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  for (const node of graph.nodes) {
    if (!node.id.trim() || nodeIds.has(node.id)) errors.push(`Некорректный node id: ${node.id}`);
    nodeIds.add(node.id);
    if (!node.checksum.trim()) errors.push(`Узел ${node.id} не содержит checksum.`);
    if (!Number.isFinite(Date.parse(node.observedAt))) {
      errors.push(`Узел ${node.id} содержит некорректное observedAt.`);
    }
    if (node.kind === "DERIVED") {
      if (!node.serviceVersion.trim() || !node.ruleOrModelVersion.trim()) {
        errors.push(`Derived-узел ${node.id} не содержит versioned provenance.`);
      }
      if (node.inputNodeIds.length === 0) errors.push(`Derived-узел ${node.id} не содержит inputs.`);
    }
  }

  for (const edge of graph.edges) {
    if (!edge.id.trim() || edgeIds.has(edge.id)) errors.push(`Некорректный edge id: ${edge.id}`);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
      errors.push(`Ребро ${edge.id} ссылается на отсутствующий узел.`);
    }
  }

  for (const node of graph.nodes) {
    if (node.kind !== "DERIVED") continue;
    for (const inputNodeId of node.inputNodeIds) {
      if (!nodeIds.has(inputNodeId)) errors.push(`Derived-узел ${node.id} потерял input ${inputNodeId}.`);
      const hasLineageEdge = graph.edges.some(
        (edge) =>
          edge.fromNodeId === inputNodeId &&
          edge.toNodeId === node.id &&
          edge.kind === "DERIVED_FROM",
      );
      if (!hasLineageEdge) errors.push(`Derived-узел ${node.id} не имеет lineage edge для ${inputNodeId}.`);
    }
  }

  return { valid: errors.length === 0, errors };
}
