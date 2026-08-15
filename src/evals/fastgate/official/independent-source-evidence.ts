import { canonicalJson, sha256Hex } from "@/evals/fastgate/official/attestation";
import type { IndependentConnectorSourceEvidence } from "@/evals/fastgate/official/connector-witness";
import type { FastGateOracleSnapshot } from "@/evals/fastgate/types";
import type { UniversalReadCapabilityKey } from "@/application/agent-orchestrator/universal-chat/capability-registry";

interface SourceRecord {
  readonly id: string;
  readonly snapshotIds: readonly string[];
  readonly value: unknown;
}

const corpusCommitmentCache = new WeakMap<FastGateOracleSnapshot, Map<string, Readonly<{
  id: string;
  hash: string;
}>>>();

/**
 * Selects a source commitment only from the witness-owned read-only corpus.
 * Deliberately has no output/result argument: an application response cannot
 * manufacture the row identities, snapshots, or corpus digest it is bound to.
 */
export function selectIndependentSourceEvidence(input: Readonly<{
  oracle: FastGateOracleSnapshot;
  capabilityKey: UniversalReadCapabilityKey;
  capabilityInput: unknown;
}>): IndependentConnectorSourceEvidence {
  const query = record(input.capabilityInput);
  const sourceRows = sourceRecords(input.oracle, input.capabilityKey, query);
  const corpus = corpusCommitment(input.oracle, input.capabilityKey);
  const snapshots = new Set<string>([input.oracle.datasetVersion]);
  sourceRows.forEach((row) => row.snapshotIds.forEach((snapshot) => snapshots.add(snapshot)));
  const snapshotIds = [...snapshots].sort((left, right) => left.localeCompare(right, "en"));
  return Object.freeze({
    sourceSnapshotId: input.oracle.datasetVersion,
    sourceRowIds: Object.freeze([corpus.id, ...sourceRows.map((row) => row.id)]),
    sourceRowHashes: Object.freeze([
      corpus.hash,
      ...sourceRows.map((row) => sha256Hex(canonicalJson(row.value))),
    ]),
    snapshotIds: Object.freeze(snapshotIds),
  });
}

function sourceRecords(
  oracle: FastGateOracleSnapshot,
  capabilityKey: UniversalReadCapabilityKey,
  query: Record<string, unknown>,
): SourceRecord[] {
  if (capabilityKey.startsWith("material.") || capabilityKey.startsWith("catalog.")
    || capabilityKey.startsWith("compatibility.") || capabilityKey.startsWith("reliability.")) {
    const requestedCodes = new Set([
      text(query.materialCode),
      text(query.sourceMaterialCode),
      text(query.candidateMaterialCode),
    ].filter(Boolean));
    const searchText = capabilityKey === "material.search" ? text(query.query).toLocaleLowerCase("ru-RU") : "";
    const corpus = requestedCodes.size
      ? oracle.materials.filter((material) => requestedCodes.has(material.code))
      : searchText
        ? oracle.materials.filter((material) => `${material.code} ${material.name}`.toLocaleLowerCase("ru-RU").includes(searchText))
        : [];
    return corpus.map((material) => ({
      id: `material:${material.code}`,
      snapshotIds: [material.snapshotId, material.snapshotAt, material.reliability.observedAt],
      value: material,
    }));
  }
  if (capabilityKey.startsWith("specification.")) {
    const projectId = text(query.projectId);
    const specificationId = text(query.specificationId);
    const specifications = oracle.specifications.filter((item) =>
      (!projectId || item.projectId === projectId) && (!specificationId || item.id === specificationId));
    const intakes = oracle.intakes.filter((item) => !projectId || item.projectId === projectId);
    return [
      ...specifications.map((item) => ({ id: `specification:${item.id}`, snapshotIds: [oracle.datasetVersion], value: item })),
      ...intakes.map((item) => ({ id: `intake:${item.id}`, snapshotIds: [item.receivedAt], value: item })),
    ];
  }
  if (capabilityKey.startsWith("project.") || capabilityKey.startsWith("deadline.")
    || capabilityKey.startsWith("analysis.")) {
    const projectId = text(query.projectId);
    const projects = oracle.projects.filter((item) => !projectId || item.id === projectId);
    const projectIds = new Set(projects.map((item) => item.id));
    return [
      ...projects.map((item) => ({ id: `project:${item.id}`, snapshotIds: [oracle.datasetVersion], value: item })),
      ...oracle.specifications.filter((item) => projectIds.has(item.projectId))
        .map((item) => ({ id: `specification:${item.id}`, snapshotIds: [oracle.datasetVersion], value: item })),
      ...oracle.shortages.filter((item) => projectIds.has(item.projectId))
        .map((item) => ({ id: `coverage:${item.projectId}:${item.materialCode}`, snapshotIds: [oracle.datasetVersion], value: item })),
      ...oracle.deadlines.filter((item) => projectIds.has(item.projectId))
        .map((item, index) => ({ id: `deadline:${item.projectId}:${index}`, snapshotIds: [item.dueAt], value: item })),
    ];
  }
  const processRows: SourceRecord[] = oracle.intakes.map((item) => ({
    id: `intake:${item.id}`,
    snapshotIds: [item.receivedAt],
    value: item,
  }));
  if (oracle.lastCompletedRun) {
    processRows.push({
      id: `run:${oracle.lastCompletedRun.id}`,
      snapshotIds: [oracle.datasetVersion],
      value: oracle.lastCompletedRun,
    });
  }
  return processRows;
}

function corpusCommitment(
  oracle: FastGateOracleSnapshot,
  capabilityKey: UniversalReadCapabilityKey,
): Readonly<{ id: string; hash: string }> {
  const group = sourceGroup(capabilityKey);
  const cached = corpusCommitmentCache.get(oracle)?.get(group);
  if (cached) return cached;
  const rows = completeCorpusRecords(oracle, group);
  const value = Object.freeze({
    id: `corpus:${group}:${rows.length}:${oracle.datasetVersion}`,
    hash: sha256Hex(canonicalJson(rows.map((row) => ({ id: row.id, value: row.value })))),
  });
  const byGroup = corpusCommitmentCache.get(oracle) ?? new Map();
  byGroup.set(group, value);
  corpusCommitmentCache.set(oracle, byGroup);
  return value;
}

function completeCorpusRecords(oracle: FastGateOracleSnapshot, group: string): SourceRecord[] {
  if (group === "materials") {
    return oracle.materials.map((material) => ({
      id: `material:${material.code}`,
      snapshotIds: [material.snapshotId, material.snapshotAt, material.reliability.observedAt],
      value: material,
    }));
  }
  if (group === "specifications") {
    return [
      ...oracle.specifications.map((item) => ({ id: `specification:${item.id}`, snapshotIds: [oracle.datasetVersion], value: item })),
      ...oracle.intakes.map((item) => ({ id: `intake:${item.id}`, snapshotIds: [item.receivedAt], value: item })),
    ];
  }
  if (group === "projects") {
    return [
      ...oracle.projects.map((item) => ({ id: `project:${item.id}`, snapshotIds: [oracle.datasetVersion], value: item })),
      ...oracle.specifications.map((item) => ({ id: `specification:${item.id}`, snapshotIds: [oracle.datasetVersion], value: item })),
      ...oracle.shortages.map((item) => ({ id: `coverage:${item.projectId}:${item.materialCode}`, snapshotIds: [oracle.datasetVersion], value: item })),
      ...oracle.deadlines.map((item, index) => ({ id: `deadline:${item.projectId}:${index}`, snapshotIds: [item.dueAt], value: item })),
    ];
  }
  return sourceRecords(oracle, "process.getQueue", {});
}

function sourceGroup(key: UniversalReadCapabilityKey): string {
  if (key.startsWith("material.") || key.startsWith("catalog.") || key.startsWith("compatibility.") || key.startsWith("reliability.")) return "materials";
  if (key.startsWith("specification.")) return "specifications";
  if (key.startsWith("project.") || key.startsWith("deadline.") || key.startsWith("analysis.")) return "projects";
  return "process";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
