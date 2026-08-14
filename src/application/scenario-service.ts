import "server-only";

import { z } from "zod";

import { AppiusMockAdapter, AppiusMockError } from "@/adapters/mock/appius-adapter";
import {
  NormativeMockAdapter,
  NormativeMockError,
} from "@/adapters/mock/normative-adapter";
import { SapMockAdapter, SapMockError } from "@/adapters/mock/sap-adapter";
import {
  getRepository,
  OptimisticLockError,
  type MtrRepository,
} from "@/adapters/persistence/repository";
import {
  requirePermission,
  resolveAuthorizationContext,
  type TrustedRequestContext,
} from "@/application/authorization-service";
import { buildAnalogueCoverage, extendAnalogueCoverageWithDirectStock } from "@/domain/analogues";
import { findBestMaterial } from "@/domain/matching";
import {
  canonicalizeManualAppiusImport,
  canonicalizeManualSapImport,
  ManualImportError,
} from "@/application/manual-import";
import {
  DEMO_USER_DISPLAY_NAME,
  type AnalogueCoverage,
  type AnalogueSearchDecision,
  AnalogueRule,
  MatchExplanation,
  Position,
  PositionAnalysisResult,
  ReportSummary,
  ResponsibilityRule,
  SapMaterial,
  ScenarioRun,
  ScenarioRunStatus,
} from "@/domain/models";
import { RUN_PROGRESS, RUN_STATUS_LABELS, TERMINAL_STATUSES, canCancel } from "@/domain/scenario";
import {
  buildResponsibilityRuleManifest,
  classifyResponsibility,
  summarizeResponsibilityDecisions,
  type ResponsibilityDecision,
} from "@/domain/responsibility";

const ALL_CURRENT_SPECIFICATIONS = "ALL_CURRENT_SPECIFICATIONS";

export const createScenarioRunSchema = z.object({
  scenarioId: z.string().min(1).max(100),
  specificationId: z.string().min(1).max(100).optional(),
  mode: z.enum(["NORMAL", "DRY_RUN"]).default("NORMAL"),
  seed: z.string().min(1).max(100).default("BASE"),
});

export type CreateScenarioRunRequest = z.infer<typeof createScenarioRunSchema>;

export class ScenarioService {
  constructor(private readonly repository: MtrRepository) {}

  static async create(): Promise<ScenarioService> {
    return new ScenarioService(await getRepository());
  }

  async createRun(userId: string, rawInput: unknown, requestedBy = userId): Promise<ScenarioRun> {
    const input = createScenarioRunSchema.parse(rawInput);
    const context = await resolveAuthorizationContext(userId);
    const projectId = context.activeProjectId;
    if (!projectId) throw new ScenarioServiceError(403, "PROJECT_CONTEXT_REQUIRED", "Не выбран доступный проект");
    requirePermission(context, "analysis.create", {
      resourceType: "PROJECT",
      resourceId: projectId,
      projectId,
    });
    const { scenario, specifications } = await this.repository
      .getScenarioAndSpecificationsInProject(userId, projectId, input.scenarioId);
    if (!scenario || !scenario.enabled) throw new ScenarioServiceError(404, "SCENARIO_NOT_FOUND", "Сценарий не найден или отключён");
    if (specifications.length === 0) throw new ScenarioServiceError(409, "NO_SPECIFICATIONS", "Нет доступных актуальных спецификаций");

    const configuredSpecification = stringValue(scenario.configuration.defaultSpecificationId);
    const requestedSpecificationId = input.specificationId ?? configuredSpecification ?? ALL_CURRENT_SPECIFICATIONS;
    const isAllCurrent = requestedSpecificationId === ALL_CURRENT_SPECIFICATIONS;
    const configuredSpecificationIds = stringArray(
      scenario.configuration.analysisSpecificationIds,
    );
    const selected = isAllCurrent
      ? configuredSpecificationIds.length > 0
        ? specifications.filter((item) => configuredSpecificationIds.includes(item.id))
        : specifications
      : specifications.filter((item) => item.id === requestedSpecificationId);
    if (selected.length === 0) throw new ScenarioServiceError(404, "SPECIFICATION_NOT_FOUND", "Спецификация не найдена");

    const now = new Date().toISOString();
    const run = await this.repository.createScenarioRunInProject(userId, projectId, {
      projectId,
      scenarioId: scenario.id,
      specificationId: selected[0]!.id,
      mode: input.mode,
      seed: input.seed,
      inputSnapshot: {
        schemaVersion: "1.0.0",
        capturedAt: now,
        fixtureSet: "BASE",
        sourceKind: "MOCK_OPERATIONAL_DATA",
        scenarioId: scenario.id,
        scenarioKind: scenario.kind,
        scenarioConfiguration: scenario.configuration,
        requestedBy,
        trustedScope: {
          projectId,
          sourceScopeIds: context.sourceScopeIds,
          authorizationVersion: context.authorizationVersion,
          displayName: context.displayName,
          activeRoleAssignmentIds: context.activeRoleAssignmentIds,
          globalRoleKeys: context.globalRoleKeys,
          projectRoleKeys: context.projectRoleKeys,
          accessClaims: context.accessClaims,
        },
        specificationScope: isAllCurrent ? "ALL_CURRENT" : "SINGLE",
        requestedSpecificationId,
        specificationIds: selected.map((item) => item.id),
        versionResolutionPolicy: "LATEST_AT_RUN_START",
        sapSnapshotPolicy: "CURRENT_AT_RUN_START",
        mode: input.mode,
        seed: input.seed,
        isSyntheticDemo: true,
      },
      outputSnapshot: { schemaVersion: "1.0.0", isSyntheticDemo: true },
    });
    await this.repository.writeAudit(userId, {
      action: "SCENARIO_RUN_CREATED",
      entityType: "SCENARIO_RUN",
      entityId: run.id,
      outcome: "SUCCESS",
      details: { scenarioId: scenario.id, specificationScope: isAllCurrent ? "ALL_CURRENT" : "SINGLE", mode: input.mode },
    });
    return run;
  }

  async listRuns(userId: string, options: { includeSteps?: boolean } = {}): Promise<ScenarioRun[]> {
    return this.repository.listRuns(userId, { limit: 100, ...options });
  }

  async getRun(userId: string, runId: string): Promise<ScenarioRun> {
    const run = await this.repository.getRun(userId, runId);
    if (!run) throw new ScenarioServiceError(404, "RUN_NOT_FOUND", "Запуск не найден");
    return run;
  }

  async advance(
    userId: string,
    runId: string,
    expectedVersion?: number,
    currentRun?: ScenarioRun,
  ): Promise<ScenarioRun> {
    const trustedCurrentRun = expectedVersion !== undefined &&
      currentRun?.userId === userId &&
      currentRun.id === runId &&
      currentRun.version === expectedVersion
      ? currentRun
      : undefined;
    let run = trustedCurrentRun ?? await this.getRun(userId, runId);
    if (TERMINAL_STATUSES.has(run.status)) return run;
    if (expectedVersion !== undefined && expectedVersion !== run.version) {
      throw new OptimisticLockError(run.id);
    }
    if (pendingTerminalStage(run)) {
      return this.repository.publishStagedTerminalRun(userId, run.id, run.version);
    }

    let scenarioConfiguration = recordValue(run.inputSnapshot.scenarioConfiguration);
    let scenarioKind = stringValue(run.inputSnapshot.scenarioKind);
    if (!scenarioConfiguration || !scenarioKind) {
      const scenario = run.projectId
        ? await this.repository.getScenarioInProject(userId, run.projectId, run.scenarioId)
        : await this.repository.getScenario(userId, run.scenarioId);
      if (!scenario) throw new ScenarioServiceError(409, "SCENARIO_REMOVED", "Определение сценария недоступно");
      scenarioConfiguration = scenario.configuration;
      scenarioKind = scenario.kind;
    }
    const steps = scenarioSteps(scenarioConfiguration);
    const stepStatus = run.status === "QUEUED" ? steps[0] : run.status;
    if (!stepStatus || !steps.includes(stepStatus)) {
      throw new ScenarioServiceError(409, "INVALID_RUN_STATE", "Запуск находится в несовместимом состоянии");
    }
    const previousAttempts = run.steps.filter((item) => item.status === stepStatus);
    const lastAttempt = previousAttempts.at(-1);
    const attemptNumber = Math.max(
      1,
      lastAttempt?.outcome === "FAILED" ? previousAttempts.length + 1 : previousAttempts.length,
    );
    const stepIdempotencyKey = `${run.id}:${stepStatus}:attempt-${attemptNumber}`;

    const startedAt = new Date().toISOString();
    const persistedSteps = run.steps;
    const claimed = await this.repository.claimScenarioStep(
      userId,
      run.id,
      run.version,
      {
        runId: run.id,
        status: stepStatus,
        label: RUN_STATUS_LABELS[stepStatus],
        outcome: "STARTED",
        startedAt,
        idempotencyKey: stepIdempotencyKey,
        details: { attemptVersion: run.version + 1 },
        runPatch: {
          status: stepStatus,
          currentStep: stepStatus,
          progress: RUN_PROGRESS[stepStatus],
          startedAt: run.startedAt ?? startedAt,
        },
      },
      { includeSteps: false },
    );
    run = mergeRunStep({ ...claimed.run, steps: persistedSteps }, claimed.step);

    let outputSnapshot: Record<string, unknown>;
    try {
      outputSnapshot = await this.executeStep(userId, run, stepStatus, scenarioKind);
    } catch (executionError) {
      const failure = asExecutionFailure(executionError);
      if (!failure) throw executionError;
      const failedAt = new Date().toISOString();
      const output = cloneSnapshot(run.outputSnapshot);
      output.failure = {
        step: stepStatus,
        code: failure.code,
        safeMessage: failure.message,
        recommendedAction: failure.recommendedAction,
        occurredAt: failedAt,
      };
      const failed = await this.repository.finishScenarioStepTransition(
        userId,
        run.id,
        run.version,
        {
          runId: run.id,
          status: stepStatus,
          label: RUN_STATUS_LABELS[stepStatus],
          outcome: "FAILED",
          startedAt,
          completedAt: failedAt,
          durationMs: Math.max(0, Date.parse(failedAt) - Date.parse(startedAt)),
          idempotencyKey: stepIdempotencyKey,
          details: { errorCode: failure.code, recommendedAction: failure.recommendedAction },
          runPatch: {
            status: "FAILED",
            currentStep: stepStatus,
            progress: RUN_PROGRESS[stepStatus],
            completedAt: failedAt,
            outputSnapshot: output,
            errorCode: failure.code,
            errorMessage: failure.message,
          },
        },
        { includeSteps: false },
      );
      const failedSteps = mergeRunStep(run, failed.step).steps;
      const published = await this.repository.publishStagedTerminalRun(
        userId,
        run.id,
        failed.run.version,
        { includeSteps: false },
      );
      return { ...published, steps: failedSteps };
    }

    const completedAt = new Date().toISOString();
    const next = nextConfiguredStep(steps, stepStatus);
    const completed = await this.repository.finishScenarioStepTransition(userId, run.id, run.version, {
      runId: run.id,
      status: stepStatus,
      label: RUN_STATUS_LABELS[stepStatus],
      outcome: "COMPLETED",
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
      idempotencyKey: stepIdempotencyKey,
      details: {
        ...safeStepDetails(stepStatus, outputSnapshot),
        auditNext: next ?? "COMPLETED",
      },
      runPatch: next
        ? {
          status: next,
          currentStep: next,
          progress: RUN_PROGRESS[next],
          completedAt: null,
          outputSnapshot,
          errorCode: null,
          errorMessage: null,
        }
        : {
          status: "COMPLETED",
          currentStep: "COMPLETED",
          progress: 100,
          completedAt,
          outputSnapshot,
          errorCode: null,
          errorMessage: null,
        },
    }, { includeSteps: false });
    const completedSteps = mergeRunStep(run, completed.step).steps;
    if (!completed.terminalStaged) {
      return { ...completed.run, steps: completedSteps };
    }
    const published = await this.repository.publishStagedTerminalRun(
      userId,
      run.id,
      completed.run.version,
      { includeSteps: false },
    );
    return { ...published, steps: completedSteps };
  }

  async cancel(userId: string, runId: string): Promise<ScenarioRun> {
    let run = await this.getRun(userId, runId);
    if (pendingTerminalStage(run)) {
      return this.repository.publishStagedTerminalRun(userId, run.id, run.version);
    }
    if (!canCancel(run.status)) return run;
    const now = new Date().toISOString();
    try {
      const staged = await this.repository.stageScenarioCancellation(userId, run.id, run.version, {
        runId: run.id,
        status: run.status,
        label: "Запуск отменён администратором",
        outcome: "CANCELLED",
        startedAt: now,
        completedAt: now,
        durationMs: 0,
        idempotencyKey: `${run.id}:CANCELLED`,
        details: {},
      }, { includeSteps: false });
      return this.repository.publishStagedTerminalRun(userId, run.id, staged.run.version);
    } catch (error) {
      if (!(error instanceof OptimisticLockError)) throw error;
      run = await this.getRun(userId, runId);
      if (pendingTerminalStage(run)) {
        return this.repository.publishStagedTerminalRun(userId, run.id, run.version);
      }
      if (!canCancel(run.status)) return run;
      throw error;
    }
  }

  async retry(userId: string, runId: string): Promise<ScenarioRun> {
    let original = await this.getRun(userId, runId);
    if (pendingTerminalStage(original)) {
      original = await this.repository.publishStagedTerminalRun(
        userId,
        original.id,
        original.version,
      );
    }
    const snapshot = cloneSnapshot(original.inputSnapshot);
    const projectId = original.projectId ?? "demo-project-001";
    const retry = await this.repository.createScenarioRunInProject(userId, projectId, {
      projectId,
      scenarioId: original.scenarioId,
      specificationId: original.specificationId,
      retryOfRunId: original.id,
      mode: original.mode,
      seed: original.seed,
      inputSnapshot: { ...snapshot, retriedAt: new Date().toISOString(), retryOfRunId: original.id },
      outputSnapshot: { schemaVersion: "1.0.0", isSyntheticDemo: true },
    });
    await this.repository.writeAudit(userId, {
      action: "SCENARIO_RUN_RETRIED",
      entityType: "SCENARIO_RUN",
      entityId: retry.id,
      outcome: "SUCCESS",
      details: { retryOfRunId: original.id },
    });
    return retry;
  }

  async resumeWithManualImport(
    userId: string,
    runId: string,
    uploadedFileId: string,
    expectedVersion?: number,
  ): Promise<ScenarioRun> {
    const [initialRun, file] = await Promise.all([
      this.getRun(userId, runId),
      this.repository.getUploadedFile(userId, uploadedFileId),
    ]);
    let run = initialRun;
    if (!file || file.parseStatus !== "PARSED") {
      throw new ScenarioServiceError(400, "MANUAL_IMPORT_NOT_READY", "Файл ручного импорта не прошёл проверку");
    }
    if (expectedVersion !== undefined && expectedVersion !== run.version) {
      throw new OptimisticLockError(run.id);
    }
    if (pendingTerminalStage(run)) {
      run = await this.repository.publishStagedTerminalRun(userId, run.id, run.version);
      if (expectedVersion !== undefined) throw new OptimisticLockError(run.id);
    }
    const sourceSystem = manualImportSystem(run.errorCode);
    if (!sourceSystem) {
      throw new ScenarioServiceError(409, "MANUAL_IMPORT_NOT_REQUIRED", "Для текущего состояния запуска ручной импорт не требуется");
    }
    const acceptedAt = new Date().toISOString();
    const output = cloneSnapshot(run.outputSnapshot);
    let resumedStatus: "SYNCING_SAP" | "LOADING_APPIUS";
    let auditAction: string;
    let auditDetails: Record<string, unknown>;
    try {
      if (sourceSystem === "SAP") {
        const canonical = canonicalizeManualSapImport(file.normalizedData, {
          userId,
          checksumSha256: file.checksumSha256,
          acceptedAt,
        });
        output.manualSapImport = {
          sourceKind: "UPLOADED_FILE",
          uploadedFileId: file.id,
          checksumSha256: file.checksumSha256,
          snapshotId: canonical.snapshotId,
          snapshotAt: canonical.snapshotAt,
          materials: canonical.materials,
          recordCount: canonical.materials.length,
          warnings: canonical.warnings,
          acceptedAt,
        };
        resumedStatus = "SYNCING_SAP";
        auditAction = "SCENARIO_MANUAL_SAP_IMPORT_ATTACHED";
        auditDetails = {
          uploadedFileId: file.id,
          checksumSha256: file.checksumSha256,
          snapshotId: canonical.snapshotId,
          recordCount: canonical.materials.length,
        };
      } else {
        const specification = await this.repository.getSpecification(userId, run.specificationId);
        if (!specification) {
          throw new ScenarioServiceError(409, "SPECIFICATION_NOT_FOUND", "Спецификация запуска недоступна");
        }
        const canonical = canonicalizeManualAppiusImport(file.normalizedData, {
          userId,
          checksumSha256: file.checksumSha256,
          acceptedAt,
          specificationId: run.specificationId,
          specificationName: `${specification.name} · ручной импорт`,
        });
        output.manualAppiusImport = {
          sourceKind: "UPLOADED_FILE",
          uploadedFileId: file.id,
          checksumSha256: file.checksumSha256,
          versionId: canonical.versionId,
          capturedAt: canonical.capturedAt,
          positions: canonical.positions,
          positionCount: canonical.positions.length,
          specificationName: `${specification.name} · ручной импорт`,
          warnings: canonical.warnings,
          acceptedAt,
        };
        resumedStatus = "LOADING_APPIUS";
        auditAction = "SCENARIO_MANUAL_APPIUS_IMPORT_ATTACHED";
        auditDetails = {
          uploadedFileId: file.id,
          checksumSha256: file.checksumSha256,
          versionId: canonical.versionId,
          positionCount: canonical.positions.length,
        };
      }
    } catch (error) {
      if (error instanceof ManualImportError) {
        throw new ScenarioServiceError(400, error.code, error.message);
      }
      throw error;
    }
    delete output.failure;
    const resumed = await this.repository.updateRun(userId, run.id, {
      status: resumedStatus,
      currentStep: resumedStatus,
      progress: RUN_PROGRESS[resumedStatus],
      completedAt: null,
      outputSnapshot: output,
      errorCode: null,
      errorMessage: null,
    }, run.version);
    await this.repository.writeAudit(userId, {
      action: auditAction,
      entityType: "SCENARIO_RUN",
      entityId: run.id,
      outcome: "SUCCESS",
      details: auditDetails,
    });
    return resumed;
  }

  async resumeWithManualSapImport(
    userId: string,
    runId: string,
    uploadedFileId: string,
    expectedVersion?: number,
  ): Promise<ScenarioRun> {
    const run = await this.getRun(userId, runId);
    if (manualImportSystem(run.errorCode) !== "SAP") {
      throw new ScenarioServiceError(409, "MANUAL_SAP_IMPORT_NOT_REQUIRED", "Для запуска ручной импорт SAP не требуется");
    }
    return this.resumeWithManualImport(userId, runId, uploadedFileId, expectedVersion);
  }

  private async executeStep(
    userId: string,
    run: ScenarioRun,
    step: ScenarioRunStatus,
    scenarioKind: string,
  ): Promise<Record<string, unknown>> {
    const context = await this.resolveRunContext(userId, run);
    const output = cloneSnapshot(run.outputSnapshot);
    switch (step) {
      case "LOADING_APPIUS":
        return this.loadAppius(userId, run, output, scenarioKind, context);
      case "SYNCING_SAP":
        return this.syncSap(userId, run, output, scenarioKind, context);
      case "CLASSIFYING_RESPONSIBILITY":
        return this.classify(output, context, run);
      case "MATCHING_STOCK":
        return this.matchStock(output);
      case "FINDING_ANALOGUES":
        return this.findAnalogues(userId, run, output, context);
      case "GENERATING_REPORT":
        return this.generateReport(userId, run, output);
      default:
        throw new ExecutionFailure("UNSUPPORTED_STEP", "Шаг сценария не поддерживается", "RETRY");
    }
  }

  private async loadAppius(
    userId: string,
    run: ScenarioRun,
    output: Record<string, unknown>,
    scenarioKind: string,
    context: TrustedRequestContext,
  ): Promise<Record<string, unknown>> {
    const state = await this.repository.getIntegrationStateInSourceScopes(
      context.sourceScopeIds,
      "APPIUS",
    );
    await applyIntegrationDelay(state?.delayMs ?? 0);
    const manualImport = recordValue(output.manualAppiusImport);
    const manualPositions = Array.isArray(manualImport?.positions)
      ? (manualImport.positions as Position[])
      : [];
    if (manualPositions.length > 0) {
      const versionId = stringValue(manualImport?.versionId) ?? `manual-appius-${run.id}`;
      const specificationName = stringValue(manualImport?.specificationName) ?? "Спецификация · ручной импорт";
      output.appius = {
        state: "MANUAL_IMPORT",
        sourceKind: "UPLOADED_FILE",
        snapshotAt: manualImport?.capturedAt,
        versionPolicy: "UPLOADED_FILE_CURRENT",
        specifications: [{
          id: run.specificationId,
          userId,
          projectCode: "MANUAL-IMPORT",
          name: specificationName,
          latestVersionId: versionId,
          latestVersionNumber: 1,
          positionCount: manualPositions.length,
        }],
        versions: [{
          id: versionId,
          specificationId: run.specificationId,
          userId,
          versionNumber: 1,
          isCurrent: true,
          status: "ACTIVE",
          effectiveAt: manualImport?.capturedAt,
          positionCount: manualPositions.length,
        }],
        positions: manualPositions,
        positionCount: manualPositions.length,
        uploadedFileId: manualImport?.uploadedFileId,
        checksumSha256: manualImport?.checksumSha256,
      };
      return output;
    }
    if (state?.state === "UNAVAILABLE") throw new ExecutionFailure("APPIUS_UNAVAILABLE", state.safeMessage ?? "Appius PLM временно недоступен", "MANUAL_IMPORT");
    if (state?.state === "ACCESS_DENIED") throw new ExecutionFailure("APPIUS_ACCESS_DENIED", "Нет доступа к данным Appius PLM", "CONTACT_ADMIN");
    if (state?.state === "STALE_VERSION" && scenarioKind !== "APPIUS_NEW_VERSION") {
      throw new ExecutionFailure("APPIUS_STALE_VERSION", state.safeMessage ?? "Appius PLM вернул устаревшую версию", "MANUAL_IMPORT");
    }

    const scenarioConfiguration = recordValue(run.inputSnapshot.scenarioConfiguration);
    const eventFixture = recordValue(scenarioConfiguration?.eventFixture);
    const eventSpecificationId = stringValue(eventFixture?.specificationId) ?? run.specificationId;
    const eventCurrentVersionId = stringValue(eventFixture?.currentVersionId);
    const newVersionEvent = scenarioKind === "APPIUS_NEW_VERSION"
      ? await new AppiusMockAdapter(this.repository).processNewVersionEvent({
          eventId: stringValue(eventFixture?.eventId) ??
            `appius-new-version:${eventSpecificationId}:${eventCurrentVersionId ?? "current"}`,
          specificationId: eventSpecificationId,
          ...(stringValue(eventFixture?.previousVersionId)
            ? { previousVersionId: stringValue(eventFixture?.previousVersionId) }
            : {}),
          ...(eventCurrentVersionId
            ? { currentVersionId: eventCurrentVersionId }
            : {}),
        }, userId)
      : undefined;

    const ids = stringArray(run.inputSnapshot.specificationIds);
    const projectId = context.activeProjectId!;
    const [positionGroups, specifications] = await Promise.all([
      ids.length > 0
        ? Promise.all(
            ids.map((specificationId) =>
              this.repository.listPositionsInProject(userId, projectId, {
                specificationId,
                currentOnly: true,
              }),
            ),
          )
        : this.repository
            .listPositionsInProject(userId, projectId, { currentOnly: true })
            .then((positions) => [positions]),
      this.repository.listSpecificationsInProject(userId, projectId),
    ]);
    const positions = positionGroups.flat();
    const selectedPositions = positions.filter((position) => ids.length === 0 || ids.includes(position.specificationId));
    const selectedSpecifications = specifications.filter((item) => ids.length === 0 || ids.includes(item.id));
    const versions = await Promise.all(
      selectedSpecifications.map((item) =>
        this.repository.getLatestVersionInProject(userId, projectId, item.id)),
    );
    if (selectedPositions.length === 0 || versions.some((version) => !version?.isCurrent)) {
      throw new ExecutionFailure("APPIUS_STALE_VERSION", "Не удалось разрешить актуальную версию Appius", "RETRY");
    }
    output.appius = {
      state: state?.state ?? "AVAILABLE",
      snapshotAt: new Date().toISOString(),
      versionPolicy: "LATEST_ONLY",
      specifications: selectedSpecifications,
      versions,
      positions: selectedPositions,
      positionCount: selectedPositions.length,
      ...(newVersionEvent ? { newVersionEvent } : {}),
      staleVersionRejected: Boolean(newVersionEvent?.rejectedVersionId),
    };
    return output;
  }

  private async syncSap(
    userId: string,
    run: ScenarioRun,
    output: Record<string, unknown>,
    scenarioKind: string,
    context: TrustedRequestContext,
  ): Promise<Record<string, unknown>> {
    const manualImport = recordValue(output.manualSapImport);
    const manualMaterials = Array.isArray(manualImport?.materials)
      ? (manualImport.materials as SapMaterial[])
      : [];
    const hasManualImport = manualMaterials.length > 0;
    if (scenarioKind === "SAP_FAILURE" && !hasManualImport) {
      throw new ExecutionFailure(
        "SAP_UNAVAILABLE",
        "SAP S/4HANA временно недоступна",
        "MANUAL_IMPORT",
      );
    }

    const stock = hasManualImport
      ? {
          items: manualMaterials,
          total: manualMaterials.length,
          snapshotAt: stringValue(manualImport?.snapshotAt) ?? new Date().toISOString(),
          integrationState: "AVAILABLE" as const,
          freshness: "CURRENT" as const,
        }
      : await new SapMockAdapter(this.repository).searchMaterialStockInScope(
          { top: 100 },
          context.sourceScopeIds,
          context.accessClaims.warehouseIds ?? [],
        );
    const stale = !hasManualImport && stock.freshness === "STALE";
    output.sap = {
      state: hasManualImport ? "MANUAL_IMPORT" : stock.integrationState,
      snapshotAt: stock.snapshotAt,
      recordCount: stock.total,
      materials: stock.items,
      sourceKind: hasManualImport ? "UPLOADED_FILE" : "SAP_MOCK_ODATA",
      freshness: {
        status: stock.freshness,
        snapshotAt: stock.snapshotAt,
        ...(stale
          ? {
              warning: stock.warning,
              fallbackPolicy: stock.fallbackPolicy,
            }
          : {}),
        ...("lastSynchronizedAt" in stock && stock.lastSynchronizedAt
          ? { lastSynchronizedAt: stock.lastSynchronizedAt }
          : {}),
      },
      ...(stale && stock.warning ? { warnings: [stock.warning] } : {}),
      ...(hasManualImport
        ? {
            snapshotId: manualImport?.snapshotId,
            uploadedFileId: manualImport?.uploadedFileId,
            checksumSha256: manualImport?.checksumSha256,
          }
        : {}),
    };
    if (stale) {
      await this.repository.writeAudit(userId, {
        action: "SCENARIO_SAP_STALE_SNAPSHOT_USED",
        entityType: "SCENARIO_RUN",
        entityId: run.id,
        outcome: "SUCCESS",
        details: {
          snapshotAt: stock.snapshotAt,
          freshness: "STALE",
          fallbackPolicy: stock.fallbackPolicy,
        },
      });
    }
    return output;
  }

  private async classify(
    output: Record<string, unknown>,
    context: TrustedRequestContext,
    run: ScenarioRun,
  ): Promise<Record<string, unknown>> {
    const positions = positionsFrom(output);
    const normative = new NormativeMockAdapter(this.repository);
    const scope = { subjectId: context.subjectId, sourceScopeIds: context.sourceScopeIds };
    const [rulesByPosition, corpus] = await Promise.all([
      normative.searchResponsibilityRulesBatchInScope(positions, scope),
      normative.getResponsibilityRuleCorpusInScope(scope),
    ]);
    output.responsibilityRules = corpus;
    output.responsibilityRuleManifest = buildResponsibilityRuleManifest(corpus, {
      projectId: context.activeProjectId!,
      sourceScopeId: context.sourceScopeIds.find((id) => id.includes("normative")) ?? "UNAVAILABLE",
      datasetVersion: "normative-base-v1@1.0.0",
    });
    if (corpus.length === 0) {
      output.responsibilityDegradation = {
        status: "UNAVAILABLE",
        reason: "ACTIVE_RULE_CORPUS_EMPTY",
        requiresHumanReview: true,
      };
      await this.repository.writeAudit(context.subjectId, {
        action: "SCENARIO_NORMATIVE_CORPUS_UNAVAILABLE",
        entityType: "SCENARIO_RUN",
        entityId: run.id,
        outcome: "FAILURE",
        details: {
          projectId: context.activeProjectId,
          sourceScopeIds: context.sourceScopeIds,
          safeErrorCode: "ACTIVE_RULE_CORPUS_EMPTY",
        },
      });
    }
    output.responsibility = Object.fromEntries(
      positions.map((position) => [
        position.id,
        classifyResponsibility(position, rulesByPosition.get(position.id) ?? []),
      ]),
    );
    return output;
  }

  private async matchStock(output: Record<string, unknown>): Promise<Record<string, unknown>> {
    const positions = positionsFrom(output);
    const materials = materialsFrom(output);
    output.matches = Object.fromEntries(
      positions.map((position) => [position.id, findBestMaterial(position, materials)]),
    );
    return output;
  }

  private async findAnalogues(
    userId: string,
    run: ScenarioRun,
    output: Record<string, unknown>,
    context: TrustedRequestContext,
  ): Promise<Record<string, unknown>> {
    const positions = positionsFrom(output);
    const materials = materialsFrom(output).filter((item) => item.fixtureTags?.includes("case:analogue"));
    const normative = new NormativeMockAdapter(this.repository);
    const rules = new Map<string, AnalogueRule>();
    const reserved = new Map<string, number>();
    const coverages: Record<string, AnalogueCoverage> = {};
    const searches: Record<string, AnalogueSearchDecision> = {};
    const positionsWithShortage = positions.filter((position) => {
      const match = matchFor(output, position.id);
      return !match.material || match.material.availableQuantity < position.requiredQuantity;
    });
    const rulesByPosition = await normative.searchAnalogueRulesBatchInScope(
      positionsWithShortage,
      { subjectId: context.subjectId, sourceScopeIds: context.sourceScopeIds },
    );
    for (const position of positionsWithShortage) {
      const match = matchFor(output, position.id);
      const directMaterial = match.material;
      const directCoveredQuantity = Math.min(
        position.requiredQuantity,
        directMaterial?.availableQuantity ?? 0,
      );
      if (directMaterial && directCoveredQuantity > 0) {
        reserved.set(
          directMaterial.id,
          (reserved.get(directMaterial.id) ?? 0) + directCoveredQuantity,
        );
      }
      const shortageQuantity = position.requiredQuantity - directCoveredQuantity;
      if (shortageQuantity <= 0) continue;
      const applicableRules = rulesByPosition.get(position.id) ?? [];
      for (const rule of applicableRules) {
        rules.set(`${rule.documentId}:${rule.version}:${rule.clauseId}`, rule);
      }
      const coverage = buildAnalogueCoverage(
        { ...position, requiredQuantity: shortageQuantity },
        materials,
        applicableRules,
        reserved,
      );
      searches[position.id] = {
        directCoveredQuantity,
        shortageQuantity,
        outcome: coverage
          ? "ALLOCATED"
          : applicableRules.length === 0
            ? "NO_APPLICABLE_RULE"
            : "NO_ELIGIBLE_CANDIDATE",
        ruleCount: applicableRules.length,
      };
      if (coverage) {
        coverages[position.id] = extendAnalogueCoverageWithDirectStock(
          coverage,
          position.requiredQuantity,
          directCoveredQuantity,
        );
      }
    }
    output.analogueRules = [...rules.values()];
    output.analogueSearches = searches;
    output.analogues = coverages;
    output.analysisResults = await this.materializeResults(
      userId,
      run.id,
      output,
      run.version,
      "FINDING_ANALOGUES",
    );
    return output;
  }

  private async generateReport(
    userId: string,
    run: ScenarioRun,
    output: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let results = analysisResultsFrom(output);
    if (results.length === 0) {
      results = await this.materializeResults(
        userId,
        run.id,
        output,
        run.version,
        "GENERATING_REPORT",
      );
      output.analysisResults = results;
    }
    const summary = summarize(results);
    const activePrompt = await this.repository.getActivePrompt(userId);
    output.report = {
      schemaVersion: "1.0.0",
      runId: run.id,
      scenarioId: run.scenarioId,
      generatedAt: new Date().toISOString(),
      user: DEMO_USER_DISPLAY_NAME,
      status: "COMPLETED",
      summary,
      results,
      provenance: {
        appius: recordValue(output.appius)?.snapshotAt,
        appiusVersions: uniqueAppiusVersions(results),
        sap: recordValue(output.sap)?.snapshotAt,
        normative: "normative-base-v1@1.0.0",
        responsibilityRules: ruleVersionManifest(output.responsibilityRules),
        responsibilityRuleManifest: output.responsibilityRuleManifest ?? buildResponsibilityRuleManifest([], {
          projectId: run.projectId ?? "UNAVAILABLE",
          sourceScopeId: "UNAVAILABLE",
          datasetVersion: "UNAVAILABLE",
        }),
        analogueRules: ruleVersionManifest(output.analogueRules),
        prompt: activePrompt
          ? {
              id: activePrompt.id,
              name: activePrompt.name,
              version: activePrompt.promptVersion,
              checksum: activePrompt.checksum,
            }
          : null,
      },
      isSyntheticDemo: true,
    };
    return output;
  }

  private async materializeResults(
    userId: string,
    runId: string,
    output: Record<string, unknown>,
    expectedRunVersion: number,
    expectedRunStatus: ScenarioRunStatus,
  ): Promise<PositionAnalysisResult[]> {
    const positions = positionsFrom(output);
    const responsibilityMap = recordValue(output.responsibility) ?? {};
    const analogueSearchMap = recordValue(output.analogueSearches) ?? {};
    const analogueMap = recordValue(output.analogues) ?? {};
    const results = positions.map((position): PositionAnalysisResult => {
      const match = matchFor(output, position.id);
      const responsibilityCandidate = responsibilityMap[position.id];
      const responsibility = isResponsibilityDecision(responsibilityCandidate)
        ? responsibilityCandidate
        : fallbackResponsibility(position, output.responsibilityRules as ResponsibilityRule[] | undefined);
      const analogueCandidate = analogueMap[position.id];
      const analogueSearchCandidate = analogueSearchMap[position.id];
      const analogueSearch = isAnalogueSearchDecision(analogueSearchCandidate)
        ? analogueSearchCandidate
        : undefined;
      const analogueCoverage = isAnalogueCoverage(analogueCandidate) ? analogueCandidate : undefined;
      const directEnough = Boolean(match.material && match.material.availableQuantity >= position.requiredQuantity);
      const status = directEnough
        ? "FOUND"
        : analogueCoverage?.complete
          ? "ANALOGUES"
          : analogueCoverage
            ? "INSUFFICIENT"
            : match.material
              ? "INSUFFICIENT"
              : "NOT_FOUND";
      return {
        position,
        responsibilityDecisionState: responsibility.decisionState,
        responsibility: responsibility.responsibility,
        responsibilityConfidence: responsibility.confidence,
        responsibilityExplanation: responsibility.explanation,
        responsibilityCitation: responsibility.citation,
        responsibilityCandidateCitations: responsibility.candidateCitations,
        match,
        ...(analogueSearch ? { analogueSearch } : {}),
        ...(analogueCoverage ? { analogueCoverage } : {}),
        status,
        requiresHumanReview:
          responsibility.requiresHumanReview ||
          match.requiresHumanReview ||
          Boolean(analogueCoverage?.allocations.some((item) => item.verdict !== "SUITABLE")),
      };
    });
    await this.repository.saveAnalysisResults(
      userId,
      results.map((result) => ({
          runId,
          positionId: result.position.id,
          responsibilityDecisionState: result.responsibilityDecisionState ?? (
            result.responsibility === null
              ? "INSUFFICIENT_DATA"
              : result.requiresHumanReview
                ? "REVIEW_REQUIRED"
                : "RESOLVED"
          ),
          responsibility: result.responsibility,
          responsibilityConfidence: result.responsibilityConfidence,
          responsibilityCitation: result.responsibilityCitation as unknown as Record<string, unknown> | null,
          matchCategory: result.match.category,
          matchScore: result.match.score,
          matchedMaterialCode: result.match.material?.materialCode,
          status: result.status,
          requiresHumanReview: result.requiresHumanReview,
          result: result as unknown as Record<string, unknown>,
          sourceKind: result.position.fixtureTags?.includes("source:manual-import")
            ? "MANUAL_IMPORT"
            : "CANONICAL",
        })),
      { expectedRunVersion, expectedRunStatus },
    );
    return results;
  }

  private async resolveRunContext(
    userId: string,
    run: ScenarioRun,
  ): Promise<TrustedRequestContext> {
    const frozen = recordValue(run.inputSnapshot.trustedScope);
    const frozenProjectId = stringValue(frozen?.projectId);
    const frozenSourceScopeIds = stringArray(frozen?.sourceScopeIds);
    const frozenAuthorizationVersion = finiteInteger(frozen?.authorizationVersion);
    if (
      frozenProjectId &&
      frozenProjectId === run.projectId &&
      frozenSourceScopeIds.length > 0 &&
      frozenAuthorizationVersion !== undefined &&
      await this.repository.isScenarioRunAuthorizationCurrent(
        userId,
        frozenProjectId,
        frozenAuthorizationVersion,
        {
          activeRoleAssignmentIds: stringArray(frozen?.activeRoleAssignmentIds),
          accessClaims: accessClaimsFrom(frozen?.accessClaims),
        },
      )
    ) {
      return {
        subjectId: userId,
        displayName: stringValue(frozen?.displayName) ?? userId,
        activeRoleAssignmentIds: stringArray(frozen?.activeRoleAssignmentIds),
        globalRoleKeys: [],
        activeProjectId: frozenProjectId,
        projectRoleKeys: [],
        permissionKeys: new Set(["analysis.create"] as const),
        catalogScopeIds: [],
        sourceScopeIds: frozenSourceScopeIds,
        accessClaims: accessClaimsFrom(frozen?.accessClaims),
        authorizationVersion: frozenAuthorizationVersion,
        requestId: `scenario-${run.id}-v${run.version}`,
      };
    }
    const context = await resolveAuthorizationContext(userId, run.projectId);
    if (!context.activeProjectId || context.activeProjectId !== run.projectId) {
      throw new ScenarioServiceError(403, "PROJECT_ACCESS_REVOKED", "Доступ к проекту запуска отозван");
    }
    requirePermission(context, "analysis.create", {
      resourceType: "SCENARIO_RUN",
      resourceId: run.id,
      projectId: context.activeProjectId,
      ownerUserId: userId,
    });
    const frozenAssignmentIds = stringArray(frozen?.activeRoleAssignmentIds);
    const frozenClaims = accessClaimsFrom(frozen?.accessClaims);
    if (
      frozenAssignmentIds.some((id) => !context.activeRoleAssignmentIds.includes(id)) ||
      frozenSourceScopeIds.some((id) => !context.sourceScopeIds.includes(id)) ||
      !claimsContain(context.accessClaims, frozenClaims)
    ) {
      throw new ScenarioServiceError(403, "RUN_SCOPE_REVOKED", "Область доступа запуска изменилась");
    }
    return context;
  }
}

export class ScenarioServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ScenarioServiceError";
  }
}

class ExecutionFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recommendedAction: "MANUAL_IMPORT" | "CONTACT_ADMIN" | "RETRY",
  ) {
    super(message);
    this.name = "ExecutionFailure";
  }
}

function asExecutionFailure(error: unknown): ExecutionFailure | null {
  if (error instanceof ExecutionFailure) return error;
  if (error instanceof AppiusMockError) {
    return new ExecutionFailure(error.code, error.safeMessage, "RETRY");
  }
  if (error instanceof SapMockError) {
    return new ExecutionFailure(error.code, error.safeMessage, "MANUAL_IMPORT");
  }
  if (error instanceof NormativeMockError) {
    return new ExecutionFailure(error.code, error.safeMessage, "RETRY");
  }
  return null;
}

function scenarioSteps(configuration: Record<string, unknown>): ScenarioRunStatus[] {
  const values = Array.isArray(configuration.steps) ? configuration.steps : [];
  const allowed = new Set<ScenarioRunStatus>([
    "LOADING_APPIUS",
    "SYNCING_SAP",
    "CLASSIFYING_RESPONSIBILITY",
    "MATCHING_STOCK",
    "FINDING_ANALOGUES",
    "GENERATING_REPORT",
  ]);
  const steps = values.filter((value): value is ScenarioRunStatus => typeof value === "string" && allowed.has(value as ScenarioRunStatus));
  return steps.length > 0
    ? steps
    : ["LOADING_APPIUS", "SYNCING_SAP", "CLASSIFYING_RESPONSIBILITY", "MATCHING_STOCK", "FINDING_ANALOGUES", "GENERATING_REPORT"];
}

function nextConfiguredStep(steps: ScenarioRunStatus[], current: ScenarioRunStatus): ScenarioRunStatus | null {
  const index = steps.indexOf(current);
  return index >= 0 ? steps[index + 1] ?? null : null;
}

function pendingTerminalStage(run: ScenarioRun): ScenarioRun["steps"][number] | undefined {
  return run.steps.find((step) =>
    step.details?.terminalStageSchema === "terminal-outcome-v1" &&
    step.details?.stagedRunVersion === run.version &&
    step.details?.claimRunVersion === run.version - 1
  );
}

function cloneSnapshot(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value ?? {});
}

function mergeRunStep(run: ScenarioRun, step: ScenarioRun["steps"][number]): ScenarioRun {
  const index = run.steps.findIndex((candidate) => candidate.id === step.id);
  const steps = [...run.steps];
  if (index >= 0) steps[index] = step;
  else steps.push(step);
  return { ...run, steps };
}

function positionsFrom(output: Record<string, unknown>): Position[] {
  const appius = recordValue(output.appius);
  return Array.isArray(appius?.positions) ? (appius.positions as Position[]) : [];
}

function materialsFrom(output: Record<string, unknown>): SapMaterial[] {
  const sap = recordValue(output.sap);
  return Array.isArray(sap?.materials) ? (sap.materials as SapMaterial[]) : [];
}

function matchFor(output: Record<string, unknown>, positionId: string): MatchExplanation {
  const matches = recordValue(output.matches);
  const value = matches?.[positionId];
  if (isMatchExplanation(value)) return value;
  return { score: 0, category: "NO_MATCH", material: null, matched: [], differences: ["Поиск не выполнялся"], requiresHumanReview: false };
}

function analysisResultsFrom(output: Record<string, unknown>): PositionAnalysisResult[] {
  return Array.isArray(output.analysisResults) ? (output.analysisResults as PositionAnalysisResult[]) : [];
}

function uniqueAppiusVersions(
  results: PositionAnalysisResult[],
): Array<{ specificationId: string; versionId: string; versionNumber: number }> {
  const versions = new Map<string, { specificationId: string; versionId: string; versionNumber: number }>();
  for (const { position } of results) {
    versions.set(position.versionId, {
      specificationId: position.specificationId,
      versionId: position.versionId,
      versionNumber: position.versionNumber,
    });
  }
  return [...versions.values()].sort((left, right) =>
    left.specificationId.localeCompare(right.specificationId, "ru"),
  );
}

function ruleVersionManifest(
  value: unknown,
): Array<{ documentId: string; version: string; clauseId: string }> {
  if (!Array.isArray(value)) return [];
  const manifest = new Map<string, { documentId: string; version: string; clauseId: string }>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.documentId !== "string" ||
      typeof record.version !== "string" ||
      typeof record.clauseId !== "string"
    ) {
      continue;
    }
    const item = {
      documentId: record.documentId,
      version: record.version,
      clauseId: record.clauseId,
    };
    manifest.set(`${item.documentId}\u0000${item.version}\u0000${item.clauseId}`, item);
  }
  return [...manifest.values()].sort((left, right) =>
    `${left.documentId}:${left.clauseId}`.localeCompare(`${right.documentId}:${right.clauseId}`, "ru"),
  );
}

function summarize(results: PositionAnalysisResult[]): ReportSummary {
  const category = (name: string) => results.filter((item) => item.match.category === name).length;
  const procurement = results.filter((item) => item.status === "NOT_FOUND" || item.status === "INSUFFICIENT").length;
  const responsibility = summarizeResponsibilityDecisions(results);
  return {
    total: results.length,
    exact: category("EXACT"),
    found: results.filter((item) => item.status === "FOUND").length,
    likely: category("LIKELY"),
    review: category("REVIEW"),
    noMatch: category("NO_MATCH"),
    analogues: results.filter((item) => Boolean(item.analogueCoverage)).length,
    insufficient: results.filter((item) => item.status === "INSUFFICIENT").length,
    procurement,
    customerResponsibility: responsibility.customer,
    contractorResponsibility: responsibility.contractor,
  };
}

function fallbackResponsibility(position: Position, rules?: ResponsibilityRule[]): ResponsibilityDecision {
  return classifyResponsibility(position, rules ?? []);
}

function isResponsibilityDecision(value: unknown): value is ResponsibilityDecision {
  const record = recordValue(value);
  return Boolean(
    record &&
      ["RESOLVED", "REVIEW_REQUIRED", "INSUFFICIENT_DATA"].includes(String(record.decisionState)) &&
      typeof record.requiresHumanReview === "boolean",
  );
}

function isMatchExplanation(value: unknown): value is MatchExplanation {
  const record = recordValue(value);
  return Boolean(record && typeof record.score === "number" && typeof record.category === "string");
}

function isAnalogueCoverage(value: unknown): value is AnalogueCoverage {
  const record = recordValue(value);
  return Boolean(record && typeof record.requiredQuantity === "number" && Array.isArray(record.allocations));
}

function isAnalogueSearchDecision(value: unknown): value is AnalogueSearchDecision {
  const record = recordValue(value);
  return Boolean(
    record &&
      typeof record.directCoveredQuantity === "number" &&
      typeof record.shortageQuantity === "number" &&
      typeof record.outcome === "string" &&
      typeof record.ruleCount === "number",
  );
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function finiteInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function accessClaimsFrom(value: unknown): Readonly<Record<string, readonly string[]>> {
  const record = recordValue(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, candidate]) => {
      const values = stringArray(candidate);
      return values.length > 0 ? [[key, values] as const] : [];
    }),
  );
}

function claimsContain(
  current: Readonly<Record<string, readonly string[]>>,
  required: Readonly<Record<string, readonly string[]>>,
): boolean {
  return Object.entries(required).every(([type, values]) =>
    values.every((value) => current[type]?.includes(value) === true));
}

function manualImportSystem(errorCode?: string): "APPIUS" | "SAP" | undefined {
  if (["SAP_UNAVAILABLE", "SAP_RATE_LIMITED", "SAP_MALFORMED_RESPONSE"].includes(errorCode ?? "")) {
    return "SAP";
  }
  if (["APPIUS_UNAVAILABLE", "APPIUS_STALE_VERSION"].includes(errorCode ?? "")) {
    return "APPIUS";
  }
  return undefined;
}

async function applyIntegrationDelay(delayMs: number): Promise<void> {
  const safeDelay = Math.max(0, Math.min(2_000, Math.trunc(delayMs)));
  if (safeDelay > 0) await new Promise((resolve) => setTimeout(resolve, safeDelay));
}

function safeStepDetails(step: ScenarioRunStatus, output: Record<string, unknown>): Record<string, unknown> {
  const appius = recordValue(output.appius);
  const sap = recordValue(output.sap);
  const results = analysisResultsFrom(output);
  return {
    step,
    ...(appius?.positionCount === undefined ? {} : { positionCount: appius.positionCount }),
    ...(sap?.recordCount === undefined ? {} : { sapRecordCount: sap.recordCount }),
    ...(results.length === 0 ? {} : { resultCount: results.length }),
  };
}
