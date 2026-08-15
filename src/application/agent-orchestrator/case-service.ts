import "server-only";

import { createHash } from "node:crypto";

import {
  can,
  requirePermission,
  type TrustedRequestContext,
} from "@/application/authorization-service";
import {
  type AgentCaseContextSnapshot,
  type AgentCaseRecord,
  type AgentCaseStatus,
  type AgentEvidenceFactRecord,
  type AgentEvidenceFreshness,
  type PublicAgentCase,
  type PublicAgentEvidenceFact,
} from "@/domain/agent/case";
import {
  AGENT_EVIDENCE_SOURCE_SYSTEMS,
  type AgentEvidenceSourceSystem,
} from "@/domain/agent/evidence";
import { redactSensitiveRecord } from "@/lib/redaction";

export interface CreateAgentCaseInput {
  readonly title: string;
  readonly threadId?: string;
  readonly contextSnapshot?: AgentCaseContextSnapshot;
  readonly requestKey: string;
}

export interface AppendAgentEvidenceInput {
  readonly kind: string;
  readonly summary: string;
  readonly sourceSystem: AgentEvidenceSourceSystem;
  readonly entityId: string;
  readonly versionOrSnapshot: string;
  readonly clauseId?: string | null;
  readonly observedAt: string;
  readonly sourceSnapshotAt: string;
  readonly freshness: AgentEvidenceFreshness;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly accessAttributes?: Readonly<Record<string, unknown>>;
}

export interface AgentCaseStore {
  createOrGet(input: AgentCaseRecord, idempotencyKey: string): Promise<AgentCaseRecord>;
  getOwned(id: string, subjectId: string, projectId: string): Promise<AgentCaseRecord | null>;
  listOwned(subjectId: string, projectId: string): Promise<readonly AgentCaseRecord[]>;
  appendEvidence(input: AgentEvidenceFactRecord): Promise<AgentEvidenceFactRecord>;
  listEvidence(caseId: string, subjectId: string, projectId: string): Promise<readonly AgentEvidenceFactRecord[]>;
  updateStatus(id: string, subjectId: string, projectId: string, version: number, status: AgentCaseStatus, updatedAt: string): Promise<AgentCaseRecord>;
}

export class AgentCaseService {
  constructor(
    private readonly store: AgentCaseStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(input: CreateAgentCaseInput, context: TrustedRequestContext): Promise<AgentCaseRecord> {
    requirePermission(context, "agent.chat");
    requirePermission(context, "project.read");
    const projectId = activeProject(context);
    const title = safeText(input.title, 240);
    const requestKey = safeIdentifier(input.requestKey, 200);
    validateContextSnapshot(input.contextSnapshot);
    const timestamp = this.now().toISOString();
    const idempotencyKey = hash([
      context.subjectId,
      projectId,
      requestKey,
      JSON.stringify(input.contextSnapshot ?? {}),
    ]);
    const record: AgentCaseRecord = {
      id: `case-${idempotencyKey.slice(0, 24)}`,
      tenantId: "demo-tenant-001",
      projectId,
      ownerSubjectId: context.subjectId,
      threadId: input.threadId ? safeIdentifier(input.threadId, 200) : null,
      status: "DRAFT",
      title,
      contextSnapshot: Object.freeze({ ...(input.contextSnapshot ?? {}) }),
      authorizationVersion: context.authorizationVersion,
      roleAssignmentSnapshot: Object.freeze([...context.activeRoleAssignmentIds]),
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    return this.store.createOrGet(record, idempotencyKey);
  }

  async get(id: string, context: TrustedRequestContext): Promise<PublicAgentCase | null> {
    requirePermission(context, "agent.chat");
    const projectId = activeProject(context);
    const record = await this.store.getOwned(safeIdentifier(id, 200), context.subjectId, projectId);
    if (!record || !canReadCase(record, context)) return null;
    const facts = await this.store.listEvidence(record.id, context.subjectId, projectId);
    const visible = facts.filter((fact) => canReadEvidence(fact, context));
    return publicCase(record, visible, facts.length - visible.length);
  }

  async list(context: TrustedRequestContext): Promise<readonly PublicAgentCase[]> {
    requirePermission(context, "agent.chat");
    const projectId = activeProject(context);
    const records = await this.store.listOwned(context.subjectId, projectId);
    const output: PublicAgentCase[] = [];
    for (const record of records) {
      if (!canReadCase(record, context)) continue;
      const facts = await this.store.listEvidence(record.id, context.subjectId, projectId);
      const visible = facts.filter((fact) => canReadEvidence(fact, context));
      output.push(publicCase(record, visible, facts.length - visible.length));
    }
    return Object.freeze(output);
  }

  async appendEvidence(
    caseId: string,
    input: AppendAgentEvidenceInput,
    context: TrustedRequestContext,
  ): Promise<PublicAgentEvidenceFact> {
    requirePermission(context, "agent.chat");
    const projectId = activeProject(context);
    const record = await this.store.getOwned(safeIdentifier(caseId, 200), context.subjectId, projectId);
    if (!record || !canReadCase(record, context)) throw new AgentCaseServiceError("AGENT_CASE_NOT_FOUND");
    requireEvidencePermission(input.sourceSystem, context);
    validateEvidence(input);
    const fingerprint = hash([
      record.id,
      input.sourceSystem,
      input.entityId,
      input.versionOrSnapshot,
      input.clauseId ?? "",
      input.kind,
    ]);
    const timestamp = this.now().toISOString();
    const fact: AgentEvidenceFactRecord = {
      id: `evidence-${fingerprint.slice(0, 24)}`,
      tenantId: record.tenantId,
      projectId,
      caseId: record.id,
      kind: safeText(input.kind, 120),
      summary: safeText(input.summary, 500),
      sourceSystem: input.sourceSystem,
      entityId: safeIdentifier(input.entityId, 240),
      versionOrSnapshot: safeIdentifier(input.versionOrSnapshot, 240),
      clauseId: input.clauseId ? safeIdentifier(input.clauseId, 240) : null,
      observedAt: input.observedAt,
      sourceSnapshotAt: input.sourceSnapshotAt,
      freshness: input.freshness,
      payload: Object.freeze(redactSensitiveRecord({ ...(input.payload ?? {}) })),
      accessAttributes: Object.freeze({ ...(input.accessAttributes ?? {}) }),
      fingerprint,
      authorizationVersion: context.authorizationVersion,
      roleAssignmentSnapshot: Object.freeze([...context.activeRoleAssignmentIds]),
      createdBySubjectId: context.subjectId,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    if (!canReadEvidence(fact, context)) throw new AgentCaseServiceError("AGENT_EVIDENCE_SCOPE_DENIED");
    return publicEvidence(await this.store.appendEvidence(fact));
  }

  async close(caseId: string, context: TrustedRequestContext): Promise<AgentCaseRecord> {
    requirePermission(context, "agent.chat");
    const projectId = activeProject(context);
    const record = await this.store.getOwned(safeIdentifier(caseId, 200), context.subjectId, projectId);
    if (!record || !canReadCase(record, context)) throw new AgentCaseServiceError("AGENT_CASE_NOT_FOUND");
    if (record.status === "CLOSED") return record;
    return this.store.updateStatus(record.id, context.subjectId, projectId, record.version, "CLOSED", this.now().toISOString());
  }
}

export class AgentCaseServiceError extends Error {
  constructor(
    readonly code:
      | "AGENT_CASE_PROJECT_REQUIRED"
      | "AGENT_CASE_VALIDATION_ERROR"
      | "AGENT_CASE_NOT_FOUND"
      | "AGENT_EVIDENCE_SCOPE_DENIED",
  ) {
    super("Кейс МТР недоступен");
    this.name = "AgentCaseServiceError";
  }
}

function activeProject(context: TrustedRequestContext): string {
  if (!context.activeProjectId) throw new AgentCaseServiceError("AGENT_CASE_PROJECT_REQUIRED");
  return context.activeProjectId;
}

function canReadCase(record: AgentCaseRecord, context: TrustedRequestContext): boolean {
  return can(context, "agent.chat", {
    resourceType: "AGENT_CASE",
    resourceId: record.id,
    projectId: record.projectId,
    ownerUserId: record.ownerSubjectId,
    status: record.status,
  });
}

export function canReadEvidence(
  fact: AgentEvidenceFactRecord,
  context: TrustedRequestContext,
): boolean {
  if (fact.projectId !== context.activeProjectId) return false;
  if (!hasEvidencePermission(fact.sourceSystem, context)) return false;
  const attributes = fact.accessAttributes;
  if (attributes.deny === true) return false;
  const sourceScopeId = stringAttribute(attributes.sourceScopeId);
  if (sourceScopeId && !context.sourceScopeIds.includes(sourceScopeId)) return false;
  const catalogScopeId = stringAttribute(attributes.catalogScopeId);
  if (catalogScopeId && !context.catalogScopeIds.includes(catalogScopeId)) return false;
  const warehouseId = stringAttribute(attributes.warehouseId);
  if (warehouseId && !(context.accessClaims.warehouseIds ?? []).includes(warehouseId)) return false;
  const allowedUserIds = arrayAttribute(attributes.allowedUserIds);
  return allowedUserIds.length === 0 || allowedUserIds.includes(context.subjectId);
}

function hasEvidencePermission(
  sourceSystem: AgentEvidenceSourceSystem,
  context: TrustedRequestContext,
): boolean {
  if (sourceSystem === "SAP") return can(context, "stock.search");
  if (sourceSystem === "APPIUS") return can(context, "specification.read");
  if (sourceSystem === "CATALOG") return can(context, "catalog.read");
  if (sourceSystem === "RAG" || sourceSystem === "NORMATIVE") return can(context, "analysis.read");
  if (sourceSystem === "TASK_STORE") return can(context, "review.read");
  if (
    sourceSystem === "METRIC_REGISTRY" ||
    sourceSystem === "TELEMETRY" ||
    sourceSystem === "PROCESS_ENGINE"
  ) return can(context, "project.read");
  return can(context, "agent.chat");
}

function publicCase(
  record: AgentCaseRecord,
  facts: readonly AgentEvidenceFactRecord[],
  revokedEvidenceCount: number,
): PublicAgentCase {
  return {
    id: record.id,
    projectId: record.projectId,
    ownerSubjectId: record.ownerSubjectId,
    threadId: record.threadId,
    status: record.status,
    title: record.title,
    contextSnapshot: publicContextSnapshot(record.contextSnapshot),
    authorizationVersion: record.authorizationVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    version: record.version,
    evidence: Object.freeze(facts.map(publicEvidence)),
    revokedEvidenceCount,
  };
}

function publicContextSnapshot(
  snapshot: AgentCaseContextSnapshot,
): PublicAgentCase["contextSnapshot"] {
  const { analysisHistory, ...selection } = snapshot;
  if (!analysisHistory) return selection;
  return {
    ...selection,
    analysisHistory: {
      schemaVersion: analysisHistory.schemaVersion,
      summary: analysisHistory.summary,
      confidence: analysisHistory.confidence,
      requiresHumanReview: analysisHistory.requiresHumanReview,
      generatedAt: analysisHistory.generatedAt,
      datasetVersion: analysisHistory.datasetVersion,
      semanticRegistryVersion: analysisHistory.semanticRegistryVersion,
      forecastModelVersion: analysisHistory.forecastModelVersion,
      recommendation: analysisHistory.recommendation,
      previousCaseId: analysisHistory.previousCaseId,
      changedConclusion: analysisHistory.changedConclusion,
      sourceCount: analysisHistory.sourceCount,
    },
  };
}

function publicEvidence(fact: AgentEvidenceFactRecord): PublicAgentEvidenceFact {
  return {
    id: fact.id,
    kind: fact.kind,
    summary: fact.summary,
    sourceSystem: fact.sourceSystem,
    entityId: fact.entityId,
    versionOrSnapshot: fact.versionOrSnapshot,
    clauseId: fact.clauseId,
    observedAt: fact.observedAt,
    sourceSnapshotAt: fact.sourceSnapshotAt,
    freshness: fact.freshness,
  };
}

function validateContextSnapshot(snapshot: AgentCaseContextSnapshot | undefined): void {
  if (!snapshot) return;
  for (const value of [snapshot.specificationId, snapshot.positionId, snapshot.runId]) {
    if (value !== undefined) safeIdentifier(value, 200);
  }
  if (snapshot.period) {
    const from = Date.parse(snapshot.period.from);
    const to = Date.parse(snapshot.period.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) invalid();
  }
}

function validateEvidence(input: AppendAgentEvidenceInput): void {
  if (!(AGENT_EVIDENCE_SOURCE_SYSTEMS as readonly string[]).includes(input.sourceSystem)) invalid();
  const observed = Date.parse(input.observedAt);
  const snapshot = Date.parse(input.sourceSnapshotAt);
  if (!Number.isFinite(observed) || !Number.isFinite(snapshot) || snapshot > observed) invalid();
}

function requireEvidencePermission(
  sourceSystem: AgentEvidenceSourceSystem,
  context: TrustedRequestContext,
): void {
  if (sourceSystem === "SAP") return requirePermission(context, "stock.search");
  if (sourceSystem === "APPIUS") return requirePermission(context, "specification.read");
  if (sourceSystem === "RAG") return requirePermission(context, "analysis.read");
  if (sourceSystem === "TASK_STORE") return requirePermission(context, "review.read");
  if (sourceSystem === "METRIC_REGISTRY" || sourceSystem === "TELEMETRY") {
    return requirePermission(context, "project.read");
  }
  return requirePermission(context, "agent.chat");
}

function safeText(value: string, max: number): string {
  const safe = value.replace(/[\u0000-\u001f\u007f]/gu, "").trim();
  if (!safe || safe.length > max) invalid();
  return safe;
}

function safeIdentifier(value: string, max: number): string {
  const safe = value.trim();
  if (!safe || safe.length > max || /[\u0000-\u001f\u007f]/u.test(safe)) invalid();
  return safe;
}

function stringAttribute(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function arrayAttribute(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function hash(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}

function invalid(): never {
  throw new AgentCaseServiceError("AGENT_CASE_VALIDATION_ERROR");
}
