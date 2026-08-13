import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import {
  DEMO_USER_DISPLAY_NAME,
  type AnalogueRule,
  type DemoUser,
  type GroundedCitation,
  type IntegrationState,
  type IntegrationStatus,
  type IntegrationSystem,
  type Position,
  type ResponsibilityRule,
  type SapMaterial,
  type ScenarioDefinition,
  type ScenarioRun,
  type ScenarioRunStatus,
  type ScenarioRunStep,
  type Specification,
  type SpecificationVersion,
  type UserRole,
} from "@/domain/models";
import {
  CATALOGUE_CATEGORIES,
  type CatalogueCategory,
  type CatalogueItemKind,
} from "@/domain/catalogue";
import { redactSensitiveRecord } from "@/lib/redaction";
import type {
  CatalogAssemblyBom,
  CatalogBomComponent,
  CatalogFamily,
  CatalogItem,
  CatalogItemWithStock,
  CatalogSearchQuery,
  CatalogSearchResult,
  CatalogStockBalance,
  CatalogStockSummary,
  CatalogSubstituteResult,
} from "@/ports";

import { getSeedCounts, resetDemoDatabase, type SeedCounts } from "./bootstrap";
import { type Database, getDatabase } from "./db";
import {
  analysisReviewDecisions,
  agentCitations,
  agentMessages,
  agentThreads,
  analogueRules,
  authSessions,
  auditLogs,
  catalogBomComponents,
  catalogInterchangeabilityFamilies,
  catalogItems,
  catalogStockBalances,
  dictionaries,
  integrationStates,
  normativeChunks,
  normativeDocuments,
  positionAnalysisResults,
  promptVersions,
  responsibilityRules,
  sapMaterials,
  sapStockBalances,
  scenarioRuns,
  scenarioRunSteps,
  scenarios,
  specificationPositions,
  specificationVersions,
  specifications,
  uploadedFiles,
  users,
} from "./schema";

export interface PositionQuery {
  specificationId?: string;
  versionId?: string;
  currentOnly?: boolean;
  equipmentType?: string;
  limit?: number;
  offset?: number;
}

export interface SapMaterialQuery {
  text?: string;
  equipmentType?: string;
  materialCode?: string;
  limit?: number;
  offset?: number;
  /** OData-compatible aliases used by the SAP mock port. */
  top?: number;
  skip?: number;
}

export interface SapSearchResult {
  items: SapMaterial[];
  total: number;
  snapshotAt: string;
  nextOffset?: number;
  nextSkip?: number;
}

export interface CatalogOverview {
  items: number;
  components: number;
  assemblies: number;
  families: number;
  stockBalanceRows: number;
  stockedItems: number;
  multiWarehouseItems: number;
  bomLinks: number;
  totalAvailableQuantity: number;
  latestSnapshotAt: string | null;
}

export interface IntegrationStateRecord extends IntegrationState {
  settings: Record<string, unknown>;
  version: number;
}

export interface IntegrationStateUpdate {
  state: IntegrationStatus;
  delayMs?: number;
  snapshotAt?: string | null;
  lastSynchronizedAt?: string | null;
  safeMessage?: string | null;
  settings?: Record<string, unknown>;
}

export interface ScenarioDefinitionRecord extends ScenarioDefinition {
  configuration: Record<string, unknown>;
}

export interface CreateScenarioRunInput {
  id?: string;
  projectId?: string;
  scenarioId: string;
  specificationId: string;
  retryOfRunId?: string;
  status?: ScenarioRunStatus;
  currentStep?: string;
  progress?: number;
  mode?: "NORMAL" | "DRY_RUN";
  seed?: string;
  startedAt?: string;
  completedAt?: string;
  inputSnapshot?: Record<string, unknown>;
  outputSnapshot?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export interface ScenarioRunUpdate {
  status?: ScenarioRunStatus;
  currentStep?: string;
  progress?: number;
  startedAt?: string | null;
  completedAt?: string | null;
  outputSnapshot?: Record<string, unknown>;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface ScenarioRunQuery {
  projectId?: string;
  scenarioId?: string;
  status?: ScenarioRunStatus;
  limit?: number;
  offset?: number;
  /** List screens do not need persisted step bodies; omitting them removes a DB waterfall. */
  includeSteps?: boolean;
}

export interface UpsertScenarioStepInput {
  id?: string;
  runId: string;
  status: ScenarioRunStatus;
  label: string;
  outcome: "STARTED" | "COMPLETED" | "FAILED" | "CANCELLED";
  startedAt: string;
  completedAt?: string | null;
  durationMs?: number | null;
  details?: Record<string, unknown>;
  idempotencyKey: string;
}

export interface ClaimScenarioStepInput extends UpsertScenarioStepInput {
  outcome: "STARTED";
  runPatch: ScenarioRunUpdate;
}

export interface FinishScenarioStepTransitionInput extends UpsertScenarioStepInput {
  outcome: "COMPLETED" | "FAILED";
  runPatch: ScenarioRunUpdate;
}

export interface ScenarioStepTransitionResult {
  run: ScenarioRun;
  step: ScenarioRunStep;
  terminalStaged: boolean;
}

export interface SaveAnalysisResultInput {
  id?: string;
  runId: string;
  positionId: string;
  responsibility: "CUSTOMER" | "CONTRACTOR";
  responsibilityConfidence: number;
  responsibilityCitation: Record<string, unknown>;
  matchCategory: string;
  matchScore: number;
  matchedMaterialCode?: string | null;
  status: string;
  requiresHumanReview: boolean;
  result: Record<string, unknown>;
  sourceKind?: "CANONICAL" | "MANUAL_IMPORT";
}

export interface SaveAnalysisResultsOptions {
  expectedRunVersion?: number;
  expectedRunStatus?: ScenarioRunStatus;
}

export interface PromoteSpecificationVersionInput {
  specificationId: string;
  expectedCurrentVersionId?: string;
  effectiveAt?: string;
  eventId?: string;
}

export interface PromoteSpecificationVersionResult {
  previousVersion: SpecificationVersion;
  currentVersion: SpecificationVersion;
}

export interface AnalysisResultRecord extends SaveAnalysisResultInput {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface OverrideAnalysisResponsibilityInput {
  runId: string;
  positionId: string;
  responsibility: "CUSTOMER" | "CONTRACTOR";
  reason: string;
  expectedVersion?: number;
  actorDisplayName?: string;
}

export interface AuditLogInput {
  id?: string;
  actorDisplayName?: string;
  action: string;
  entityType: string;
  entityId?: string;
  outcome: "SUCCESS" | "FAILURE" | string;
  details?: Record<string, unknown>;
  occurredAt?: string;
  retentionUntil?: string;
  requestId?: string;
}

/**
 * Server-side filters for the bounded admin agent-operation journal. Every
 * query is additionally scoped by the trusted session user in the repository.
 */
export interface AgentAuditOperationQuery {
  from?: string;
  to?: string;
  user?: string;
  scenario?: string;
  tool?: string;
  status?: "SUCCESS" | "FAILURE";
  errorType?: string;
  correlationId?: string;
  limit?: number;
  offset?: number;
}

export interface AgentAuditOperationPage {
  entries: Array<typeof auditLogs.$inferSelect>;
  total: number;
  limit: number;
  offset: number;
}

/** Aggregate audit facts used by the dashboard; scenario/integration state is
 * deliberately composed in the application layer. */
export interface AgentAuditMetricsRecord {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseMs: number | null;
  p50ResponseMs: number | null;
  p95ResponseMs: number | null;
  toolCalls: number;
  retries: number;
  expertReviews: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

export interface PromptVersionRecord {
  id: string;
  userId: string;
  name: string;
  promptVersion: string;
  content: string;
  active: boolean;
  checksum: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreatePromptVersionInput {
  id?: string;
  name: string;
  promptVersion: string;
  content: string;
  active?: boolean;
}

export interface DictionaryRecord {
  id: string;
  userId: string;
  dictionaryType: string;
  key: string;
  values: string[];
  active: boolean;
  version: number;
}

export interface DictionaryUpdateInput {
  values?: string[];
  active?: boolean;
}

export interface UploadedFileInput {
  id?: string;
  originalName: string;
  safeName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  storageUrl: string;
  parseStatus: string;
  normalizedData?: Record<string, unknown> | null;
}

export interface SpecificationImportPositionInput {
  internalCode: string;
  nameRu: string;
  requiredQuantity: number;
  unit: string;
  equipmentType?: string;
  standard?: string;
  materialGrade?: string;
  dimensions?: Record<string, string | number | boolean | null>;
}

export interface PublishSpecificationImportInput {
  fileId: string;
  mode: "NEW" | "NEW_VERSION";
  projectCode?: string;
  name?: string;
  specificationId?: string;
  positions: SpecificationImportPositionInput[];
  validationSummary: Record<string, unknown>;
}

export interface AnalysisReviewSeed {
  resultId: string;
  runId: string;
  positionId: string;
  exact: boolean;
  agentEvidence: Record<string, unknown>;
  independentEvidence: Record<string, unknown>;
}

export interface AgentMessageInput {
  id?: string;
  threadId: string;
  role: "user" | "assistant" | "system" | string;
  content: string;
  structuredOutput?: Record<string, unknown>;
  promptVersion?: string;
  citations?: GroundedCitation[];
}

export interface RepositoryCounts extends SeedCounts {
  scenarioRuns: number;
  scenarioSteps: number;
  analysisResults: number;
  auditLogs: number;
  uploadedFiles: number;
  agentThreads: number;
  agentMessages: number;
}

export interface AuthUserRecord extends DemoUser {
  login: string;
  passwordHash: string;
  status: string;
  accountType: string;
  authorizationVersion: number;
  isSyntheticDemo: boolean;
}

export interface AuthSessionRecord {
  id: string;
  user: DemoUser;
  expiresAt: string;
}

export class OptimisticLockError extends Error {
  readonly code: string = "OPTIMISTIC_LOCK_CONFLICT";

  constructor(entityId: string) {
    super(`Запись ${entityId} уже изменена другим процессом.`);
    this.name = "OptimisticLockError";
  }
}

export class ScenarioStepClaimInProgressError extends OptimisticLockError {
  readonly code = "SCENARIO_STEP_CLAIM_IN_PROGRESS";

  constructor(runId: string) {
    super(runId);
    this.message = `Шаг запуска ${runId} уже выполняется другим процессом.`;
    this.name = "ScenarioStepClaimInProgressError";
  }
}

// Controlled mock integrations are capped at 10 seconds. The persisted lease
// remains comfortably above that bound while still allowing crash recovery.
export const SCENARIO_STEP_CLAIM_LEASE_MS = 30_000;

export class ScenarioRunTerminalPersistenceError extends Error {
  readonly code = "SCENARIO_RUN_TERMINAL_PERSISTENCE_FAILED";

  constructor(runId: string, cause: unknown) {
    super(`Не удалось атомарно сохранить terminal-state и аудит запуска ${runId}.`, { cause });
    this.name = "ScenarioRunTerminalPersistenceError";
  }
}

export class ScenarioRunTransitionPersistenceError extends Error {
  readonly code = "SCENARIO_RUN_TRANSITION_PERSISTENCE_FAILED";

  constructor(runId: string, cause: unknown) {
    super(`Не удалось атомарно сохранить переход запуска ${runId}.`, { cause });
    this.name = "ScenarioRunTransitionPersistenceError";
  }
}

export class MtrRepository {
  constructor(private readonly db: Database) {}

  async findUserByLogin(login: string): Promise<AuthUserRecord | null> {
    const normalizedLogin = login.trim().toLowerCase();
    if (!normalizedLogin) return null;
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.login, normalizedLogin))
      .limit(1);
    return row
      ? {
          id: row.id,
          login: row.login,
          passwordHash: row.passwordHash,
          displayName: row.displayName,
          roles: row.roles as UserRole[],
          locale: row.locale as "ru-RU",
          status: row.status,
          accountType: row.accountType,
          authorizationVersion: row.authorizationVersion,
          isSyntheticDemo: row.isSyntheticDemo,
        }
      : null;
  }

  async createAuthSession(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: string;
    authorizationVersion?: number;
    activatedRoleAssignmentIds?: string[];
  }): Promise<AuthSessionRecord> {
    trustedUser(input.userId);
    await this.db
      .delete(authSessions)
      .where(
        and(
          eq(authSessions.userId, input.userId),
          lt(authSessions.expiresAt, new Date().toISOString()),
        ),
      );
    const [row] = await this.db
      .insert(authSessions)
      .values({ ...input, authorizationVersion: input.authorizationVersion ?? 1, activatedRoleAssignmentIds: input.activatedRoleAssignmentIds ?? [] })
      .returning();
    if (!row) throw new Error("Не удалось создать пользовательскую сессию.");
    const user = await this.getAuthUser(input.userId);
    if (!user) throw new Error("Пользователь для сессии не найден.");
    return { id: row.id, user: publicAuthUser(user), expiresAt: row.expiresAt };
  }

  async getAuthSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null> {
    if (!tokenHash) return null;
    const [row] = await this.db
      .select({ session: authSessions, user: users })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(
        and(
          eq(authSessions.tokenHash, tokenHash),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, new Date().toISOString()),
          eq(authSessions.authorizationVersion, users.authorizationVersion),
          eq(users.status, "ACTIVE"),
        ),
      )
      .limit(1);
    if (!row) return null;
    return {
      id: row.session.id,
      expiresAt: row.session.expiresAt,
      user: {
        id: row.user.id,
        login: row.user.login,
        displayName: row.user.displayName,
        roles: row.user.roles as UserRole[],
        locale: row.user.locale as "ru-RU",
        isSyntheticDemo: row.user.isSyntheticDemo,
      },
    };
  }

  async revokeAuthSession(tokenHash: string): Promise<void> {
    if (!tokenHash) return;
    await this.db
      .update(authSessions)
      .set({ revokedAt: new Date().toISOString() })
      .where(and(eq(authSessions.tokenHash, tokenHash), isNull(authSessions.revokedAt)));
  }

  private async getAuthUser(userId: string): Promise<AuthUserRecord | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    return row
      ? {
          id: row.id,
          login: row.login,
          passwordHash: row.passwordHash,
          displayName: row.displayName,
          roles: row.roles as UserRole[],
          locale: row.locale as "ru-RU",
          status: row.status,
          accountType: row.accountType,
          authorizationVersion: row.authorizationVersion,
          isSyntheticDemo: row.isSyntheticDemo,
        }
      : null;
  }

  async listSpecifications(userId: string): Promise<Specification[]> {
    trustedUser(userId);
    const rows = await this.db
      .select()
      .from(specifications)
      .where(eq(specifications.userId, userId))
      .orderBy(asc(specifications.projectCode), asc(specifications.id));
    return rows.map(toSpecification);
  }

  async publishSpecificationImport(
    userId: string,
    input: PublishSpecificationImportInput,
  ): Promise<{ specification: Specification; version: SpecificationVersion }> {
    trustedUser(userId);
    if (input.positions.length === 0) throw new Error("В файле нет валидных позиций для публикации.");
    const duplicateCodes = input.positions
      .map((position) => position.internalCode)
      .filter((code, index, all) => all.indexOf(code) !== index);
    if (duplicateCodes.length > 0) throw new Error(`Повторяются коды позиций: ${[...new Set(duplicateCodes)].slice(0, 5).join(", ")}`);

    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      const [file] = await tx.select().from(uploadedFiles).where(and(
        eq(uploadedFiles.userId, userId),
        eq(uploadedFiles.id, input.fileId),
      )).limit(1);
      if (!file) throw new Error("Загруженный файл не найден.");
      if (file.parseStatus !== "PARSED") throw new Error("Файл требует ручной проверки и не может быть опубликован.");

      const now = new Date().toISOString();
      const specificationId = input.mode === "NEW"
        ? `spec-${randomUUID()}`
        : input.specificationId?.trim();
      if (!specificationId) throw new Error("Не выбрана спецификация для новой версии.");

      let versionNumber = 1;
      if (input.mode === "NEW") {
        if (!input.projectCode?.trim() || !input.name?.trim()) {
          throw new Error("Для новой спецификации укажите проект и название.");
        }
      } else {
        const [currentSpecification] = await tx.select().from(specifications).where(and(
          eq(specifications.userId, userId),
          eq(specifications.id, specificationId),
        )).limit(1);
        if (!currentSpecification) throw new Error("Спецификация не найдена.");
        versionNumber = currentSpecification.latestVersionNumber + 1;
        await tx.update(specificationVersions).set({
          isCurrent: false,
          status: "SUPERSEDED",
          updatedAt: now,
          version: sql`${specificationVersions.version} + 1`,
        }).where(and(
          eq(specificationVersions.userId, userId),
          eq(specificationVersions.specificationId, specificationId),
          eq(specificationVersions.isCurrent, true),
        ));
      }

      const versionId = `${specificationId}-v${versionNumber}`;
      if (input.mode === "NEW") {
        await tx.insert(specifications).values({
          id: specificationId,
          userId,
          projectCode: input.projectCode!.trim().slice(0, 120),
          name: input.name!.trim().slice(0, 300),
          latestVersionId: versionId,
          latestVersionNumber: versionNumber,
          positionCount: input.positions.length,
          accessAttributes: { level: "DEMO_USER" },
          createdBy: userId,
        });
      }

      const [version] = await tx.insert(specificationVersions).values({
        id: versionId,
        specificationId,
        userId,
        versionNumber,
        isCurrent: true,
        status: "ACTIVE",
        effectiveAt: now,
        positionCount: input.positions.length,
        sourceFileId: file.id,
        sourceFileName: file.originalName,
        sourceKind: file.extension.replace(/^\./u, "").toLocaleUpperCase("ru-RU"),
        publishedBy: userId,
        publishedAt: now,
        validationSummary: input.validationSummary,
        accessAttributes: { level: "DEMO_USER" },
        createdBy: userId,
      }).returning();
      if (!version) throw new Error("Не удалось создать версию спецификации.");

      await tx.insert(specificationPositions).values(input.positions.map((position, index) => ({
        id: `position-${randomUUID()}`,
        specificationId,
        versionId,
        userId,
        internalCode: position.internalCode,
        nameRu: position.nameRu,
        synonyms: [],
        equipmentType: position.equipmentType ?? "OTHER",
        standard: position.standard,
        materialGrade: position.materialGrade,
        dimensions: position.dimensions ?? {},
        requiredQuantity: String(position.requiredQuantity),
        unit: position.unit,
        classification: { sourceRow: String(index + 1), importFileId: file.id },
        accessAttributes: { level: "DEMO_USER" },
        fixtureTags: ["USER_IMPORT"],
        isSyntheticDemo: false,
        createdBy: userId,
      })));

      if (input.mode === "NEW_VERSION") {
        await tx.update(specifications).set({
          latestVersionId: versionId,
          latestVersionNumber: versionNumber,
          positionCount: input.positions.length,
          updatedAt: now,
          version: sql`${specifications.version} + 1`,
        }).where(and(eq(specifications.userId, userId), eq(specifications.id, specificationId)));
      }

      await tx.insert(auditLogs).values({
        id: `audit-${randomUUID()}`,
        userId,
        actorDisplayName: DEMO_USER_DISPLAY_NAME,
        action: input.mode === "NEW" ? "specification.import.created" : "specification.import.version_created",
        entityType: "specification",
        entityId: specificationId,
        outcome: "SUCCESS",
        details: { fileId: file.id, fileName: file.originalName, versionId, versionNumber, positionCount: input.positions.length },
        retentionUntil: oneCalendarYearAfter(now),
      });

      const [specification] = await tx.select().from(specifications).where(and(
        eq(specifications.userId, userId),
        eq(specifications.id, specificationId),
      )).limit(1);
      if (!specification) throw new Error("Не удалось получить опубликованную спецификацию.");
      return { specification: toSpecification(specification), version: toSpecificationVersion(version) };
    });
  }

  async getSpecification(userId: string, specificationId: string): Promise<Specification | null> {
    trustedUser(userId);
    const [row] = await this.db
      .select()
      .from(specifications)
      .where(and(eq(specifications.userId, userId), eq(specifications.id, specificationId)))
      .limit(1);
    return row ? toSpecification(row) : null;
  }

  async listSpecificationVersions(
    userId: string,
    specificationId: string,
  ): Promise<SpecificationVersion[]> {
    trustedUser(userId);
    const rows = await this.db
      .select()
      .from(specificationVersions)
      .where(
        and(
          eq(specificationVersions.userId, userId),
          eq(specificationVersions.specificationId, specificationId),
        ),
      )
      .orderBy(desc(specificationVersions.versionNumber));
    return rows.map(toSpecificationVersion);
  }

  async listVersions(userId: string, specificationId: string): Promise<SpecificationVersion[]> {
    return this.listSpecificationVersions(userId, specificationId);
  }

  async getLatestSpecificationVersion(
    userId: string,
    specificationId: string,
  ): Promise<SpecificationVersion | null> {
    trustedUser(userId);
    const [row] = await this.db
      .select()
      .from(specificationVersions)
      .where(
        and(
          eq(specificationVersions.userId, userId),
          eq(specificationVersions.specificationId, specificationId),
          eq(specificationVersions.isCurrent, true),
        ),
      )
      .orderBy(desc(specificationVersions.versionNumber))
      .limit(1);
    return row ? toSpecificationVersion(row) : null;
  }

  async getLatestVersion(userId: string, specificationId: string): Promise<SpecificationVersion | null> {
    return this.getLatestSpecificationVersion(userId, specificationId);
  }

  async promoteNextSpecificationVersion(
    userId: string,
    input: PromoteSpecificationVersionInput,
  ): Promise<PromoteSpecificationVersionResult> {
    trustedUser(userId);
    const effectiveAt = input.effectiveAt ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(effectiveAt))) {
      throw new Error("Некорректная дата события новой версии Appius.");
    }
    if (input.eventId !== undefined && (!input.eventId.trim() || input.eventId.length > 200)) {
      throw new Error("Некорректный идентификатор события новой версии Appius.");
    }

    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      const [specification] = await tx
        .select()
        .from(specifications)
        .where(
          and(
            eq(specifications.userId, userId),
            eq(specifications.id, input.specificationId),
          ),
        )
        .limit(1);
      if (!specification) throw new Error("Спецификация Appius не найдена.");

      if (input.eventId) {
        const [priorEvent] = await tx
          .select({ details: auditLogs.details })
          .from(auditLogs)
          .where(and(
            eq(auditLogs.userId, userId),
            eq(auditLogs.action, "appius.new_version.promoted"),
            eq(auditLogs.entityType, "specification"),
            eq(auditLogs.entityId, input.specificationId),
            sql`${auditLogs.details} ->> 'eventId' = ${input.eventId}`,
          ))
          .limit(1);
        const details = priorEvent?.details as Record<string, unknown> | undefined;
        const previousVersionId = typeof details?.previousVersionId === "string"
          ? details.previousVersionId
          : undefined;
        const currentVersionId = typeof details?.currentVersionId === "string"
          ? details.currentVersionId
          : undefined;
        if (previousVersionId && currentVersionId) {
          const eventVersions = await tx
            .select()
            .from(specificationVersions)
            .where(and(
              eq(specificationVersions.userId, userId),
              eq(specificationVersions.specificationId, input.specificationId),
              inArray(specificationVersions.id, [previousVersionId, currentVersionId]),
            ));
          const previousVersion = eventVersions.find((item) => item.id === previousVersionId);
          const currentVersion = eventVersions.find((item) => item.id === currentVersionId);
          if (previousVersion && currentVersion) {
            return {
              previousVersion: toSpecificationVersion(previousVersion),
              currentVersion: toSpecificationVersion(currentVersion),
            };
          }
        }
      }

      const [current] = await tx
        .select()
        .from(specificationVersions)
        .where(
          and(
            eq(specificationVersions.userId, userId),
            eq(specificationVersions.specificationId, input.specificationId),
            eq(specificationVersions.isCurrent, true),
          ),
        )
        .limit(1);
      if (!current) throw new Error("Актуальная версия Appius не найдена.");
      if (
        input.expectedCurrentVersionId &&
        input.expectedCurrentVersionId !== current.id
      ) {
        throw new OptimisticLockError(current.id);
      }

      const currentPositions = await tx
        .select()
        .from(specificationPositions)
        .where(
          and(
            eq(specificationPositions.userId, userId),
            eq(specificationPositions.specificationId, input.specificationId),
            eq(specificationPositions.versionId, current.id),
          ),
        )
        .orderBy(asc(specificationPositions.id));
      if (currentPositions.length === 0) {
        throw new Error("Актуальная версия Appius не содержит позиций для переноса.");
      }

      const nextVersionNumber = current.versionNumber + 1;
      const nextVersionId = `${input.specificationId}-v${nextVersionNumber}`;
      const now = new Date().toISOString();
      const historicSnapshot = {
        schemaVersion: "1.0.0",
        capturedAt: effectiveAt,
        versionId: current.id,
        versionNumber: current.versionNumber,
        positionCount: currentPositions.length,
        positions: currentPositions.map((position) => ({
          id: position.id,
          internalCode: position.internalCode,
          nameRu: position.nameRu,
          nameEn: position.nameEn,
          synonyms: position.synonyms,
          equipmentType: position.equipmentType,
          standard: position.standard,
          materialGrade: position.materialGrade,
          dimensions: position.dimensions,
          requiredQuantity: position.requiredQuantity,
          unit: position.unit,
          classification: position.classification,
          accessAttributes: position.accessAttributes,
          fixtureTags: position.fixtureTags,
        })),
      };

      const [previousVersion] = await tx
        .update(specificationVersions)
        .set({
          isCurrent: false,
          status: "SUPERSEDED",
          historicSnapshot,
          accessAttributes: { level: "HISTORY_VIEW_ONLY" },
          updatedAt: now,
          version: sql`${specificationVersions.version} + 1`,
        })
        .where(
          and(
            eq(specificationVersions.id, current.id),
            eq(specificationVersions.userId, userId),
            eq(specificationVersions.isCurrent, true),
          ),
        )
        .returning();
      if (!previousVersion) throw new OptimisticLockError(current.id);

      const [nextVersion] = await tx
        .insert(specificationVersions)
        .values({
          id: nextVersionId,
          specificationId: input.specificationId,
          userId,
          versionNumber: nextVersionNumber,
          isCurrent: true,
          status: "ACTIVE",
          effectiveAt,
          positionCount: currentPositions.length,
          accessAttributes: { level: "DEMO_USER" },
          createdBy: userId,
        })
        .returning();
      if (!nextVersion) throw new Error("Не удалось создать новую версию Appius.");

      await tx.insert(specificationPositions).values(
        currentPositions.map((position, index) => ({
          id: `position-${input.specificationId}-v${nextVersionNumber}-${String(index + 1).padStart(3, "0")}`,
          specificationId: input.specificationId,
          versionId: nextVersionId,
          userId,
          internalCode: position.internalCode,
          nameRu: position.nameRu,
          nameEn: position.nameEn,
          synonyms: position.synonyms,
          equipmentType: position.equipmentType,
          standard: position.standard,
          materialGrade: position.materialGrade,
          dimensions: position.dimensions,
          requiredQuantity: position.requiredQuantity,
          unit: position.unit,
          classification: position.classification,
          accessAttributes: { level: "DEMO_USER" },
          fixtureTags: position.fixtureTags,
          isSyntheticDemo: true,
          createdBy: userId,
        })),
      );

      await tx
        .update(specifications)
        .set({
          latestVersionId: nextVersionId,
          latestVersionNumber: nextVersionNumber,
          positionCount: currentPositions.length,
          updatedAt: now,
          version: sql`${specifications.version} + 1`,
        })
        .where(
          and(
            eq(specifications.id, input.specificationId),
            eq(specifications.userId, userId),
          ),
        );

      await tx.insert(auditLogs).values({
        id: `audit-${randomUUID()}`,
        userId,
        actorDisplayName: DEMO_USER_DISPLAY_NAME,
        action: "appius.new_version.promoted",
        entityType: "specification",
        entityId: input.specificationId,
        outcome: "SUCCESS",
        details: {
          ...(input.eventId ? { eventId: input.eventId } : {}),
          previousVersionId: current.id,
          currentVersionId: nextVersionId,
          versionNumber: nextVersionNumber,
          positionCount: currentPositions.length,
        },
        occurredAt: effectiveAt,
        retentionUntil: oneCalendarYearAfter(effectiveAt),
      });

      return {
        previousVersion: toSpecificationVersion(previousVersion),
        currentVersion: toSpecificationVersion(nextVersion),
      };
    });
  }

  async listPositions(userId: string, options: PositionQuery = {}): Promise<Position[]> {
    trustedUser(userId);
    const conditions: SQL[] = [
      eq(specificationPositions.userId, userId),
      eq(specificationVersions.userId, userId),
      eq(specifications.userId, userId),
    ];
    if (options.specificationId) {
      conditions.push(eq(specificationPositions.specificationId, options.specificationId));
    }
    if (options.versionId) conditions.push(eq(specificationPositions.versionId, options.versionId));
    if (options.currentOnly ?? true) conditions.push(eq(specificationVersions.isCurrent, true));
    if (options.equipmentType) {
      conditions.push(eq(specificationPositions.equipmentType, options.equipmentType));
    }

    let query = this.db
      .select({
        position: specificationPositions,
        versionNumber: specificationVersions.versionNumber,
        isCurrentVersion: specificationVersions.isCurrent,
        specificationName: specifications.name,
      })
      .from(specificationPositions)
      .innerJoin(
        specificationVersions,
        eq(specificationVersions.id, specificationPositions.versionId),
      )
      .innerJoin(specifications, eq(specifications.id, specificationPositions.specificationId))
      .where(and(...conditions))
      .orderBy(asc(specificationPositions.id))
      .$dynamic();
    if (options.limit !== undefined) query = query.limit(validLimit(options.limit));
    if (options.offset !== undefined) query = query.offset(validOffset(options.offset));
    const rows = await query;
    const positions = rows.map(({ position, versionNumber, isCurrentVersion, specificationName }) => ({
      id: position.id,
      userId: position.userId,
      internalCode: position.internalCode,
      nameRu: position.nameRu,
      ...(position.nameEn ? { nameEn: position.nameEn } : {}),
      synonyms: position.synonyms,
      equipmentType: position.equipmentType,
      ...(position.standard ? { standard: position.standard } : {}),
      ...(position.materialGrade ? { materialGrade: position.materialGrade } : {}),
      dimensions: position.dimensions,
      requiredQuantity: Number(position.requiredQuantity),
      unit: position.unit,
      specificationId: position.specificationId,
      specificationName,
      versionId: position.versionId,
      versionNumber,
      isCurrentVersion,
      classification: position.classification,
      access: position.accessAttributes,
      fixtureTags: position.fixtureTags,
    }));
    if (positions.length > 0 || !options.versionId || (options.currentOnly ?? true)) {
      return positions;
    }

    const [historic] = await this.db
      .select({ version: specificationVersions, specificationName: specifications.name })
      .from(specificationVersions)
      .innerJoin(specifications, eq(specifications.id, specificationVersions.specificationId))
      .where(
        and(
          eq(specificationVersions.userId, userId),
          eq(specificationVersions.id, options.versionId),
          eq(specifications.userId, userId),
        ),
      )
      .limit(1);
    const savedPositions = historic?.version.historicSnapshot?.positions;
    if (!historic || !Array.isArray(savedPositions)) return [];
    const offset = validOffset(options.offset ?? 0);
    const limit = validLimit(options.limit ?? savedPositions.length, 500);
    return savedPositions.slice(offset, offset + limit).map((saved) => {
      const position = saved as typeof specificationPositions.$inferSelect;
      return {
        id: position.id,
        userId,
        internalCode: position.internalCode,
        nameRu: position.nameRu,
        ...(position.nameEn ? { nameEn: position.nameEn } : {}),
        synonyms: position.synonyms,
        equipmentType: position.equipmentType,
        ...(position.standard ? { standard: position.standard } : {}),
        ...(position.materialGrade ? { materialGrade: position.materialGrade } : {}),
        dimensions: position.dimensions,
        requiredQuantity: Number(position.requiredQuantity),
        unit: position.unit,
        specificationId: historic.version.specificationId,
        specificationName: historic.specificationName,
        versionId: historic.version.id,
        versionNumber: historic.version.versionNumber,
        isCurrentVersion: false,
        classification: position.classification,
        access: position.accessAttributes,
        fixtureTags: position.fixtureTags,
      };
    });
  }

  async getPosition(userId: string, positionId: string): Promise<Position | null> {
    const rows = await this.listPositions(userId, { currentOnly: false });
    return rows.find((row) => row.id === positionId) ?? null;
  }

  async listSapMaterials(userId: string, options: SapMaterialQuery = {}): Promise<SapMaterial[]> {
    const result = await this.searchSapMaterials(userId, options);
    return result.items;
  }

  async searchSapMaterials(userId: string, options: SapMaterialQuery = {}): Promise<SapSearchResult> {
    trustedUser(userId);
    const conditions = sapConditions(userId, options);
    const limit = validLimit(options.limit ?? options.top ?? 100, 500);
    const offset = validOffset(options.offset ?? options.skip ?? 0);

    const rows = await this.db
      .select({ material: sapMaterials, balance: sapStockBalances })
      .from(sapMaterials)
      .innerJoin(
        sapStockBalances,
        and(
          eq(sapStockBalances.materialId, sapMaterials.id),
          eq(sapStockBalances.userId, userId),
        ),
      )
      .where(and(...conditions))
      .orderBy(asc(sapMaterials.materialCode), asc(sapStockBalances.id))
      .limit(limit)
      .offset(offset);
    const [{ value: total = 0 } = { value: 0 }] = await this.db
      .select({ value: count() })
      .from(sapMaterials)
      .innerJoin(
        sapStockBalances,
        and(
          eq(sapStockBalances.materialId, sapMaterials.id),
          eq(sapStockBalances.userId, userId),
        ),
      )
      .where(and(...conditions));

    const items = rows.map(({ material, balance }) => toSapMaterial(material, balance));
    const numericTotal = Number(total);
    const nextOffset = offset + items.length < numericTotal ? offset + items.length : undefined;
    return {
      items,
      total: numericTotal,
      snapshotAt: items[0]?.snapshotAt ?? "",
      ...(nextOffset === undefined ? {} : { nextOffset, nextSkip: nextOffset }),
    };
  }

  async getSapMaterial(userId: string, materialCode: string): Promise<SapMaterial | null> {
    const result = await this.searchSapMaterials(userId, { materialCode, limit: 1 });
    return result.items[0] ?? null;
  }

  async getSapMaterialStock(userId: string, materialCode: string): Promise<SapMaterial[]> {
    const result = await this.searchSapMaterials(userId, { materialCode, limit: 500 });
    return result.items;
  }

  async searchCatalogItems(
    userId: string,
    options: CatalogSearchQuery = {},
  ): Promise<CatalogSearchResult> {
    trustedUser(userId);
    const conditions = catalogItemConditions(userId, options);
    const limit = validLimit(options.limit ?? 50, 200);
    const offset = validOffset(options.offset ?? 0);
    const rows = await this.db
      .select()
      .from(catalogItems)
      .where(and(...conditions))
      .orderBy(asc(catalogItems.itemCode), asc(catalogItems.id))
      .limit(limit)
      .offset(offset);
    const [{ value: total = 0 } = { value: 0 }] = await this.db
      .select({ value: count() })
      .from(catalogItems)
      .where(and(...conditions));
    const stockByItem = await this.catalogStockSummaries(
      userId,
      rows.map((row) => row.id),
    );
    const numericTotal = Number(total);
    const items = rows.map((row) => ({
      ...toCatalogItem(row),
      ...emptyCatalogStockSummary(stockByItem.get(row.id)),
    }));
    const nextOffset = offset + items.length < numericTotal ? offset + items.length : undefined;
    return {
      items,
      total: numericTotal,
      limit,
      offset,
      ...(nextOffset === undefined ? {} : { nextOffset }),
    };
  }

  async getCatalogOverview(userId: string): Promise<CatalogOverview> {
    trustedUser(userId);
    const result = await this.db.execute(sql`
      select
        (select count(*)::int from ${catalogItems}
          where ${catalogItems.userId} = ${userId}) as "items",
        (select count(*)::int from ${catalogItems}
          where ${catalogItems.userId} = ${userId} and ${catalogItems.itemKind} = 'COMPONENT') as "components",
        (select count(*)::int from ${catalogItems}
          where ${catalogItems.userId} = ${userId} and ${catalogItems.itemKind} = 'ASSEMBLY') as "assemblies",
        (select count(*)::int from ${catalogInterchangeabilityFamilies}
          where ${catalogInterchangeabilityFamilies.userId} = ${userId}
            and ${catalogInterchangeabilityFamilies.active} = true) as "families",
        (select count(*)::int from ${catalogStockBalances}
          where ${catalogStockBalances.userId} = ${userId}) as "stockBalanceRows",
        (select count(distinct ${catalogStockBalances.itemId})::int from ${catalogStockBalances}
          where ${catalogStockBalances.userId} = ${userId}
            and ${catalogStockBalances.availableQuantity} > 0) as "stockedItems",
        (select count(*)::int from (
          select ${catalogStockBalances.itemId}
          from ${catalogStockBalances}
          where ${catalogStockBalances.userId} = ${userId}
          group by ${catalogStockBalances.itemId}
          having count(*) > 1
        ) multi_warehouse) as "multiWarehouseItems",
        (select count(*)::int from ${catalogBomComponents}
          where ${catalogBomComponents.userId} = ${userId}) as "bomLinks",
        (select coalesce(sum(${catalogStockBalances.availableQuantity}), 0) from ${catalogStockBalances}
          where ${catalogStockBalances.userId} = ${userId}) as "totalAvailableQuantity",
        (select max(${catalogStockBalances.snapshotAt}) from ${catalogStockBalances}
          where ${catalogStockBalances.userId} = ${userId}) as "latestSnapshotAt"
    `);
    const row = executedRows(result)[0];
    if (!row) throw new Error("Не удалось получить сводку промышленного каталога.");
    return {
      items: finiteNumber(row.items),
      components: finiteNumber(row.components),
      assemblies: finiteNumber(row.assemblies),
      families: finiteNumber(row.families),
      stockBalanceRows: finiteNumber(row.stockBalanceRows),
      stockedItems: finiteNumber(row.stockedItems),
      multiWarehouseItems: finiteNumber(row.multiWarehouseItems),
      bomLinks: finiteNumber(row.bomLinks),
      totalAvailableQuantity: finiteNumber(row.totalAvailableQuantity),
      latestSnapshotAt: nullableTimestamp(row.latestSnapshotAt),
    };
  }

  async getCatalogItemByCode(
    userId: string,
    itemCode: string,
  ): Promise<CatalogItemWithStock | null> {
    trustedUser(userId);
    const [row] = await this.db
      .select()
      .from(catalogItems)
      .where(
        and(
          eq(catalogItems.userId, userId),
          eq(catalogItems.itemCode, itemCode.trim().toLocaleUpperCase("ru-RU")),
        ),
      )
      .limit(1);
    if (!row) return null;

    const balances = await this.db
      .select()
      .from(catalogStockBalances)
      .where(
        and(
          eq(catalogStockBalances.userId, userId),
          eq(catalogStockBalances.itemId, row.id),
        ),
      )
      .orderBy(
        asc(catalogStockBalances.plant),
        asc(catalogStockBalances.storageLocation),
        asc(catalogStockBalances.id),
      );
    const stockByItem = await this.catalogStockSummaries(userId, [row.id]);
    return {
      ...toCatalogItem(row),
      ...emptyCatalogStockSummary(stockByItem.get(row.id)),
      balances: balances.map(toCatalogStockBalance),
    };
  }

  async listCatalogFamilySubstitutes(
    userId: string,
    itemCode: string,
  ): Promise<CatalogSubstituteResult | null> {
    trustedUser(userId);
    const normalizedCode = itemCode.trim().toLocaleUpperCase("ru-RU");
    const [source] = await this.db
      .select()
      .from(catalogItems)
      .where(
        and(eq(catalogItems.userId, userId), eq(catalogItems.itemCode, normalizedCode)),
      )
      .limit(1);
    if (!source) return null;
    if (!source.familyId) {
      return { sourceItemCode: source.itemCode, family: null, items: [] };
    }

    const [[family], candidates] = await Promise.all([
      this.db
        .select()
        .from(catalogInterchangeabilityFamilies)
        .where(
          and(
            eq(catalogInterchangeabilityFamilies.userId, userId),
            eq(catalogInterchangeabilityFamilies.id, source.familyId),
          ),
        )
        .limit(1),
      this.db
        .select()
        .from(catalogItems)
        .where(
          and(
            eq(catalogItems.userId, userId),
            eq(catalogItems.familyId, source.familyId),
            ne(catalogItems.id, source.id),
          ),
        )
        .orderBy(asc(catalogItems.itemCode), asc(catalogItems.id)),
    ]);
    const stockByItem = await this.catalogStockSummaries(
      userId,
      candidates.map((candidate) => candidate.id),
    );
    return {
      sourceItemCode: source.itemCode,
      family: family ? toCatalogFamily(family) : null,
      items: family?.active
        ? candidates.map((candidate) => ({
            ...toCatalogItem(candidate),
            ...emptyCatalogStockSummary(stockByItem.get(candidate.id)),
          }))
        : [],
    };
  }

  async getCatalogAssemblyBom(
    userId: string,
    assemblyCode: string,
  ): Promise<CatalogAssemblyBom | null> {
    trustedUser(userId);
    const normalizedCode = assemblyCode.trim().toLocaleUpperCase("ru-RU");
    const [assembly] = await this.db
      .select()
      .from(catalogItems)
      .where(
        and(eq(catalogItems.userId, userId), eq(catalogItems.itemCode, normalizedCode)),
      )
      .limit(1);
    if (!assembly || assembly.itemKind !== "ASSEMBLY") return null;

    const links = await this.db
      .select()
      .from(catalogBomComponents)
      .where(
        and(
          eq(catalogBomComponents.userId, userId),
          eq(catalogBomComponents.assemblyItemId, assembly.id),
        ),
      )
      .orderBy(asc(catalogBomComponents.positionNumber), asc(catalogBomComponents.id));
    if (links.length === 0) {
      return { assembly: toCatalogItem(assembly), components: [] };
    }

    const componentIds = [...new Set(links.map((link) => link.componentItemId))];
    const familyIds = [
      ...new Set(
        links.flatMap((link) => (link.alternativeFamilyId ? [link.alternativeFamilyId] : [])),
      ),
    ];
    const [components, families, stockByItem] = await Promise.all([
      this.db
        .select()
        .from(catalogItems)
        .where(
          and(eq(catalogItems.userId, userId), inArray(catalogItems.id, componentIds)),
        ),
      familyIds.length === 0
        ? Promise.resolve([])
        : this.db
            .select()
            .from(catalogInterchangeabilityFamilies)
            .where(
              and(
                eq(catalogInterchangeabilityFamilies.userId, userId),
                inArray(catalogInterchangeabilityFamilies.id, familyIds),
              ),
            ),
      this.catalogStockSummaries(userId, componentIds),
    ]);
    const componentById = new Map(components.map((component) => [component.id, component]));
    const familyById = new Map(families.map((family) => [family.id, family]));
    const resolvedComponents = links.flatMap((link): CatalogBomComponent[] => {
      const component = componentById.get(link.componentItemId);
      if (!component) return [];
      const family = link.alternativeFamilyId
        ? familyById.get(link.alternativeFamilyId)
        : undefined;
      return [
        {
          id: link.id,
          positionNumber: link.positionNumber,
          quantity: Number(link.quantity),
          unit: link.unit,
          isCritical: link.isCritical,
          component: {
            ...toCatalogItem(component),
            ...emptyCatalogStockSummary(stockByItem.get(component.id)),
          },
          alternativeFamily: family ? toCatalogFamily(family) : null,
        },
      ];
    });
    return { assembly: toCatalogItem(assembly), components: resolvedComponents };
  }

  private async catalogStockSummaries(
    userId: string,
    itemIds: string[],
  ): Promise<Map<string, CatalogStockSummary>> {
    if (itemIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        itemId: catalogStockBalances.itemId,
        totalAvailableQuantity: sql<string>`coalesce(sum(${catalogStockBalances.availableQuantity}), 0)`,
        balanceCount: count(),
        latestSnapshotAt: sql<string | null>`max(${catalogStockBalances.snapshotAt})`,
      })
      .from(catalogStockBalances)
      .where(
        and(
          eq(catalogStockBalances.userId, userId),
          inArray(catalogStockBalances.itemId, itemIds),
        ),
      )
      .groupBy(catalogStockBalances.itemId);
    return new Map(
      rows.map((row) => [
        row.itemId,
        {
          totalAvailableQuantity: Number(row.totalAvailableQuantity),
          balanceCount: Number(row.balanceCount),
          ...(row.latestSnapshotAt ? { latestSnapshotAt: row.latestSnapshotAt } : {}),
        },
      ]),
    );
  }

  async listNormativeChunks(
    userId: string,
    options: { text?: string; equipmentType?: string; language?: string; limit?: number } = {},
  ): Promise<Array<typeof normativeChunks.$inferSelect & { documentId: string; documentVersion: string }>> {
    trustedUser(userId);
    const conditions: SQL[] = [
      eq(normativeChunks.userId, userId),
      eq(normativeDocuments.userId, userId),
    ];
    if (options.language) conditions.push(eq(normativeChunks.language, options.language));
    if (options.text?.trim()) {
      const pattern = `%${escapeLike(options.text.trim())}%`;
      conditions.push(or(ilike(normativeChunks.title, pattern), ilike(normativeChunks.text, pattern))!);
    }
    const rows = await this.db
      .select({ chunk: normativeChunks, document: normativeDocuments })
      .from(normativeChunks)
      .innerJoin(normativeDocuments, eq(normativeDocuments.id, normativeChunks.normativeDocumentId))
      .where(and(...conditions))
      .orderBy(asc(normativeChunks.clauseId), asc(normativeChunks.language))
      .limit(validLimit(options.limit ?? 100, 500));
    return rows
      .filter(
        ({ chunk }) =>
          !options.equipmentType ||
          chunk.equipmentTypes.includes(options.equipmentType) ||
          chunk.equipmentTypes.includes("*"),
      )
      .map(({ chunk, document }) => ({
        ...chunk,
        documentId: document.documentId,
        documentVersion: document.documentVersion,
      }));
  }

  async listResponsibilityRules(
    userId: string,
    equipmentType?: string,
  ): Promise<ResponsibilityRule[]> {
    trustedUser(userId);
    const rows = await this.db
      .select({ rule: responsibilityRules, document: normativeDocuments })
      .from(responsibilityRules)
      .innerJoin(normativeDocuments, eq(normativeDocuments.id, responsibilityRules.normativeDocumentId))
      .where(
        and(
          eq(responsibilityRules.userId, userId),
          eq(normativeDocuments.userId, userId),
          eq(responsibilityRules.active, true),
        ),
      )
      .orderBy(asc(responsibilityRules.id));
    return rows
      .filter(
        ({ rule }) =>
          !equipmentType ||
          rule.equipmentTypes.includes(equipmentType) ||
          rule.equipmentTypes.includes("*"),
      )
      .map(({ rule, document }) => ({
        documentId: document.documentId,
        version: document.documentVersion,
        clauseId: rule.clauseId,
        title: document.title,
        isSyntheticDemo: true,
        equipmentTypes: rule.equipmentTypes,
        responsibility: rule.responsibility as "CUSTOMER" | "CONTRACTOR",
        conditions: rule.conditions,
        text: rule.ruleText,
      }));
  }

  async listAnalogueRules(userId: string, equipmentType?: string): Promise<AnalogueRule[]> {
    trustedUser(userId);
    const rows = await this.db
      .select({ rule: analogueRules, document: normativeDocuments })
      .from(analogueRules)
      .innerJoin(normativeDocuments, eq(normativeDocuments.id, analogueRules.normativeDocumentId))
      .where(
        and(
          eq(analogueRules.userId, userId),
          eq(normativeDocuments.userId, userId),
          eq(analogueRules.active, true),
        ),
      )
      .orderBy(asc(analogueRules.id));
    return rows
      .filter(
        ({ rule }) =>
          !equipmentType ||
          rule.equipmentTypes.includes(equipmentType) ||
          rule.equipmentTypes.includes("*"),
      )
      .map(({ rule, document }) => ({
        documentId: document.documentId,
        version: document.documentVersion,
        clauseId: rule.clauseId,
        title: document.title,
        isSyntheticDemo: true,
        equipmentTypes: rule.equipmentTypes,
        allowedStandardPairs: rule.allowedStandardPairs,
        allowedMaterialPairs: rule.allowedMaterialPairs,
        dimensionTolerances: rule.dimensionTolerances,
        text: rule.ruleText,
      }));
  }

  async getIntegrationState(
    userId: string,
    system: IntegrationSystem,
  ): Promise<IntegrationStateRecord | null> {
    trustedUser(userId);
    const [row] = await this.db
      .select()
      .from(integrationStates)
      .where(and(eq(integrationStates.userId, userId), eq(integrationStates.system, system)))
      .limit(1);
    return row ? toIntegrationState(row) : null;
  }

  async listIntegrationStates(userId: string): Promise<IntegrationStateRecord[]> {
    trustedUser(userId);
    const rows = await this.db
      .select()
      .from(integrationStates)
      .where(eq(integrationStates.userId, userId))
      .orderBy(asc(integrationStates.system));
    return rows.map(toIntegrationState);
  }

  async setIntegrationState(
    userId: string,
    system: IntegrationSystem,
    update: IntegrationStateUpdate,
  ): Promise<IntegrationStateRecord> {
    trustedUser(userId);
    const current = await this.getIntegrationState(userId, system);
    const now = new Date().toISOString();
    const values: typeof integrationStates.$inferInsert = {
      userId,
      system,
      state: update.state,
      delayMs: update.delayMs ?? current?.delayMs ?? 0,
      snapshotAt: update.snapshotAt === undefined ? current?.snapshotAt : update.snapshotAt,
      lastSynchronizedAt:
        update.lastSynchronizedAt === undefined
          ? current?.lastSynchronizedAt
          : update.lastSynchronizedAt,
      safeMessage: update.safeMessage === undefined ? current?.safeMessage : update.safeMessage,
      settings: update.settings ?? current?.settings ?? {},
      createdBy: userId,
      updatedAt: now,
    };
    const [row] = await this.db
      .insert(integrationStates)
      .values(values)
      .onConflictDoUpdate({
        target: [integrationStates.userId, integrationStates.system],
        set: {
          state: values.state,
          delayMs: values.delayMs,
          snapshotAt: values.snapshotAt,
          lastSynchronizedAt: values.lastSynchronizedAt,
          safeMessage: values.safeMessage,
          settings: values.settings,
          updatedAt: now,
          version: sql`${integrationStates.version} + 1`,
        },
      })
      .returning();
    if (!row) throw new Error("Не удалось сохранить состояние интеграции.");
    return toIntegrationState(row);
  }

  async listScenarios(userId: string, enabledOnly = false): Promise<ScenarioDefinitionRecord[]> {
    trustedUser(userId);
    const filter = enabledOnly
      ? and(eq(scenarios.userId, userId), eq(scenarios.enabled, true))
      : eq(scenarios.userId, userId);
    const rows = await this.db.select().from(scenarios).where(filter).orderBy(asc(scenarios.id));
    return rows.map(toScenarioDefinition);
  }

  async getScenario(userId: string, scenarioId: string): Promise<ScenarioDefinitionRecord | null> {
    trustedUser(userId);
    const [row] = await this.db
      .select()
      .from(scenarios)
      .where(and(eq(scenarios.userId, userId), eq(scenarios.id, scenarioId)))
      .limit(1);
    return row ? toScenarioDefinition(row) : null;
  }

  async setScenarioEnabled(
    userId: string,
    scenarioId: string,
    enabled: boolean,
  ): Promise<ScenarioDefinitionRecord | null> {
    trustedUser(userId);
    const [row] = await this.db
      .update(scenarios)
      .set({
        enabled,
        updatedAt: new Date().toISOString(),
        version: sql`${scenarios.version} + 1`,
      })
      .where(and(eq(scenarios.userId, userId), eq(scenarios.id, scenarioId)))
      .returning();
    return row ? toScenarioDefinition(row) : null;
  }

  async createScenarioRun(userId: string, input: CreateScenarioRunInput): Promise<ScenarioRun> {
    trustedUser(userId);
    const [scenario, specification, retryRun] = await Promise.all([
      this.getScenario(userId, input.scenarioId),
      this.getSpecification(userId, input.specificationId),
      input.retryOfRunId ? this.getScenarioRun(userId, input.retryOfRunId) : Promise.resolve(null),
    ]);
    if (!scenario) throw new Error("Сценарий не найден или недоступен пользователю.");
    if (!specification) throw new Error("Спецификация не найдена или недоступна пользователю.");
    if (input.retryOfRunId && !retryRun) {
      throw new Error("Исходный запуск для повторной попытки не найден.");
    }

    const status = input.status ?? "QUEUED";
    const [row] = await this.db
      .insert(scenarioRuns)
      .values({
        id: input.id ?? `run-${randomUUID()}`,
        userId,
        projectId: input.projectId ?? "demo-project-001",
        scenarioId: input.scenarioId,
        specificationId: input.specificationId,
        retryOfRunId: input.retryOfRunId,
        status,
        currentStep: input.currentStep ?? status,
        progress: input.progress ?? 0,
        mode: input.mode ?? "NORMAL",
        seed: input.seed ?? "base",
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        inputSnapshot: input.inputSnapshot ?? {},
        outputSnapshot: input.outputSnapshot ?? {},
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        createdBy: userId,
      })
      .returning();
    if (!row) throw new Error("Не удалось создать запуск сценария.");
    return toScenarioRun(row, []);
  }

  async createRun(userId: string, input: CreateScenarioRunInput): Promise<ScenarioRun> {
    return this.createScenarioRun(userId, input);
  }

  async getScenarioRun(userId: string, runId: string): Promise<ScenarioRun | null> {
    trustedUser(userId);
    const [row] = await this.db
      .select()
      .from(scenarioRuns)
      .where(and(eq(scenarioRuns.userId, userId), eq(scenarioRuns.id, runId)))
      .limit(1);
    if (!row) return null;
    const steps = await this.listScenarioRunSteps(userId, runId);
    return toScenarioRun(row, steps);
  }

  async getRun(userId: string, runId: string): Promise<ScenarioRun | null> {
    return this.getScenarioRun(userId, runId);
  }

  async getScenarioRunInProject(
    userId: string,
    projectId: string,
    runId: string,
  ): Promise<ScenarioRun | null> {
    trustedUser(userId);
    const [row] = await this.db
      .select()
      .from(scenarioRuns)
      .where(
        and(
          eq(scenarioRuns.userId, userId),
          eq(scenarioRuns.projectId, projectId),
          eq(scenarioRuns.id, runId),
        ),
      )
      .limit(1);
    if (!row) return null;
    const steps = await this.listScenarioRunSteps(userId, runId);
    return toScenarioRun(row, steps);
  }

  async listScenarioRuns(
    userId: string,
    options: ScenarioRunQuery = {},
  ): Promise<ScenarioRun[]> {
    trustedUser(userId);
    const conditions: SQL[] = [eq(scenarioRuns.userId, userId)];
    if (options.projectId) conditions.push(eq(scenarioRuns.projectId, options.projectId));
    if (options.scenarioId) conditions.push(eq(scenarioRuns.scenarioId, options.scenarioId));
    if (options.status) conditions.push(eq(scenarioRuns.status, options.status));
    const rows = await this.db
      .select()
      .from(scenarioRuns)
      .where(and(...conditions))
      .orderBy(desc(scenarioRuns.createdAt), desc(scenarioRuns.id))
      .limit(validLimit(options.limit ?? 50, 200))
      .offset(validOffset(options.offset ?? 0));
    if (rows.length === 0) return [];
    if (options.includeSteps === false) {
      return rows.map((row) => toScenarioRun(row, []));
    }

    const runIds = rows.map((row) => row.id);
    const stepRows = await this.db
      .select()
      .from(scenarioRunSteps)
      .where(
        and(eq(scenarioRunSteps.userId, userId), inArray(scenarioRunSteps.runId, runIds)),
      )
      .orderBy(asc(scenarioRunSteps.startedAt), asc(scenarioRunSteps.id));
    const stepsByRun = new Map<string, ScenarioRunStep[]>();
    for (const step of stepRows) {
      const list = stepsByRun.get(step.runId) ?? [];
      list.push(toScenarioRunStep(step));
      stepsByRun.set(step.runId, list);
    }
    return rows.map((row) => toScenarioRun(row, stepsByRun.get(row.id) ?? []));
  }

  async listRuns(
    userId: string,
    options?: ScenarioRunQuery,
  ): Promise<ScenarioRun[]> {
    return this.listScenarioRuns(userId, options);
  }

  async updateScenarioRun(
    userId: string,
    runId: string,
    patch: ScenarioRunUpdate,
    expectedVersion?: number,
    options: { includeSteps?: boolean } = {},
  ): Promise<ScenarioRun> {
    trustedUser(userId);
    const values = {
      updatedAt: new Date().toISOString(),
      version: sql`${scenarioRuns.version} + 1`,
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.currentStep === undefined ? {} : { currentStep: patch.currentStep }),
      ...(patch.progress === undefined ? {} : { progress: clampProgress(patch.progress) }),
      ...(patch.startedAt === undefined ? {} : { startedAt: patch.startedAt }),
      ...(patch.completedAt === undefined ? {} : { completedAt: patch.completedAt }),
      ...(patch.outputSnapshot === undefined ? {} : { outputSnapshot: patch.outputSnapshot }),
      ...(patch.errorCode === undefined ? {} : { errorCode: patch.errorCode }),
      ...(patch.errorMessage === undefined ? {} : { errorMessage: patch.errorMessage }),
    };

    const conditions: SQL[] = [eq(scenarioRuns.userId, userId), eq(scenarioRuns.id, runId)];
    if (expectedVersion !== undefined) conditions.push(eq(scenarioRuns.version, expectedVersion));
    conditions.push(sql<boolean>`not exists (
      select 1
      from ${scenarioRunSteps} pending
      where pending.user_id = ${scenarioRuns.userId}
        and pending.run_id = ${scenarioRuns.id}
        and pending.details ->> 'terminalStageSchema' = 'terminal-outcome-v1'
        and coalesce((pending.details ->> 'stagedRunVersion')::int, -1) = ${scenarioRuns.version}
    )`);
    const [row] = await this.db
      .update(scenarioRuns)
      .set(values)
      .where(and(...conditions))
      .returning();
    if (!row) {
      if (expectedVersion !== undefined) throw new OptimisticLockError(runId);
      throw new Error("Запуск сценария не найден.");
    }
    const steps = options.includeSteps === false
      ? []
      : await this.listScenarioRunSteps(userId, runId);
    return toScenarioRun(row, steps);
  }

  async updateScenarioRunStatus(
    userId: string,
    runId: string,
    patch: ScenarioRunUpdate,
    expectedVersion: number,
  ): Promise<ScenarioRun> {
    return this.updateScenarioRun(userId, runId, patch, expectedVersion);
  }

  async updateRun(
    userId: string,
    runId: string,
    patch: ScenarioRunUpdate,
    expectedVersion?: number,
    options: { includeSteps?: boolean } = {},
  ): Promise<ScenarioRun> {
    return this.updateScenarioRun(userId, runId, patch, expectedVersion, options);
  }

  async claimScenarioStep(
    userId: string,
    runId: string,
    expectedVersion: number,
    input: ClaimScenarioStepInput,
    options: { includeSteps?: boolean } = {},
  ): Promise<{ run: ScenarioRun; step: ScenarioRunStep }> {
    trustedUser(userId);
    if (input.runId !== runId || input.outcome !== "STARTED") {
      throw new Error("Claim шага должен относиться к тому же запуску и иметь outcome STARTED.");
    }
    const now = new Date().toISOString();
    const stepId = input.id ?? `step-${randomUUID()}`;
    const claimDetails = { ...(input.details ?? {}), attemptVersion: expectedVersion + 1 };
    const assignments = scenarioRunAssignments(input.runPatch, false);
    const result = await this.db.execute(sql`
      with run_claim as materialized (
        select ${scenarioRuns}.*
        from ${scenarioRuns}
        where ${scenarioRuns.userId} = ${userId}
          and ${scenarioRuns.id} = ${runId}
          and ${scenarioRuns.version} = ${expectedVersion}
        for update
      ),
      active_claim as materialized (
        select step.id
        from ${scenarioRunSteps} step
        inner join run_claim run on run.id = step.run_id and run.user_id = step.user_id
        where step.outcome = 'STARTED'
          and step.status = run.status
          and coalesce((step.details ->> 'attemptVersion')::int, -1) = run.version
          and step.updated_at > clock_timestamp() -
            ${SCENARIO_STEP_CLAIM_LEASE_MS} * interval '1 millisecond'
        limit 1
      ),
      eligible_run as materialized (
        select claim.*
        from run_claim claim
        where not exists (select 1 from active_claim)
      ),
      inserted_step as (
        insert into ${scenarioRunSteps} (
          id, run_id, user_id, status, label, outcome, started_at,
          completed_at, duration_ms, details, idempotency_key,
          created_at, updated_at, created_by, version
        )
        select
          ${stepId}, claim.id, claim.user_id, ${input.status}, ${input.label},
          'STARTED', ${input.startedAt}::timestamptz, null, null,
          ${JSON.stringify(claimDetails)}::jsonb, ${input.idempotencyKey},
          ${now}::timestamptz, ${now}::timestamptz, claim.user_id, 1
        from eligible_run claim
        on conflict (run_id, idempotency_key) do update set
          status = excluded.status,
          label = excluded.label,
          outcome = excluded.outcome,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          duration_ms = excluded.duration_ms,
          details = excluded.details,
          updated_at = excluded.updated_at,
          version = ${scenarioRunSteps.version} + 1
        where ${scenarioRunSteps.outcome} = 'STARTED'
          and ${scenarioRunSteps.updatedAt} <= clock_timestamp() -
            ${SCENARIO_STEP_CLAIM_LEASE_MS} * interval '1 millisecond'
        returning *
      ),
      updated_run as (
        update ${scenarioRuns}
        set ${sql.join(assignments, sql`, `)}, version = ${scenarioRuns.version} + 1
        from eligible_run claim
        inner join inserted_step step on true
        where ${scenarioRuns.userId} = claim.user_id
          and ${scenarioRuns.id} = claim.id
          and ${scenarioRuns.version} = claim.version
        returning ${scenarioRuns}.*
      )
      select
        updated_run.id as "runId",
        updated_run.user_id as "runUserId",
        updated_run.project_id as "runProjectId",
        updated_run.scenario_id as "runScenarioId",
        updated_run.specification_id as "runSpecificationId",
        updated_run.retry_of_run_id as "runRetryOfRunId",
        updated_run.status as "runStatus",
        updated_run.current_step as "runCurrentStep",
        updated_run.progress as "runProgress",
        updated_run.mode as "runMode",
        updated_run.seed as "runSeed",
        updated_run.started_at as "runStartedAt",
        updated_run.completed_at as "runCompletedAt",
        updated_run.input_snapshot as "runInputSnapshot",
        updated_run.output_snapshot as "runOutputSnapshot",
        updated_run.error_code as "runErrorCode",
        updated_run.error_message as "runErrorMessage",
        updated_run.created_at as "runCreatedAt",
        updated_run.updated_at as "runUpdatedAt",
        updated_run.created_by as "runCreatedBy",
        updated_run.version as "runVersion",
        step.id as "stepId",
        step.run_id as "stepRunId",
        step.user_id as "stepUserId",
        step.status as "stepStatus",
        step.label as "stepLabel",
        step.outcome as "stepOutcome",
        step.started_at as "stepStartedAt",
        step.completed_at as "stepCompletedAt",
        step.duration_ms as "stepDurationMs",
        step.details as "stepDetails",
        step.idempotency_key as "stepIdempotencyKey",
        step.created_at as "stepCreatedAt",
        step.updated_at as "stepUpdatedAt",
        step.created_by as "stepCreatedBy",
        step.version as "stepVersion"
      from updated_run
      inner join inserted_step step on true
    `);
    const row = executedRows(result)[0];
    if (!row) {
      const active = await this.findFreshScenarioClaim(userId, runId, expectedVersion);
      if (active) throw new ScenarioStepClaimInProgressError(runId);
      throw new OptimisticLockError(runId);
    }
    const persistedSteps = options.includeSteps === false
      ? []
      : await this.listScenarioRunSteps(userId, runId);
    return {
      run: toScenarioRun(scenarioRunRowFromTransition(row), persistedSteps),
      step: toScenarioRunStep(scenarioStepRowFromTransition(row)),
    };
  }

  private async findFreshScenarioClaim(
    userId: string,
    runId: string,
    expectedVersion: number,
  ): Promise<boolean> {
    const result = await this.db.execute(sql`
      select exists (
        select 1
        from ${scenarioRuns} run
        inner join ${scenarioRunSteps} step
          on step.run_id = run.id and step.user_id = run.user_id
        where run.user_id = ${userId}
          and run.id = ${runId}
          and run.version = ${expectedVersion}
          and step.outcome = 'STARTED'
          and step.status = run.status
          and coalesce((step.details ->> 'attemptVersion')::int, -1) = run.version
          and step.updated_at > clock_timestamp() -
            ${SCENARIO_STEP_CLAIM_LEASE_MS} * interval '1 millisecond'
      ) as active
    `);
    return executedRows(result)[0]?.active === true;
  }

  async finishScenarioStepTransition(
    userId: string,
    runId: string,
    expectedVersion: number,
    input: FinishScenarioStepTransitionInput,
    options: { includeSteps?: boolean } = {},
  ): Promise<ScenarioStepTransitionResult> {
    trustedUser(userId);
    if (input.runId !== runId || !["COMPLETED", "FAILED"].includes(input.outcome)) {
      throw new Error("Завершение шага должно относиться к тому же запуску.");
    }
    if (input.outcome === "FAILED" && input.runPatch.status !== "FAILED") {
      throw new Error("FAILED outcome может быть сохранён только как terminal FAILED.");
    }
    if (input.outcome === "COMPLETED" && ["FAILED", "CANCELLED"].includes(input.runPatch.status ?? "")) {
      throw new Error("COMPLETED outcome несовместим с terminal FAILED/CANCELLED.");
    }
    const terminal = input.runPatch.status === "COMPLETED" || input.runPatch.status === "FAILED";
    const now = new Date().toISOString();
    const stagedVersion = expectedVersion + 1;
    const stepDetails = terminal
      ? {
          ...(input.details ?? {}),
          terminalStageSchema: "terminal-outcome-v1",
          terminalStatus: input.runPatch.status,
          terminalCurrentStep: input.runPatch.currentStep ?? input.status,
          terminalProgress: input.runPatch.progress ?? (input.runPatch.status === "FAILED" ? 0 : 100),
          claimRunVersion: expectedVersion,
          stagedRunVersion: stagedVersion,
          auditNext: input.details?.auditNext ?? (input.outcome === "COMPLETED" ? "COMPLETED" : undefined),
        }
      : input.details ?? {};
    const assignments = terminal
      ? scenarioRunStageAssignments(input.runPatch)
      : scenarioRunAssignments(input.runPatch, false);

    let result: unknown;
    try {
      result = await this.db.execute(sql`
        with run_claim as (
          select ${scenarioRuns}.*
          from ${scenarioRuns}
          where ${scenarioRuns.userId} = ${userId}
            and ${scenarioRuns.id} = ${runId}
            and ${scenarioRuns.version} = ${expectedVersion}
          for update
        ),
        updated_step as (
          update ${scenarioRunSteps} step
          set
            label = ${input.label},
            outcome = ${input.outcome},
            completed_at = ${input.completedAt ?? now}::timestamptz,
            duration_ms = ${input.durationMs ?? 0},
            details = ${JSON.stringify(stepDetails)}::jsonb,
            updated_at = ${now}::timestamptz,
            version = step.version + 1
          from run_claim claim
          where step.user_id = claim.user_id
            and step.run_id = claim.id
            and step.status = ${input.status}
            and step.idempotency_key = ${input.idempotencyKey}
            and step.outcome = 'STARTED'
            and coalesce((step.details ->> 'attemptVersion')::int, -1) = claim.version
          returning step.*
        ),
        updated_run as (
          update ${scenarioRuns}
          set
            ${sql.join(assignments, sql`, `)},
            version = ${scenarioRuns.version} + 1
          from run_claim claim
          inner join updated_step step on true
          where ${scenarioRuns.userId} = claim.user_id
            and ${scenarioRuns.id} = claim.id
            and ${scenarioRuns.version} = claim.version
          returning ${scenarioRuns}.*
        )
        select
          updated_run.id as "runId",
          updated_run.user_id as "runUserId",
          updated_run.project_id as "runProjectId",
          updated_run.scenario_id as "runScenarioId",
          updated_run.specification_id as "runSpecificationId",
          updated_run.retry_of_run_id as "runRetryOfRunId",
          updated_run.status as "runStatus",
          updated_run.current_step as "runCurrentStep",
          updated_run.progress as "runProgress",
          updated_run.mode as "runMode",
          updated_run.seed as "runSeed",
          updated_run.started_at as "runStartedAt",
          updated_run.completed_at as "runCompletedAt",
          updated_run.input_snapshot as "runInputSnapshot",
          updated_run.output_snapshot as "runOutputSnapshot",
          updated_run.error_code as "runErrorCode",
          updated_run.error_message as "runErrorMessage",
          updated_run.created_at as "runCreatedAt",
          updated_run.updated_at as "runUpdatedAt",
          updated_run.created_by as "runCreatedBy",
          updated_run.version as "runVersion",
          step.id as "stepId",
          step.run_id as "stepRunId",
          step.user_id as "stepUserId",
          step.status as "stepStatus",
          step.label as "stepLabel",
          step.outcome as "stepOutcome",
          step.started_at as "stepStartedAt",
          step.completed_at as "stepCompletedAt",
          step.duration_ms as "stepDurationMs",
          step.details as "stepDetails",
          step.idempotency_key as "stepIdempotencyKey",
          step.created_at as "stepCreatedAt",
          step.updated_at as "stepUpdatedAt",
          step.created_by as "stepCreatedBy",
          step.version as "stepVersion"
        from updated_run
        inner join updated_step step on true
      `);
    } catch (error) {
      throw new ScenarioRunTransitionPersistenceError(runId, error);
    }
    const row = executedRows(result)[0];
    if (!row) throw new OptimisticLockError(runId);
    const persistedSteps = options.includeSteps === false
      ? []
      : await this.listScenarioRunSteps(userId, runId);
    return {
      run: toScenarioRun(scenarioRunRowFromTransition(row), persistedSteps),
      step: toScenarioRunStep(scenarioStepRowFromTransition(row)),
      terminalStaged: terminal,
    };
  }

  async stageScenarioCancellation(
    userId: string,
    runId: string,
    expectedVersion: number,
    input: UpsertScenarioStepInput & { outcome: "CANCELLED" },
    options: { includeSteps?: boolean } = {},
  ): Promise<ScenarioStepTransitionResult> {
    trustedUser(userId);
    if (input.runId !== runId) throw new Error("Отмена должна относиться к тому же запуску.");
    const now = input.completedAt ?? new Date().toISOString();
    const stagedVersion = expectedVersion + 1;
    const details = {
      ...(input.details ?? {}),
      terminalStageSchema: "terminal-outcome-v1",
      terminalStatus: "CANCELLED",
      terminalCurrentStep: "CANCELLED",
      terminalProgress: 100,
      claimRunVersion: expectedVersion,
      stagedRunVersion: stagedVersion,
    };
    const stepId = input.id ?? `step-${randomUUID()}`;
    let result: unknown;
    try {
      result = await this.db.execute(sql`
        with run_claim as (
          select ${scenarioRuns}.*
          from ${scenarioRuns}
          where ${scenarioRuns.userId} = ${userId}
            and ${scenarioRuns.id} = ${runId}
            and ${scenarioRuns.version} = ${expectedVersion}
          for update
        ),
        no_pending_terminal as (
          select claim.*
          from run_claim claim
          where not exists (
            select 1
            from ${scenarioRunSteps} pending
            where pending.user_id = claim.user_id
              and pending.run_id = claim.id
              and pending.details ->> 'terminalStageSchema' = 'terminal-outcome-v1'
              and coalesce((pending.details ->> 'stagedRunVersion')::int, -1) = claim.version
          )
        ),
        cancelled_active_step as (
          update ${scenarioRunSteps} active
          set
            label = 'Шаг прерван отменой запуска',
            outcome = 'CANCELLED',
            completed_at = ${now}::timestamptz,
            duration_ms = greatest(0, extract(epoch from (${now}::timestamptz - active.started_at)) * 1000)::int,
            details = active.details || ${JSON.stringify(details)}::jsonb ||
              jsonb_build_object('cancelledByRun', true),
            updated_at = clock_timestamp(),
            version = active.version + 1
          from no_pending_terminal claim
          where active.user_id = claim.user_id
            and active.run_id = claim.id
            and active.status = claim.status
            and active.outcome = 'STARTED'
            and coalesce((active.details ->> 'attemptVersion')::int, -1) = claim.version
          returning active.*
        ),
        deleted_unconfirmed_results as (
          delete from ${positionAnalysisResults} result
          using no_pending_terminal claim
          where result.user_id = claim.user_id
            and result.run_id = claim.id
            and claim.status = 'FINDING_ANALOGUES'
            and exists (select 1 from cancelled_active_step)
          returning result.id
        ),
        inserted_step as (
          insert into ${scenarioRunSteps} (
            id, run_id, user_id, status, label, outcome, started_at,
            completed_at, duration_ms, details, idempotency_key,
            created_at, updated_at, created_by, version
          )
          select
            ${stepId}, claim.id, claim.user_id, ${input.status}, ${input.label}, 'CANCELLED',
            ${input.startedAt}::timestamptz, ${now}::timestamptz, ${input.durationMs ?? 0},
            ${JSON.stringify(details)}::jsonb, ${input.idempotencyKey},
            clock_timestamp(), clock_timestamp(), claim.user_id, 1
          from no_pending_terminal claim
          where not exists (select 1 from cancelled_active_step)
          returning *
        ),
        terminal_step as materialized (
          select * from cancelled_active_step
          union all
          select * from inserted_step
        ),
        updated_run as (
          update ${scenarioRuns}
          set updated_at = clock_timestamp(), version = ${scenarioRuns.version} + 1
          from no_pending_terminal claim
          inner join terminal_step step on true
          where ${scenarioRuns.userId} = claim.user_id
            and ${scenarioRuns.id} = claim.id
            and ${scenarioRuns.version} = claim.version
          returning ${scenarioRuns}.*
        )
        select
          updated_run.id as "runId",
          updated_run.user_id as "runUserId",
          updated_run.project_id as "runProjectId",
          updated_run.scenario_id as "runScenarioId",
          updated_run.specification_id as "runSpecificationId",
          updated_run.retry_of_run_id as "runRetryOfRunId",
          updated_run.status as "runStatus",
          updated_run.current_step as "runCurrentStep",
          updated_run.progress as "runProgress",
          updated_run.mode as "runMode",
          updated_run.seed as "runSeed",
          updated_run.started_at as "runStartedAt",
          updated_run.completed_at as "runCompletedAt",
          updated_run.input_snapshot as "runInputSnapshot",
          updated_run.output_snapshot as "runOutputSnapshot",
          updated_run.error_code as "runErrorCode",
          updated_run.error_message as "runErrorMessage",
          updated_run.created_at as "runCreatedAt",
          updated_run.updated_at as "runUpdatedAt",
          updated_run.created_by as "runCreatedBy",
          updated_run.version as "runVersion",
          step.id as "stepId",
          step.run_id as "stepRunId",
          step.user_id as "stepUserId",
          step.status as "stepStatus",
          step.label as "stepLabel",
          step.outcome as "stepOutcome",
          step.started_at as "stepStartedAt",
          step.completed_at as "stepCompletedAt",
          step.duration_ms as "stepDurationMs",
          step.details as "stepDetails",
          step.idempotency_key as "stepIdempotencyKey",
          step.created_at as "stepCreatedAt",
          step.updated_at as "stepUpdatedAt",
          step.created_by as "stepCreatedBy",
          step.version as "stepVersion"
      from updated_run
      inner join terminal_step step on true
      `);
    } catch (error) {
      throw new ScenarioRunTransitionPersistenceError(runId, error);
    }
    const row = executedRows(result)[0];
    if (!row) throw new OptimisticLockError(runId);
    const steps = options.includeSteps === false ? [] : await this.listScenarioRunSteps(userId, runId);
    return {
      run: toScenarioRun(scenarioRunRowFromTransition(row), steps),
      step: toScenarioRunStep(scenarioStepRowFromTransition(row)),
      terminalStaged: true,
    };
  }

  /** Publishes a previously staged terminal outcome. The stage survives any failure here. */
  async publishStagedTerminalRun(
    userId: string,
    runId: string,
    expectedVersion: number,
    options: { includeSteps?: boolean } = {},
  ): Promise<ScenarioRun> {
    trustedUser(userId);
    let result: unknown;
    try {
      result = await this.db.execute(sql`
        with run_claim as materialized (
          select ${scenarioRuns}.*
          from ${scenarioRuns}
          where ${scenarioRuns.userId} = ${userId}
            and ${scenarioRuns.id} = ${runId}
            and ${scenarioRuns.version} = ${expectedVersion}
          for update
        ),
        terminal_stage as materialized (
          select step.*
          from ${scenarioRunSteps} step
          inner join run_claim claim on claim.id = step.run_id and claim.user_id = step.user_id
          where step.details ->> 'terminalStageSchema' = 'terminal-outcome-v1'
            and coalesce((step.details ->> 'stagedRunVersion')::int, -1) = claim.version
            and coalesce((step.details ->> 'claimRunVersion')::int, -1) = claim.version - 1
            and step.outcome in ('COMPLETED', 'FAILED', 'CANCELLED')
        ),
        valid_stage as materialized (
          select stage.*
          from terminal_stage stage
          cross join run_claim claim
          where (select count(*) from terminal_stage) = 1
            and stage.status = claim.status
            and stage.status = claim.current_step
            and stage.completed_at is not null
            and (stage.outcome <> 'COMPLETED' or nullif(stage.details ->> 'auditNext', '') is not null)
            and stage.details ->> 'terminalStatus' = case stage.outcome
              when 'COMPLETED' then 'COMPLETED'
              when 'FAILED' then 'FAILED'
              else 'CANCELLED'
            end
        ),
        expected_events as materialized (
          select
            'audit-step-' || md5(step.user_id || ':' || step.run_id || ':' || step.idempotency_key || ':' || step.outcome) as id,
            step.user_id as user_id,
            ${DEMO_USER_DISPLAY_NAME}::text as actor_display_name,
            case step.outcome
              when 'COMPLETED' then 'SCENARIO_STEP_COMPLETED'
              when 'FAILED' then 'SCENARIO_STEP_FAILED'
              else 'SCENARIO_RUN_CANCELLED'
            end as action,
            'SCENARIO_RUN'::text as entity_type,
            step.run_id as entity_id,
            case when step.outcome = 'FAILED' then 'FAILURE' else 'SUCCESS' end as outcome,
            case step.outcome
              when 'COMPLETED' then jsonb_build_object(
                'step', step.status,
                'next', step.details ->> 'auditNext'
              )
              when 'FAILED' then jsonb_build_object(
                'step', step.status,
                'errorCode', step.details ->> 'errorCode',
                'recommendedAction', step.details ->> 'recommendedAction'
              )
              else '{}'::jsonb
            end as details,
            step.completed_at as occurred_at,
            ${oneCalendarYearAfterSql(sql`step.completed_at`)} as retention_until,
            null::text as request_id
          from ${scenarioRunSteps} step
          cross join valid_stage stage
          where step.user_id = ${userId}
            and step.run_id = ${runId}
            and (
              step.outcome = 'COMPLETED'
              or (stage.outcome = 'FAILED' and step.id = stage.id and step.outcome = 'FAILED')
              or (stage.outcome = 'CANCELLED' and step.id = stage.id and step.outcome = 'CANCELLED')
            )
        ),
        matching_existing as materialized (
          select expected.id
          from ${auditLogs} existing
          inner join expected_events expected on expected.id = existing.id
          where existing.user_id = expected.user_id
            and existing.actor_display_name = expected.actor_display_name
            and existing.action = expected.action
            and existing.entity_type = expected.entity_type
            and existing.entity_id is not distinct from expected.entity_id
            and existing.outcome = expected.outcome
            and existing.details = expected.details
            and existing.occurred_at = expected.occurred_at
            and existing.retention_until = expected.retention_until
            and existing.request_id is not distinct from expected.request_id
        ),
        missing_events as materialized (
          select expected.*
          from expected_events expected
          left join matching_existing matching on matching.id = expected.id
          where matching.id is null
        ),
        projected_audits as (
          insert into ${auditLogs} (
            id, user_id, actor_display_name, action, entity_type, entity_id,
            outcome, details, occurred_at, retention_until, request_id
          )
          select
            id, user_id, actor_display_name, action, entity_type, entity_id,
            outcome, details, occurred_at, retention_until, request_id
          from missing_events
          returning id
        ),
        projection_status as materialized (
          select
            (select count(*)::int from expected_events) as expected_count,
            (select count(distinct id)::int from expected_events) as distinct_count,
            (select count(*)::int from matching_existing) +
              (select count(*)::int from projected_audits) as projected_count
        ),
        updated_run as (
          update ${scenarioRuns}
          set
            status = stage.details ->> 'terminalStatus',
            current_step = stage.details ->> 'terminalCurrentStep',
            progress = (stage.details ->> 'terminalProgress')::int,
            completed_at = clock_timestamp(),
            updated_at = clock_timestamp(),
            version = ${scenarioRuns.version} + 1
          from run_claim claim
          cross join valid_stage stage
          cross join projection_status projection
          where ${scenarioRuns.userId} = claim.user_id
            and ${scenarioRuns.id} = claim.id
            and ${scenarioRuns.version} = claim.version
            and projection.expected_count > 0
            and projection.distinct_count = projection.expected_count
            and projection.projected_count = projection.expected_count
          returning ${scenarioRuns}.*
        )
        select
          updated_run.id,
          updated_run.user_id as "userId",
          updated_run.scenario_id as "scenarioId",
          updated_run.specification_id as "specificationId",
          updated_run.retry_of_run_id as "retryOfRunId",
          updated_run.status,
          updated_run.current_step as "currentStep",
          updated_run.progress,
          updated_run.mode,
          updated_run.seed,
          updated_run.started_at as "startedAt",
          updated_run.completed_at as "completedAt",
          updated_run.input_snapshot as "inputSnapshot",
          updated_run.output_snapshot as "outputSnapshot",
          updated_run.error_code as "errorCode",
          updated_run.error_message as "errorMessage",
          updated_run.created_at as "createdAt",
          updated_run.updated_at as "updatedAt",
          updated_run.created_by as "createdBy",
          updated_run.version
        from updated_run
      `);
    } catch (error) {
      throw new ScenarioRunTerminalPersistenceError(runId, error);
    }
    const row = executedRows(result)[0] as unknown as typeof scenarioRuns.$inferSelect | undefined;
    if (!row) {
      const [current] = await this.db
        .select({ version: scenarioRuns.version })
        .from(scenarioRuns)
        .where(and(eq(scenarioRuns.userId, userId), eq(scenarioRuns.id, runId)))
        .limit(1);
      if (!current || current.version !== expectedVersion) throw new OptimisticLockError(runId);
      throw new ScenarioRunTerminalPersistenceError(
        runId,
        new Error("Terminal stage отсутствует, неоднозначен или не прошёл полную audit-проекцию."),
      );
    }
    const steps = options.includeSteps === false ? [] : await this.listScenarioRunSteps(userId, runId);
    return toScenarioRun(row, steps);
  }

  async upsertScenarioRunStep(
    userId: string,
    input: UpsertScenarioStepInput,
  ): Promise<ScenarioRunStep> {
    trustedUser(userId);
    const now = new Date().toISOString();
    const stepId = input.id ?? `step-${randomUUID()}`;
    const ownedRunStep = this.db
      .select({
        id: sql<string>`${stepId}`.as("id"),
        runId: scenarioRuns.id,
        userId: scenarioRuns.userId,
        status: sql<ScenarioRunStatus>`${input.status}`.as("status"),
        label: sql<string>`${input.label}`.as("label"),
        outcome: sql<string>`${input.outcome}`.as("outcome"),
        startedAt: sql<string>`${input.startedAt}::timestamptz`.as("started_at"),
        completedAt: input.completedAt
          ? sql<string>`${input.completedAt}::timestamptz`.as("completed_at")
          : sql<string | null>`null`.as("completed_at"),
        durationMs: input.durationMs === undefined || input.durationMs === null
          ? sql<number | null>`null`.as("duration_ms")
          : sql<number>`${input.durationMs}`.as("duration_ms"),
        details: sql<Record<string, unknown>>`${JSON.stringify(input.details ?? {})}::jsonb`.as("details"),
        idempotencyKey: sql<string>`${input.idempotencyKey}`.as("idempotency_key"),
        createdAt: sql<string>`${now}::timestamptz`.as("created_at"),
        updatedAt: sql<string>`${now}::timestamptz`.as("updated_at"),
        createdBy: scenarioRuns.userId,
        version: sql<number>`1`.as("version"),
      })
      .from(scenarioRuns)
      .where(and(eq(scenarioRuns.userId, userId), eq(scenarioRuns.id, input.runId)))
      .limit(1);
    const [row] = await this.db
      .insert(scenarioRunSteps)
      .select(ownedRunStep)
      .onConflictDoUpdate({
        target: [scenarioRunSteps.runId, scenarioRunSteps.idempotencyKey],
        set: {
          status: input.status,
          label: input.label,
          outcome: input.outcome,
          startedAt: input.startedAt,
          completedAt: input.completedAt,
          durationMs: input.durationMs,
          details: input.details ?? {},
          updatedAt: now,
          version: sql`${scenarioRunSteps.version} + 1`,
        },
      })
      .returning();
    if (!row) throw new Error("Не удалось сохранить шаг сценария.");
    return toScenarioRunStep(row);
  }

  async addScenarioRunStep(userId: string, input: UpsertScenarioStepInput): Promise<ScenarioRunStep> {
    return this.upsertScenarioRunStep(userId, input);
  }

  async listScenarioRunSteps(userId: string, runId: string): Promise<ScenarioRunStep[]> {
    trustedUser(userId);
    const rows = await this.db
      .select()
      .from(scenarioRunSteps)
      .where(and(eq(scenarioRunSteps.userId, userId), eq(scenarioRunSteps.runId, runId)))
      .orderBy(asc(scenarioRunSteps.startedAt), asc(scenarioRunSteps.id));
    return rows.map(toScenarioRunStep);
  }

  async savePositionAnalysisResult(
    userId: string,
    input: SaveAnalysisResultInput,
  ): Promise<AnalysisResultRecord> {
    trustedUser(userId);
    const [run, position] = await Promise.all([
      this.getScenarioRun(userId, input.runId),
      this.getPosition(userId, input.positionId),
    ]);
    if (!run) throw new Error("Запуск сценария для результата не найден.");
    if (!position && input.sourceKind !== "MANUAL_IMPORT") {
      throw new Error("Позиция для результата не найдена.");
    }

    const now = new Date().toISOString();
    const [row] = await this.db
      .insert(positionAnalysisResults)
      .values({
        id: input.id ?? `result-${randomUUID()}`,
        runId: input.runId,
        userId,
        positionId: input.positionId,
        responsibility: input.responsibility,
        responsibilityConfidence: confidenceDecimal(input.responsibilityConfidence),
        responsibilityCitation: input.responsibilityCitation,
        matchCategory: input.matchCategory,
        matchScore: input.matchScore,
        matchedMaterialCode: input.matchedMaterialCode,
        status: input.status,
        requiresHumanReview: input.requiresHumanReview,
        result: input.result,
        createdBy: userId,
      })
      .onConflictDoUpdate({
        target: [positionAnalysisResults.runId, positionAnalysisResults.positionId],
        set: {
          responsibility: input.responsibility,
          responsibilityConfidence: confidenceDecimal(input.responsibilityConfidence),
          responsibilityCitation: input.responsibilityCitation,
          matchCategory: input.matchCategory,
          matchScore: input.matchScore,
          matchedMaterialCode: input.matchedMaterialCode,
          status: input.status,
          requiresHumanReview: input.requiresHumanReview,
          result: input.result,
          updatedAt: now,
          version: sql`${positionAnalysisResults.version} + 1`,
        },
      })
      .returning();
    if (!row) throw new Error("Не удалось сохранить результат анализа.");
    return toAnalysisResult(row);
  }

  async saveAnalysisResult(
    userId: string,
    input: SaveAnalysisResultInput,
  ): Promise<AnalysisResultRecord> {
    return this.savePositionAnalysisResult(userId, input);
  }

  async saveAnalysisResults(
    userId: string,
    inputs: SaveAnalysisResultInput[],
    options: SaveAnalysisResultsOptions = {},
  ): Promise<AnalysisResultRecord[]> {
    trustedUser(userId);
    if (inputs.length === 0) return [];
    const runIds = [...new Set(inputs.map((input) => input.runId))];
    if (runIds.length !== 1) {
      throw new Error("Пакет результатов должен относиться к одному запуску сценария.");
    }

    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      const lockedRun = executedRows(await tx.execute(sql`
        select id, version, status
        from ${scenarioRuns}
        where ${scenarioRuns.userId} = ${userId}
          and ${scenarioRuns.id} = ${runIds[0]!}
        for update
      `))[0];
      if (!lockedRun) throw new Error("Запуск сценария для результата не найден.");
      if (
        options.expectedRunVersion !== undefined &&
        Number(lockedRun.version) !== options.expectedRunVersion
      ) {
        throw new OptimisticLockError(runIds[0]!);
      }
      if (
        options.expectedRunStatus !== undefined &&
        lockedRun.status !== options.expectedRunStatus
      ) {
        throw new OptimisticLockError(runIds[0]!);
      }

      const canonicalPositionIds = inputs
        .filter((input) => input.sourceKind !== "MANUAL_IMPORT")
        .map((input) => input.positionId);
      if (canonicalPositionIds.length > 0) {
        const persistedPositions = await tx
          .select({ id: specificationPositions.id })
          .from(specificationPositions)
          .where(
            and(
              eq(specificationPositions.userId, userId),
              inArray(specificationPositions.id, canonicalPositionIds),
            ),
          );
        const persistedIds = new Set(persistedPositions.map((position) => position.id));
        if (canonicalPositionIds.some((positionId) => !persistedIds.has(positionId))) {
          throw new Error("Позиция для результата не найдена.");
        }
      }

      const now = new Date().toISOString();
      const rows = await tx
        .insert(positionAnalysisResults)
        .values(inputs.map((input) => ({
          id: input.id ?? `result-${randomUUID()}`,
          runId: input.runId,
          userId,
          positionId: input.positionId,
          responsibility: input.responsibility,
          responsibilityConfidence: confidenceDecimal(input.responsibilityConfidence),
          responsibilityCitation: input.responsibilityCitation,
          matchCategory: input.matchCategory,
          matchScore: input.matchScore,
          matchedMaterialCode: input.matchedMaterialCode ?? null,
          status: input.status,
          requiresHumanReview: input.requiresHumanReview,
          result: input.result,
          createdBy: userId,
        })))
        .onConflictDoUpdate({
          target: [positionAnalysisResults.runId, positionAnalysisResults.positionId],
          set: {
            responsibility: sql`excluded.responsibility`,
            responsibilityConfidence: sql`excluded.responsibility_confidence`,
            responsibilityCitation: sql`excluded.responsibility_citation`,
            matchCategory: sql`excluded.match_category`,
            matchScore: sql`excluded.match_score`,
            matchedMaterialCode: sql`excluded.matched_material_code`,
            status: sql`excluded.status`,
            requiresHumanReview: sql`excluded.requires_human_review`,
            result: sql`excluded.result`,
            updatedAt: now,
            version: sql`${positionAnalysisResults.version} + 1`,
          },
        })
        .returning();
      return rows.map(toAnalysisResult);
    });
  }

  async listPositionAnalysisResults(
    userId: string,
    runId: string,
  ): Promise<AnalysisResultRecord[]> {
    trustedUser(userId);
    const rows = await this.db
      .select()
      .from(positionAnalysisResults)
      .where(
        and(eq(positionAnalysisResults.userId, userId), eq(positionAnalysisResults.runId, runId)),
      )
      .orderBy(asc(positionAnalysisResults.positionId));
    return rows.map(toAnalysisResult);
  }

  async ensureAnalysisReviews(userId: string, inputs: AnalysisReviewSeed[]) {
    trustedUser(userId);
    if (inputs.length === 0) return [];
    await this.db.insert(analysisReviewDecisions).values(inputs.map((input) => ({
      id: `review-${randomUUID()}`,
      userId,
      runId: input.runId,
      resultId: input.resultId,
      positionId: input.positionId,
      doublecheckOutcome: input.exact ? "CONFIRMED_FOR_HUMAN_REVIEW" : "HUMAN_REVIEW_REQUIRED",
      status: "PENDING",
      agentEvidence: input.agentEvidence,
      independentEvidence: input.independentEvidence,
      createdBy: userId,
    }))).onConflictDoNothing();
    // Older prototype rows could have been marked as automatically decided.
    // A doublecheck is evidence for a person, never the person's decision.
    await this.db.update(analysisReviewDecisions).set({
      doublecheckOutcome: "CONFIRMED_FOR_HUMAN_REVIEW",
      status: "PENDING",
      decidedBy: null,
      decidedAt: null,
      updatedAt: new Date().toISOString(),
      version: sql`${analysisReviewDecisions.version} + 1`,
    }).where(and(
      eq(analysisReviewDecisions.userId, userId),
      eq(analysisReviewDecisions.runId, inputs[0]!.runId),
      eq(analysisReviewDecisions.status, "AUTO_CONFIRMED"),
    ));
    return this.listAnalysisReviews(userId, inputs[0]!.runId);
  }

  async listAnalysisReviews(userId: string, runId: string) {
    trustedUser(userId);
    return this.db.select().from(analysisReviewDecisions).where(and(
      eq(analysisReviewDecisions.userId, userId),
      eq(analysisReviewDecisions.runId, runId),
    )).orderBy(asc(analysisReviewDecisions.positionId));
  }

  async decideAnalysisReview(
    userId: string,
    reviewId: string,
    decision: "CONFIRMED" | "REJECTED" | "RETURNED",
    reason: string,
    actorDisplayName: string,
  ) {
    trustedUser(userId);
    if (reason.trim().length < 3 || reason.trim().length > 1000) throw new Error("Укажите причину решения (от 3 до 1000 символов).");
    const now = new Date().toISOString();
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      const [row] = await tx.update(analysisReviewDecisions).set({
        status: decision,
        decisionReason: reason.trim(),
        decidedBy: actorDisplayName,
        decidedAt: now,
        updatedAt: now,
        version: sql`${analysisReviewDecisions.version} + 1`,
      }).where(and(
        eq(analysisReviewDecisions.userId, userId),
        eq(analysisReviewDecisions.id, reviewId),
      )).returning();
      if (!row) throw new Error("Решение не найдено.");
      await tx.insert(auditLogs).values({ id: `audit-${randomUUID()}`, userId, actorDisplayName, action: `analysis.review.${decision.toLocaleLowerCase("en-US")}`, entityType: "analysis_review", entityId: reviewId, outcome: "SUCCESS", details: { runId: row.runId, positionId: row.positionId, reason: reason.trim() }, retentionUntil: oneCalendarYearAfter(now) });
      return row;
    });
  }

  async listAnalysisResults(userId: string, runId: string): Promise<AnalysisResultRecord[]> {
    return this.listPositionAnalysisResults(userId, runId);
  }

  async overrideAnalysisResponsibility(
    userId: string,
    input: OverrideAnalysisResponsibilityInput,
  ): Promise<AnalysisResultRecord> {
    trustedUser(userId);
    const reason = input.reason.trim();
    if (reason.length < 10 || reason.length > 500) {
      throw new Error("Причина ручной корректировки должна содержать от 10 до 500 символов.");
    }

    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      const [current] = await tx
        .select()
        .from(positionAnalysisResults)
        .where(
          and(
            eq(positionAnalysisResults.userId, userId),
            eq(positionAnalysisResults.runId, input.runId),
            eq(positionAnalysisResults.positionId, input.positionId),
          ),
        )
        .limit(1);
      if (!current) throw new Error("Результат анализа для ручной корректировки не найден.");
      if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
        throw new OptimisticLockError(current.id);
      }
      if (current.responsibility === input.responsibility) {
        throw new Error("Новое решение по ответственности должно отличаться от текущего.");
      }

      const occurredAt = new Date().toISOString();
      const previousResult = isRecord(current.result) ? current.result : {};
      const previousOverrides = Array.isArray(previousResult.manualResponsibilityOverrides)
        ? previousResult.manualResponsibilityOverrides
        : [];
      const override = {
        before: current.responsibility as "CUSTOMER" | "CONTRACTOR",
        after: input.responsibility,
        reason,
        actor: input.actorDisplayName ?? DEMO_USER_DISPLAY_NAME,
        occurredAt,
      };
      const updatedResult = {
        ...previousResult,
        responsibility: input.responsibility,
        analysisVersion: current.version + 1,
        manualResponsibilityOverrides: [...previousOverrides, override],
      };
      const [updated] = await tx
        .update(positionAnalysisResults)
        .set({
          responsibility: input.responsibility,
          result: updatedResult,
          updatedAt: occurredAt,
          version: sql`${positionAnalysisResults.version} + 1`,
        })
        .where(
          and(
            eq(positionAnalysisResults.userId, userId),
            eq(positionAnalysisResults.id, current.id),
            eq(positionAnalysisResults.version, current.version),
          ),
        )
        .returning();
      if (!updated) throw new OptimisticLockError(current.id);

      const retentionUntil = oneCalendarYearAfter(occurredAt);
      await tx.insert(auditLogs).values({
        id: `audit-${randomUUID()}`,
        userId,
        actorDisplayName: input.actorDisplayName ?? DEMO_USER_DISPLAY_NAME,
        action: "POSITION_RESPONSIBILITY_OVERRIDDEN",
        entityType: "POSITION_ANALYSIS_RESULT",
        entityId: current.id,
        outcome: "SUCCESS",
        details: redactSensitiveRecord({
          runId: input.runId,
          positionId: input.positionId,
          before: override.before,
          after: override.after,
          reason,
          versionBefore: current.version,
          versionAfter: updated.version,
        }),
        occurredAt,
        retentionUntil,
      });
      return toAnalysisResult(updated);
    });
  }

  async writeAuditLog(userId: string, input: AuditLogInput): Promise<typeof auditLogs.$inferSelect> {
    trustedUser(userId);
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const minimumRetention = oneCalendarYearAfter(occurredAt);
    const retentionUntil = input.retentionUntil ?? minimumRetention;
    if (!Number.isFinite(Date.parse(retentionUntil)) || Date.parse(retentionUntil) < Date.parse(minimumRetention)) {
      throw new Error("Срок хранения события аудита не может быть меньше одного года.");
    }
    const auditRow: typeof auditLogs.$inferSelect = {
      id: input.id ?? `audit-${randomUUID()}`,
      userId,
      actorDisplayName: input.actorDisplayName ?? DEMO_USER_DISPLAY_NAME,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      outcome: input.outcome,
      details: redactSensitiveRecord(input.details),
      occurredAt,
      retentionUntil,
      requestId: input.requestId ?? null,
    };
    const [row] = await this.db
      .insert(auditLogs)
      .values(auditRow)
      .returning();
    if (!row) throw new Error("Не удалось записать событие аудита.");
    return row;
  }

  async writeAudit(userId: string, input: AuditLogInput): Promise<typeof auditLogs.$inferSelect> {
    return this.writeAuditLog(userId, input);
  }

  async listAuditLogs(
    userId: string,
    options: { action?: string; entityType?: string; outcome?: string; limit?: number; offset?: number } = {},
  ): Promise<Array<typeof auditLogs.$inferSelect>> {
    trustedUser(userId);
    const conditions: SQL[] = [eq(auditLogs.userId, userId)];
    if (options.action) conditions.push(eq(auditLogs.action, options.action));
    if (options.entityType) conditions.push(eq(auditLogs.entityType, options.entityType));
    if (options.outcome) conditions.push(eq(auditLogs.outcome, options.outcome));
    return this.db
      .select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
      .limit(validLimit(options.limit ?? 100, 500))
      .offset(validOffset(options.offset ?? 0));
  }

  /**
   * Returns one bounded page of tool-result events. Filters are part of the
   * SQL WHERE clause, so an old matching correlation cannot disappear behind
   * a newer unfiltered limit. The trusted user condition is always first.
   */
  async queryAgentAuditOperations(
    userId: string,
    options: AgentAuditOperationQuery = {},
  ): Promise<AgentAuditOperationPage> {
    trustedUser(userId);
    const limit = validLimit(options.limit ?? 100, 100);
    const offset = validOffset(options.offset ?? 0);
    const conditions = agentAuditOperationConditions(userId, options);
    const where = and(...conditions);
    const [totalRow] = await this.db
      .select({ value: count() })
      .from(auditLogs)
      .where(where);
    const entries = await this.db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
      .limit(limit)
      .offset(offset);

    return {
      entries,
      total: Number(totalRow?.value ?? 0),
      limit,
      offset,
    };
  }

  /**
   * Exact aggregate over the complete user-scoped agent audit set. Only one
   * bounded result row crosses the database boundary, regardless of log size.
   */
  async getAgentAuditMetrics(userId: string): Promise<AgentAuditMetricsRecord> {
    trustedUser(userId);
    const result = await this.db.execute(sql`
      with agent_entries as (
        select
          ${auditLogs.action} as action,
          ${auditLogs.outcome} as outcome,
          ${auditLogs.occurredAt} as occurred_at,
          coalesce(
            nullif(${auditLogs.requestId}, ''),
            nullif(${auditLogs.details} ->> 'correlationId', '')
          ) as correlation_id,
          case
            when jsonb_typeof(${auditLogs.details} -> 'durationMs') = 'number'
              then (${auditLogs.details} ->> 'durationMs')::double precision
            else null
          end as duration_ms,
          case
            when jsonb_typeof(${auditLogs.details} -> 'attempts') = 'number'
              then (${auditLogs.details} ->> 'attempts')::integer
            else 1
          end as attempts,
          (${auditLogs.details} -> 'requiresHumanReview') = 'true'::jsonb as requires_review
        from ${auditLogs}
        where ${auditLogs.userId} = ${userId}
          and ${auditLogs.action} like ${"agent.%"}
      ),
      completed_correlations as (
        select distinct correlation_id
        from agent_entries
        where action = 'agent.response.completed' and correlation_id is not null
      ),
      failed_correlations as (
        select distinct correlation_id
        from agent_entries
        where outcome = 'FAILURE' and correlation_id is not null
      ),
      request_stats as (
        select
          count(*)::integer as total_requests,
          count(*) filter (where correlation_id is null)::integer as legacy_requests,
          count(*) filter (
            where correlation_id is not null
              and exists (
                select 1 from completed_correlations completed
                where completed.correlation_id = agent_entries.correlation_id
              )
              and not exists (
                select 1 from failed_correlations failed
                where failed.correlation_id = agent_entries.correlation_id
              )
          )::integer as correlated_successes,
          count(*) filter (
            where correlation_id is not null
              and (
                not exists (
                  select 1 from completed_correlations completed
                  where completed.correlation_id = agent_entries.correlation_id
                )
                or exists (
                  select 1 from failed_correlations failed
                  where failed.correlation_id = agent_entries.correlation_id
                )
              )
          )::integer as correlated_failures
        from agent_entries
        where action = 'agent.request.received'
      ),
      response_stats as (
        select
          count(*) filter (where correlation_id is null)::integer as legacy_responses,
          round(avg(duration_ms))::integer as average_response_ms,
          round(percentile_disc(0.5) within group (order by duration_ms))::integer as p50_response_ms,
          round(percentile_disc(0.95) within group (order by duration_ms))::integer as p95_response_ms,
          count(*) filter (where requires_review)::integer as expert_reviews
        from agent_entries
        where action = 'agent.response.completed'
      ),
      tool_stats as (
        select
          count(*)::integer as tool_calls,
          coalesce(sum(greatest(0, attempts - 1)), 0)::integer as retries
        from agent_entries
        where action = 'agent.tool.result'
      ),
      outcome_stats as (
        select
          max(occurred_at) filter (where outcome = 'SUCCESS') as last_success_at,
          max(occurred_at) filter (where outcome = 'FAILURE') as last_failure_at
        from agent_entries
      ),
      failed_request_stats as (
        select max(request.occurred_at) as last_failed_request_at
        from agent_entries request, request_stats, response_stats
        where request.action = 'agent.request.received'
          and (
            (
              request.correlation_id is not null
              and (
                not exists (
                  select 1 from completed_correlations completed
                  where completed.correlation_id = request.correlation_id
                )
                or exists (
                  select 1 from failed_correlations failed
                  where failed.correlation_id = request.correlation_id
                )
              )
            )
            or (
              request.correlation_id is null
              and request_stats.legacy_requests > response_stats.legacy_responses
            )
          )
      )
      select
        request_stats.total_requests as "totalRequests",
        (
          request_stats.correlated_successes
          + least(request_stats.legacy_requests, response_stats.legacy_responses)
        )::integer as "successfulRequests",
        (
          request_stats.correlated_failures
          + request_stats.legacy_requests
          - least(request_stats.legacy_requests, response_stats.legacy_responses)
        )::integer as "failedRequests",
        response_stats.average_response_ms as "averageResponseMs",
        response_stats.p50_response_ms as "p50ResponseMs",
        response_stats.p95_response_ms as "p95ResponseMs",
        tool_stats.tool_calls as "toolCalls",
        tool_stats.retries as retries,
        response_stats.expert_reviews as "expertReviews",
        outcome_stats.last_success_at as "lastSuccessAt",
        case
          when outcome_stats.last_failure_at is null
            then failed_request_stats.last_failed_request_at
          when failed_request_stats.last_failed_request_at is null
            then outcome_stats.last_failure_at
          else greatest(outcome_stats.last_failure_at, failed_request_stats.last_failed_request_at)
        end as "lastFailureAt"
      from request_stats, response_stats, tool_stats, outcome_stats, failed_request_stats
    `);
    const row = executedRows(result)[0];
    if (!row) throw new Error("Не удалось рассчитать метрики журнала AI-агента.");

    return {
      totalRequests: finiteNumber(row.totalRequests),
      successfulRequests: finiteNumber(row.successfulRequests),
      failedRequests: finiteNumber(row.failedRequests),
      averageResponseMs: nullableFiniteNumber(row.averageResponseMs),
      p50ResponseMs: nullableFiniteNumber(row.p50ResponseMs),
      p95ResponseMs: nullableFiniteNumber(row.p95ResponseMs),
      toolCalls: finiteNumber(row.toolCalls),
      retries: finiteNumber(row.retries),
      expertReviews: finiteNumber(row.expertReviews),
      lastSuccessAt: nullableTimestamp(row.lastSuccessAt),
      lastFailureAt: nullableTimestamp(row.lastFailureAt),
    };
  }

  async listPrompts(userId: string, name?: string): Promise<PromptVersionRecord[]> {
    trustedUser(userId);
    const filter = name
      ? and(eq(promptVersions.userId, userId), eq(promptVersions.name, name))
      : eq(promptVersions.userId, userId);
    const rows = await this.db
      .select()
      .from(promptVersions)
      .where(filter)
      .orderBy(desc(promptVersions.active), desc(promptVersions.createdAt));
    return rows.map(toPromptVersion);
  }

  async getActivePrompt(
    userId: string,
    name = "mtr-project-agent",
  ): Promise<PromptVersionRecord | null> {
    trustedUser(userId);
    const [row] = await this.db
      .select()
      .from(promptVersions)
      .where(
        and(
          eq(promptVersions.userId, userId),
          eq(promptVersions.name, name),
          eq(promptVersions.active, true),
        ),
      )
      .orderBy(desc(promptVersions.createdAt))
      .limit(1);
    return row ? toPromptVersion(row) : null;
  }

  async createPromptVersion(
    userId: string,
    input: CreatePromptVersionInput,
  ): Promise<PromptVersionRecord> {
    trustedUser(userId);
    const name = input.name.trim();
    const promptVersion = input.promptVersion.trim();
    const content = input.content.trim();
    if (!name || !promptVersion || !content) {
      throw new Error("Имя, версия и содержимое промпта обязательны.");
    }
    const now = new Date().toISOString();
    const checksum = createHash("sha256").update(content, "utf8").digest("hex");
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      if (input.active) {
        await tx
          .update(promptVersions)
          .set({
            active: false,
            updatedAt: now,
            version: sql`${promptVersions.version} + 1`,
          })
          .where(and(eq(promptVersions.userId, userId), eq(promptVersions.name, name)));
      }
      const [row] = await tx
        .insert(promptVersions)
        .values({
          id: input.id ?? `prompt-${randomUUID()}`,
          userId,
          name,
          promptVersion,
          content,
          active: input.active ?? false,
          checksum,
          createdBy: userId,
        })
        .returning();
      if (!row) throw new Error("Не удалось создать версию промпта.");
      return toPromptVersion(row);
    });
  }

  async activatePromptVersion(userId: string, promptId: string): Promise<PromptVersionRecord> {
    trustedUser(userId);
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      const [target] = await tx
        .select()
        .from(promptVersions)
        .where(and(eq(promptVersions.userId, userId), eq(promptVersions.id, promptId)))
        .limit(1);
      if (!target) throw new Error("Версия промпта не найдена.");
      const now = new Date().toISOString();
      await tx
        .update(promptVersions)
        .set({
          active: false,
          updatedAt: now,
          version: sql`${promptVersions.version} + 1`,
        })
        .where(
          and(
            eq(promptVersions.userId, userId),
            eq(promptVersions.name, target.name),
            ne(promptVersions.id, promptId),
            eq(promptVersions.active, true),
          ),
        );
      const [row] = await tx
        .update(promptVersions)
        .set({
          active: true,
          updatedAt: now,
          version: sql`${promptVersions.version} + 1`,
        })
        .where(and(eq(promptVersions.userId, userId), eq(promptVersions.id, promptId)))
        .returning();
      if (!row) throw new Error("Не удалось активировать версию промпта.");
      return toPromptVersion(row);
    });
  }

  async listDictionaries(
    userId: string,
    dictionaryType?: string,
  ): Promise<DictionaryRecord[]> {
    trustedUser(userId);
    const filter = dictionaryType
      ? and(
          eq(dictionaries.userId, userId),
          eq(dictionaries.dictionaryType, dictionaryType),
          eq(dictionaries.active, true),
        )
      : and(eq(dictionaries.userId, userId), eq(dictionaries.active, true));
    const rows = await this.db.select().from(dictionaries).where(filter).orderBy(asc(dictionaries.key));
    return rows.map(toDictionary);
  }

  async getDictionary(
    userId: string,
    dictionaryType: string,
    key: string,
  ): Promise<DictionaryRecord | null> {
    trustedUser(userId);
    const [row] = await this.db
      .select()
      .from(dictionaries)
      .where(
        and(
          eq(dictionaries.userId, userId),
          eq(dictionaries.dictionaryType, dictionaryType),
          eq(dictionaries.key, key),
          eq(dictionaries.active, true),
        ),
      )
      .limit(1);
    return row ? toDictionary(row) : null;
  }

  async updateDictionary(
    userId: string,
    dictionaryId: string,
    patch: DictionaryUpdateInput,
    expectedVersion?: number,
  ): Promise<DictionaryRecord> {
    trustedUser(userId);
    const values = patch.values?.map((value) => value.trim()).filter(Boolean);
    if (values && values.length === 0) throw new Error("Словарь должен содержать хотя бы одно значение.");
    const conditions: SQL[] = [
      eq(dictionaries.userId, userId),
      eq(dictionaries.id, dictionaryId),
    ];
    if (expectedVersion !== undefined) conditions.push(eq(dictionaries.version, expectedVersion));
    const [row] = await this.db
      .update(dictionaries)
      .set({
        ...(values === undefined ? {} : { values: [...new Set(values)] }),
        ...(patch.active === undefined ? {} : { active: patch.active }),
        updatedAt: new Date().toISOString(),
        version: sql`${dictionaries.version} + 1`,
      })
      .where(and(...conditions))
      .returning();
    if (!row) {
      if (expectedVersion !== undefined) throw new OptimisticLockError(dictionaryId);
      throw new Error("Словарь не найден.");
    }
    return toDictionary(row);
  }

  async searchDictionaries(userId: string, term: string): Promise<DictionaryRecord[]> {
    trustedUser(userId);
    const normalized = term.trim().toLocaleLowerCase("ru-RU");
    const rows = await this.listDictionaries(userId);
    if (!normalized) return rows;
    return rows.filter(
      (row) =>
        row.key.toLocaleLowerCase("ru-RU").includes(normalized) ||
        row.values.some((value) => value.toLocaleLowerCase("ru-RU").includes(normalized)),
    );
  }

  async saveUploadedFile(
    userId: string,
    input: UploadedFileInput,
  ): Promise<typeof uploadedFiles.$inferSelect> {
    trustedUser(userId);
    const [row] = await this.db
      .insert(uploadedFiles)
      .values({
        id: input.id ?? `upload-${randomUUID()}`,
        userId,
        originalName: input.originalName,
        safeName: input.safeName,
        extension: input.extension,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        checksumSha256: input.checksumSha256,
        storageUrl: input.storageUrl,
        parseStatus: input.parseStatus,
        normalizedData: input.normalizedData,
        createdBy: userId,
      })
      .returning();
    if (!row) throw new Error("Не удалось сохранить метаданные файла.");
    return row;
  }

  async updateUploadedFile(
    userId: string,
    fileId: string,
    patch: { parseStatus?: string; normalizedData?: Record<string, unknown> | null },
  ): Promise<typeof uploadedFiles.$inferSelect> {
    trustedUser(userId);
    const values = {
      updatedAt: new Date().toISOString(),
      version: sql`${uploadedFiles.version} + 1`,
      ...(patch.parseStatus === undefined ? {} : { parseStatus: patch.parseStatus }),
      ...(patch.normalizedData === undefined ? {} : { normalizedData: patch.normalizedData }),
    };
    const [row] = await this.db
      .update(uploadedFiles)
      .set(values)
      .where(and(eq(uploadedFiles.userId, userId), eq(uploadedFiles.id, fileId)))
      .returning();
    if (!row) throw new Error("Файл не найден.");
    return row;
  }

  async getUploadedFile(userId: string, fileId: string): Promise<typeof uploadedFiles.$inferSelect | null> {
    trustedUser(userId);
    const [row] = await this.db
      .select()
      .from(uploadedFiles)
      .where(and(eq(uploadedFiles.userId, userId), eq(uploadedFiles.id, fileId)))
      .limit(1);
    return row ?? null;
  }

  async listUploadedFiles(userId: string): Promise<Array<typeof uploadedFiles.$inferSelect>> {
    trustedUser(userId);
    return this.db
      .select()
      .from(uploadedFiles)
      .where(eq(uploadedFiles.userId, userId))
      .orderBy(desc(uploadedFiles.createdAt));
  }

  async createAgentThread(
    userId: string,
    title: string,
    id = `thread-${randomUUID()}`,
  ): Promise<typeof agentThreads.$inferSelect> {
    trustedUser(userId);
    const [row] = await this.db
      .insert(agentThreads)
      .values({ id, userId, title, createdBy: userId })
      .returning();
    if (!row) throw new Error("Не удалось создать диалог агента.");
    return row;
  }

  async listAgentThreads(userId: string): Promise<Array<typeof agentThreads.$inferSelect>> {
    trustedUser(userId);
    return this.db
      .select()
      .from(agentThreads)
      .where(eq(agentThreads.userId, userId))
      .orderBy(desc(agentThreads.updatedAt));
  }

  async appendAgentMessage(
    userId: string,
    input: AgentMessageInput,
  ): Promise<{
    message: typeof agentMessages.$inferSelect;
    citations: Array<typeof agentCitations.$inferSelect>;
  }> {
    trustedUser(userId);
    const [thread] = await this.db
      .select({ id: agentThreads.id })
      .from(agentThreads)
      .where(and(eq(agentThreads.userId, userId), eq(agentThreads.id, input.threadId)))
      .limit(1);
    if (!thread) throw new Error("Диалог агента не найден.");

    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      const [message] = await tx
        .insert(agentMessages)
        .values({
          id: input.id ?? `message-${randomUUID()}`,
          threadId: input.threadId,
          userId,
          role: input.role,
          content: input.content,
          structuredOutput: input.structuredOutput,
          promptVersion: input.promptVersion,
          createdBy: userId,
        })
        .returning();
      if (!message) throw new Error("Не удалось сохранить сообщение агента.");
      const citationValues = (input.citations ?? []).map((citation, index) => ({
        id: `citation-${message.id}-${String(index + 1).padStart(3, "0")}`,
        messageId: message.id,
        userId,
        sourceSystem: citation.sourceSystem,
        entityId: citation.entityId,
        versionOrSnapshot: citation.versionOrSnapshot,
        clauseId: citation.clauseId,
        createdBy: userId,
      }));
      const savedCitations = citationValues.length
        ? await tx.insert(agentCitations).values(citationValues).returning()
        : [];
      await tx
        .update(agentThreads)
        .set({ updatedAt: new Date().toISOString(), version: sql`${agentThreads.version} + 1` })
        .where(and(eq(agentThreads.userId, userId), eq(agentThreads.id, input.threadId)));
      return { message, citations: savedCitations };
    });
  }

  async listAgentMessages(
    userId: string,
    threadId: string,
  ): Promise<
    Array<{
      message: typeof agentMessages.$inferSelect;
      citations: Array<typeof agentCitations.$inferSelect>;
    }>
  > {
    trustedUser(userId);
    const messages = await this.db
      .select()
      .from(agentMessages)
      .where(and(eq(agentMessages.userId, userId), eq(agentMessages.threadId, threadId)))
      .orderBy(asc(agentMessages.createdAt), asc(agentMessages.id));
    if (messages.length === 0) return [];
    const ids = messages.map((message) => message.id);
    const citations = await this.db
      .select()
      .from(agentCitations)
      .where(and(eq(agentCitations.userId, userId), inArray(agentCitations.messageId, ids)))
      .orderBy(asc(agentCitations.id));
    return messages.map((message) => ({
      message,
      citations: citations.filter((citation) => citation.messageId === message.id),
    }));
  }

  async getCounts(userId: string): Promise<RepositoryCounts> {
    trustedUser(userId);
    const [base, runtime] = await Promise.all([
      getSeedCounts(this.db, userId),
      getRuntimeCounts(this.db, userId),
    ]);
    return {
      ...base,
      ...runtime,
    };
  }

  /** Restores the complete canonical demo dataset in one user-scoped transaction. */
  async resetDemoData(userId: string): Promise<SeedCounts> {
    trustedUser(userId);
    return resetDemoDatabase(userId, this.db);
  }

  async reset(userId: string): Promise<SeedCounts> {
    return this.resetDemoData(userId);
  }

  private async requireOwnedRun(userId: string, runId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: scenarioRuns.id })
      .from(scenarioRuns)
      .where(and(eq(scenarioRuns.userId, userId), eq(scenarioRuns.id, runId)))
      .limit(1);
    if (!row) throw new Error("Запуск сценария не найден.");
  }
}

export function createRepository(database: Database): MtrRepository {
  return new MtrRepository(database);
}

export async function getRepository(): Promise<MtrRepository> {
  return new MtrRepository(await getDatabase({ migrations: "runtime" }));
}

function toSpecification(row: typeof specifications.$inferSelect): Specification {
  return {
    id: row.id,
    userId: row.userId,
    projectCode: row.projectCode,
    name: row.name,
    latestVersionId: row.latestVersionId,
    latestVersionNumber: row.latestVersionNumber,
    positionCount: row.positionCount,
  };
}

function toSpecificationVersion(row: typeof specificationVersions.$inferSelect): SpecificationVersion {
  return {
    id: row.id,
    specificationId: row.specificationId,
    userId: row.userId,
    versionNumber: row.versionNumber,
    isCurrent: row.isCurrent,
    status: row.status as SpecificationVersion["status"],
    effectiveAt: row.effectiveAt,
    positionCount: row.positionCount,
    ...(row.sourceFileId ? { sourceFileId: row.sourceFileId } : {}),
    ...(row.sourceFileName ? { sourceFileName: row.sourceFileName } : {}),
    ...(row.sourceKind ? { sourceKind: row.sourceKind } : {}),
    ...(row.publishedBy ? { publishedBy: row.publishedBy } : {}),
    ...(row.publishedAt ? { publishedAt: row.publishedAt } : {}),
    ...(row.validationSummary ? { validationSummary: row.validationSummary } : {}),
  };
}

function toSapMaterial(
  material: typeof sapMaterials.$inferSelect,
  balance: typeof sapStockBalances.$inferSelect,
): SapMaterial {
  return {
    id: material.id,
    userId: material.userId,
    materialCode: material.materialCode,
    nameRu: material.nameRu,
    ...(material.nameEn ? { nameEn: material.nameEn } : {}),
    synonyms: material.synonyms,
    ...(material.legacyCode ? { legacyCode: material.legacyCode } : {}),
    equipmentType: material.equipmentType,
    ...(material.standard ? { standard: material.standard } : {}),
    ...(material.materialGrade ? { materialGrade: material.materialGrade } : {}),
    dimensions: material.dimensions,
    tolerances: material.tolerances,
    plant: balance.plant,
    storageLocation: balance.storageLocation,
    ...(balance.batch ? { batch: balance.batch } : {}),
    availableQuantity: Number(balance.availableQuantity),
    unit: balance.unit,
    snapshotAt: balance.snapshotAt,
    cardUrl: material.cardUrl,
    fixtureTags: material.fixtureTags,
    ...(material.sourcePositionId ? { sourcePositionId: material.sourcePositionId } : {}),
  };
}

function toIntegrationState(row: typeof integrationStates.$inferSelect): IntegrationStateRecord {
  return {
    system: row.system as IntegrationSystem,
    state: row.state as IntegrationStatus,
    delayMs: row.delayMs,
    ...(row.snapshotAt ? { snapshotAt: row.snapshotAt } : {}),
    ...(row.lastSynchronizedAt ? { lastSynchronizedAt: row.lastSynchronizedAt } : {}),
    ...(row.safeMessage ? { safeMessage: row.safeMessage } : {}),
    settings: row.settings,
    version: row.version,
  };
}

function toScenarioDefinition(row: typeof scenarios.$inferSelect): ScenarioDefinitionRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    kind: row.kind as ScenarioDefinition["kind"],
    configuration: row.configuration,
  };
}

function toScenarioRun(
  row: typeof scenarioRuns.$inferSelect,
  steps: ScenarioRunStep[],
): ScenarioRun {
  return {
    id: row.id,
    userId: row.userId,
    scenarioId: row.scenarioId,
    specificationId: row.specificationId,
    status: row.status,
    currentStep: row.currentStep,
    progress: row.progress,
    mode: row.mode as "NORMAL" | "DRY_RUN",
    seed: row.seed,
    version: row.version,
    ...(row.retryOfRunId ? { retryOfRunId: row.retryOfRunId } : {}),
    ...(row.startedAt ? { startedAt: row.startedAt } : {}),
    ...(row.completedAt ? { completedAt: row.completedAt } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    inputSnapshot: row.inputSnapshot,
    outputSnapshot: row.outputSnapshot,
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
    ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
    steps,
  };
}

function toScenarioRunStep(row: typeof scenarioRunSteps.$inferSelect): ScenarioRunStep {
  return {
    id: row.id,
    runId: row.runId,
    status: row.status,
    label: row.label,
    outcome: row.outcome as ScenarioRunStep["outcome"],
    startedAt: row.startedAt,
    ...(row.completedAt ? { completedAt: row.completedAt } : {}),
    ...(row.durationMs === null ? {} : { durationMs: row.durationMs }),
    details: row.details,
  };
}

function toAnalysisResult(row: typeof positionAnalysisResults.$inferSelect): AnalysisResultRecord {
  return {
    id: row.id,
    userId: row.userId,
    runId: row.runId,
    positionId: row.positionId,
    responsibility: row.responsibility as "CUSTOMER" | "CONTRACTOR",
    responsibilityConfidence: Number(row.responsibilityConfidence),
    responsibilityCitation: row.responsibilityCitation,
    matchCategory: row.matchCategory,
    matchScore: row.matchScore,
    matchedMaterialCode: row.matchedMaterialCode,
    status: row.status,
    requiresHumanReview: row.requiresHumanReview,
    result: row.result,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function toPromptVersion(row: typeof promptVersions.$inferSelect): PromptVersionRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    promptVersion: row.promptVersion,
    content: row.content,
    active: row.active,
    checksum: row.checksum,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function toDictionary(row: typeof dictionaries.$inferSelect): DictionaryRecord {
  return {
    id: row.id,
    userId: row.userId,
    dictionaryType: row.dictionaryType,
    key: row.key,
    values: row.values,
    active: row.active,
    version: row.version,
  };
}

function catalogItemConditions(userId: string, options: CatalogSearchQuery): SQL[] {
  const conditions: SQL[] = [eq(catalogItems.userId, userId)];
  const codePattern = containsPattern(options.code);
  if (codePattern) {
    conditions.push(
      or(
        ilike(catalogItems.itemCode, codePattern),
        ilike(catalogItems.legacyCode, codePattern),
        ilike(catalogItems.manufacturerPartNumber, codePattern),
      )!,
    );
  }
  const namePattern = containsPattern(options.name);
  if (namePattern) {
    conditions.push(
      or(
        ilike(catalogItems.nameRu, namePattern),
        ilike(catalogItems.nameEn, namePattern),
        sql<boolean>`${catalogItems.synonyms}::text ILIKE ${namePattern}`,
      )!,
    );
  }
  const manufacturerPattern = containsPattern(options.manufacturer);
  if (manufacturerPattern) {
    conditions.push(ilike(catalogItems.manufacturer, manufacturerPattern));
  }
  const textPattern = containsPattern(options.text);
  if (textPattern) {
    conditions.push(
      or(
        ilike(catalogItems.itemCode, textPattern),
        ilike(catalogItems.legacyCode, textPattern),
        ilike(catalogItems.manufacturerPartNumber, textPattern),
        ilike(catalogItems.nameRu, textPattern),
        ilike(catalogItems.nameEn, textPattern),
        ilike(catalogItems.manufacturer, textPattern),
        sql<boolean>`${catalogItems.synonyms}::text ILIKE ${textPattern}`,
      )!,
    );
  }
  if (options.category) {
    conditions.push(
      eq(
        sql<string>`${catalogItems.characteristics} ->> 'category'`,
        options.category,
      ),
    );
  }
  if (options.equipmentType) {
    conditions.push(eq(catalogItems.equipmentType, options.equipmentType));
  }
  if (options.itemKind) conditions.push(eq(catalogItems.itemKind, options.itemKind));
  return conditions;
}

function toCatalogItem(row: typeof catalogItems.$inferSelect): CatalogItem {
  const category = row.characteristics.category;
  return {
    id: row.id,
    itemCode: row.itemCode,
    ...(row.legacyCode ? { legacyCode: row.legacyCode } : {}),
    ...(row.manufacturerPartNumber
      ? { manufacturerPartNumber: row.manufacturerPartNumber }
      : {}),
    nameRu: row.nameRu,
    ...(row.nameEn ? { nameEn: row.nameEn } : {}),
    synonyms: row.synonyms,
    equipmentType: row.equipmentType,
    itemKind: catalogItemKind(row.itemKind),
    ...(catalogueCategory(category) ? { category: catalogueCategory(category) } : {}),
    ...(row.familyId ? { familyId: row.familyId } : {}),
    ...(row.manufacturer ? { manufacturer: row.manufacturer } : {}),
    ...(row.standard ? { standard: row.standard } : {}),
    ...(row.materialGrade ? { materialGrade: row.materialGrade } : {}),
    characteristics: row.characteristics,
    unit: row.unit,
    cardUrl: row.cardUrl,
    fixtureTags: row.fixtureTags,
    isSyntheticDemo: row.isSyntheticDemo,
  };
}

function toCatalogFamily(
  row: typeof catalogInterchangeabilityFamilies.$inferSelect,
): CatalogFamily {
  return {
    id: row.id,
    code: row.code,
    nameRu: row.nameRu,
    ...(row.nameEn ? { nameEn: row.nameEn } : {}),
    equipmentType: row.equipmentType,
    itemKind: catalogItemKind(row.itemKind),
    unit: row.unit,
    compatibilitySignature: row.compatibilitySignature,
    active: row.active,
    isSyntheticDemo: row.isSyntheticDemo,
  };
}

function toCatalogStockBalance(
  row: typeof catalogStockBalances.$inferSelect,
): CatalogStockBalance {
  return {
    id: row.id,
    plant: row.plant,
    storageLocation: row.storageLocation,
    ...(row.batch ? { batch: row.batch } : {}),
    availableQuantity: Number(row.availableQuantity),
    unit: row.unit,
    snapshotAt: row.snapshotAt,
  };
}

function emptyCatalogStockSummary(summary?: CatalogStockSummary): CatalogStockSummary {
  return summary ?? { totalAvailableQuantity: 0, balanceCount: 0 };
}

function catalogItemKind(value: string): CatalogueItemKind {
  if (value === "COMPONENT" || value === "ASSEMBLY") return value;
  throw new Error(`Каталог содержит неподдерживаемый тип позиции: ${value}.`);
}

function catalogueCategory(value: unknown): CatalogueCategory | undefined {
  return typeof value === "string" && (CATALOGUE_CATEGORIES as readonly string[]).includes(value)
    ? (value as CatalogueCategory)
    : undefined;
}

function sapConditions(userId: string, options: SapMaterialQuery): SQL[] {
  const conditions: SQL[] = [eq(sapMaterials.userId, userId)];
  if (options.equipmentType) conditions.push(eq(sapMaterials.equipmentType, options.equipmentType));
  if (options.materialCode) conditions.push(eq(sapMaterials.materialCode, options.materialCode));
  if (options.text?.trim()) {
    const pattern = `%${escapeLike(options.text.trim())}%`;
    conditions.push(
      or(
        ilike(sapMaterials.materialCode, pattern),
        ilike(sapMaterials.nameRu, pattern),
        ilike(sapMaterials.nameEn, pattern),
        ilike(sapMaterials.legacyCode, pattern),
        sql<boolean>`${sapMaterials.synonyms}::text ILIKE ${pattern}`,
      )!,
    );
  }
  return conditions;
}

function agentAuditOperationConditions(
  userId: string,
  options: AgentAuditOperationQuery,
): SQL[] {
  const conditions: SQL[] = [
    eq(auditLogs.userId, userId),
    eq(auditLogs.action, "agent.tool.result"),
  ];
  const from = auditDateBoundary(options.from, false);
  const to = auditDateBoundary(options.to, true);
  if (from) conditions.push(gte(auditLogs.occurredAt, from));
  if (to) conditions.push(lte(auditLogs.occurredAt, to));
  if (options.status) conditions.push(eq(auditLogs.outcome, options.status));

  const userPattern = containsPattern(options.user);
  if (userPattern) {
    conditions.push(
      or(
        ilike(auditLogs.userId, userPattern),
        ilike(auditLogs.actorDisplayName, userPattern),
      )!,
    );
  }

  const scenarioPattern = containsPattern(options.scenario);
  if (scenarioPattern) {
    conditions.push(
      or(
        ilike(sql<string>`coalesce(${auditLogs.details} ->> 'runId', '')`, scenarioPattern),
        ilike(sql<string>`coalesce(${auditLogs.entityId}, '')`, scenarioPattern),
      )!,
    );
  }

  const toolPattern = containsPattern(options.tool);
  if (toolPattern) {
    conditions.push(
      ilike(sql<string>`coalesce(${auditLogs.details} ->> 'tool', '')`, toolPattern),
    );
  }

  const errorPattern = containsPattern(options.errorType);
  if (errorPattern) {
    conditions.push(
      ilike(sql<string>`coalesce(${auditLogs.details} ->> 'errorCode', '')`, errorPattern),
    );
  }

  const correlationPattern = containsPattern(options.correlationId);
  if (correlationPattern) {
    conditions.push(
      ilike(
        sql<string>`coalesce(nullif(${auditLogs.requestId}, ''), nullif(${auditLogs.details} ->> 'correlationId', ''), ${auditLogs.id})`,
        correlationPattern,
      ),
    );
  }
  return conditions;
}

function auditDateBoundary(value: string | undefined, endOfDay: boolean): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const candidate = `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`;
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function containsPattern(value: string | undefined): string | null {
  const query = value?.trim();
  return query ? `%${escapeLike(query)}%` : null;
}

function executedRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as Array<Record<string, unknown>>;
  }
  return [];
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function trustedUser(userId: string): void {
  if (!userId || !userId.trim()) throw new Error("Отсутствует доверенный идентификатор пользователя.");
}

function validLimit(value: number, maximum = 200): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(maximum, Math.max(1, Math.trunc(value)));
}

function validOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Прогресс должен быть конечным числом.");
  return Math.min(100, Math.max(0, Math.trunc(value)));
}

function scenarioRunAssignments(patch: ScenarioRunUpdate, terminal: boolean): SQL[] {
  const assignments: SQL[] = [sql`updated_at = clock_timestamp()`];
  if (patch.status !== undefined) assignments.push(sql`status = ${patch.status}`);
  if (patch.currentStep !== undefined) assignments.push(sql`current_step = ${patch.currentStep}`);
  if (patch.progress !== undefined) assignments.push(sql`progress = ${clampProgress(patch.progress)}`);
  if (patch.startedAt !== undefined) {
    assignments.push(patch.startedAt === null
      ? sql`started_at = null`
      : sql`started_at = ${patch.startedAt}::timestamptz`);
  }
  if (terminal) {
    assignments.push(sql`completed_at = clock_timestamp()`);
  } else if (patch.completedAt !== undefined) {
    assignments.push(patch.completedAt === null
      ? sql`completed_at = null`
      : sql`completed_at = ${patch.completedAt}::timestamptz`);
  }
  if (patch.outputSnapshot !== undefined) {
    assignments.push(sql`output_snapshot = ${JSON.stringify(patch.outputSnapshot)}::jsonb`);
  }
  if (patch.errorCode !== undefined) {
    assignments.push(patch.errorCode === null
      ? sql`error_code = null`
      : sql`error_code = ${patch.errorCode}`);
  }
  if (patch.errorMessage !== undefined) {
    assignments.push(patch.errorMessage === null
      ? sql`error_message = null`
      : sql`error_message = ${patch.errorMessage}`);
  }
  return assignments;
}

function scenarioRunStageAssignments(patch: ScenarioRunUpdate): SQL[] {
  const assignments: SQL[] = [sql`updated_at = clock_timestamp()`];
  if (patch.outputSnapshot !== undefined) {
    assignments.push(sql`output_snapshot = ${JSON.stringify(patch.outputSnapshot)}::jsonb`);
  }
  if (patch.errorCode !== undefined) {
    assignments.push(patch.errorCode === null
      ? sql`error_code = null`
      : sql`error_code = ${patch.errorCode}`);
  }
  if (patch.errorMessage !== undefined) {
    assignments.push(patch.errorMessage === null
      ? sql`error_message = null`
      : sql`error_message = ${patch.errorMessage}`);
  }
  return assignments;
}

function scenarioRunRowFromTransition(row: Record<string, unknown>): typeof scenarioRuns.$inferSelect {
  return {
    id: String(row.runId),
    userId: String(row.runUserId),
    projectId: row.runProjectId === null ? null : String(row.runProjectId),
    scenarioId: String(row.runScenarioId),
    specificationId: String(row.runSpecificationId),
    retryOfRunId: row.runRetryOfRunId === null ? null : String(row.runRetryOfRunId),
    status: row.runStatus as ScenarioRunStatus,
    currentStep: String(row.runCurrentStep),
    progress: Number(row.runProgress),
    mode: String(row.runMode),
    seed: String(row.runSeed),
    startedAt: row.runStartedAt === null ? null : String(row.runStartedAt),
    completedAt: row.runCompletedAt === null ? null : String(row.runCompletedAt),
    inputSnapshot: row.runInputSnapshot as Record<string, unknown>,
    outputSnapshot: row.runOutputSnapshot as Record<string, unknown>,
    errorCode: row.runErrorCode === null ? null : String(row.runErrorCode),
    errorMessage: row.runErrorMessage === null ? null : String(row.runErrorMessage),
    createdAt: String(row.runCreatedAt),
    updatedAt: String(row.runUpdatedAt),
    createdBy: String(row.runCreatedBy),
    version: Number(row.runVersion),
  };
}

function scenarioStepRowFromTransition(row: Record<string, unknown>): typeof scenarioRunSteps.$inferSelect {
  return {
    id: String(row.stepId),
    runId: String(row.stepRunId),
    userId: String(row.stepUserId),
    status: row.stepStatus as ScenarioRunStatus,
    label: String(row.stepLabel),
    outcome: String(row.stepOutcome),
    startedAt: String(row.stepStartedAt),
    completedAt: row.stepCompletedAt === null ? null : String(row.stepCompletedAt),
    durationMs: row.stepDurationMs === null ? null : Number(row.stepDurationMs),
    details: row.stepDetails as Record<string, unknown>,
    idempotencyKey: String(row.stepIdempotencyKey),
    createdAt: String(row.stepCreatedAt),
    updatedAt: String(row.stepUpdatedAt),
    createdBy: String(row.stepCreatedBy),
    version: Number(row.stepVersion),
  };
}

function confidenceDecimal(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Уверенность должна находиться в диапазоне от 0 до 1.");
  }
  return value.toFixed(4);
}

function oneCalendarYearAfter(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Некорректная дата события аудита.");
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString();
}

function oneCalendarYearAfterSql(value: SQL): SQL {
  return sql`
    (
      ((${value}) at time zone 'UTC') + interval '1 year' + case
        when extract(month from (${value}) at time zone 'UTC') = 2
          and extract(day from (${value}) at time zone 'UTC') = 29
        then interval '1 day'
        else interval '0 days'
      end
    ) at time zone 'UTC'
  `;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function publicAuthUser(user: AuthUserRecord): DemoUser {
  return {
    id: user.id,
    login: user.login,
    displayName: user.displayName,
    roles: user.roles,
    locale: user.locale,
    isSyntheticDemo: user.isSyntheticDemo,
  };
}

async function getRuntimeCounts(
  database: Database,
  userId: string,
): Promise<Pick<RepositoryCounts, "scenarioRuns" | "scenarioSteps" | "analysisResults" | "auditLogs" | "uploadedFiles" | "agentThreads" | "agentMessages">> {
  const result = await database.execute(sql`
    select
      (select count(*)::int from ${scenarioRuns} where ${scenarioRuns.userId} = ${userId}) as "scenarioRuns",
      (select count(*)::int from ${scenarioRunSteps} where ${scenarioRunSteps.userId} = ${userId}) as "scenarioSteps",
      (select count(*)::int from ${positionAnalysisResults} where ${positionAnalysisResults.userId} = ${userId}) as "analysisResults",
      (select count(*)::int from ${auditLogs} where ${auditLogs.userId} = ${userId}) as "auditLogs",
      (select count(*)::int from ${uploadedFiles} where ${uploadedFiles.userId} = ${userId}) as "uploadedFiles",
      (select count(*)::int from ${agentThreads} where ${agentThreads.userId} = ${userId}) as "agentThreads",
      (select count(*)::int from ${agentMessages} where ${agentMessages.userId} = ${userId}) as "agentMessages"
  `);
  const rows = Array.isArray(result)
    ? result
    : result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)
      ? result.rows
      : [];
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("Не удалось получить счётчики рабочих данных.");
  return {
    scenarioRuns: Number(row.scenarioRuns ?? 0),
    scenarioSteps: Number(row.scenarioSteps ?? 0),
    analysisResults: Number(row.analysisResults ?? 0),
    auditLogs: Number(row.auditLogs ?? 0),
    uploadedFiles: Number(row.uploadedFiles ?? 0),
    agentThreads: Number(row.agentThreads ?? 0),
    agentMessages: Number(row.agentMessages ?? 0),
  };
}
