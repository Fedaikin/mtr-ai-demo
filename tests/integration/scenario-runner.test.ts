import { createHash } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { auditLogs } from "@/adapters/persistence/schema";
import {
  getRepository,
  OptimisticLockError,
  ScenarioStepClaimInProgressError,
  type MtrRepository,
} from "@/adapters/persistence/repository";
import { ScenarioService } from "@/application/scenario-service";
import { drainScenarioRun, drainScenarioRunWithDriver } from "@/application/scenario-runner";
import { parseUploadedFile } from "@/application/file-parser";
import { getReport } from "@/application/report-service";
import { DEMO_USER_ID, type ScenarioRun } from "@/domain/models";

const FULL_SCENARIO_ID = "scenario-full-analysis";
const SAP_FAILURE_SCENARIO_ID = "scenario-sap-failure-manual-import";

describe.sequential("server scenario runner", () => {
  let repository: MtrRepository;
  let service: ScenarioService;

  beforeEach(async () => {
    await resetDemoDatabase(DEMO_USER_ID);
    repository = await getRepository();
    service = new ScenarioService(repository);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("creates a queued run with an immutable all-current input snapshot", async () => {
    const run = await createFullRun(service);

    expect(run).toMatchObject({
      userId: DEMO_USER_ID,
      scenarioId: FULL_SCENARIO_ID,
      status: "QUEUED",
      currentStep: "QUEUED",
      progress: 0,
      mode: "NORMAL",
      seed: "BASE",
      steps: [],
    });
    expect(run.inputSnapshot).toMatchObject({
      schemaVersion: "1.0.0",
      fixtureSet: "BASE",
      sourceKind: "MOCK_OPERATIONAL_DATA",
      specificationScope: "ALL_CURRENT",
      requestedSpecificationId: "ALL_CURRENT_SPECIFICATIONS",
      versionResolutionPolicy: "LATEST_AT_RUN_START",
      sapSnapshotPolicy: "CURRENT_AT_RUN_START",
      isSyntheticDemo: true,
    });
    expect(run.inputSnapshot.specificationIds).toEqual([
      "spec-demo-piping-001",
      "spec-demo-utilities-002",
      "spec-demo-equipment-003",
    ]);
  });

  it("advances to completion and persists the exact 24-result 8/8/5/3 golden set", async () => {
    const completed = await driveToTerminal(service, await createFullRun(service));

    expect(completed).toMatchObject({
      status: "COMPLETED",
      currentStep: "COMPLETED",
      progress: 100,
    });
    expect(completed.errorCode).toBeUndefined();
    expect(completed.errorMessage).toBeUndefined();
    expect(completed.completedAt).toBeTruthy();

    const report = completed.outputSnapshot.report as {
      status: string;
      isSyntheticDemo: boolean;
      summary: Record<string, number>;
      results: Array<{ match: { category: string } }>;
    };
    expect(report).toMatchObject({
      status: "COMPLETED",
      isSyntheticDemo: true,
      summary: { total: 24, exact: 8, likely: 8, review: 5, noMatch: 3 },
    });
    expect(report.results).toHaveLength(24);
    expect(categoryCounts(report.results.map((item) => item.match.category))).toEqual({
      EXACT: 8,
      LIKELY: 8,
      REVIEW: 5,
      NO_MATCH: 3,
    });

    const persisted = await repository.listAnalysisResults(DEMO_USER_ID, completed.id);
    expect(persisted).toHaveLength(24);
    expect(categoryCounts(persisted.map((item) => item.matchCategory))).toEqual({
      EXACT: 8,
      LIKELY: 8,
      REVIEW: 5,
      NO_MATCH: 3,
    });

    const steps = await repository.listScenarioRunSteps(DEMO_USER_ID, completed.id);
    expect(steps).toHaveLength(6);
    expect(steps.map((step) => step.status)).toEqual([
      "LOADING_APPIUS",
      "SYNCING_SAP",
      "CLASSIFYING_RESPONSIBILITY",
      "MATCHING_STOCK",
      "FINDING_ANALOGUES",
      "GENERATING_REPORT",
    ]);
    expect(steps.every((step) => step.outcome === "COMPLETED")).toBe(true);
  });

  it("drains a newly created run to completion without any client advance call", async () => {
    const created = await createFullRun(service);

    const drained = await drainScenarioRun(DEMO_USER_ID, created.id);
    const persisted = await service.getRun(DEMO_USER_ID, created.id);

    expect(drained).toMatchObject({
      stopReason: "TERMINAL",
      transitions: 6,
      run: { status: "COMPLETED", progress: 100 },
    });
    expect(persisted).toMatchObject({ status: "COMPLETED", progress: 100 });
    expect(persisted.steps).toHaveLength(6);
    expect(persisted.steps.every((step) => step.outcome === "COMPLETED")).toBe(true);
    expect(await repository.listAnalysisResults(DEMO_USER_ID, created.id)).toHaveLength(24);
    expect(
      await repository.listAuditLogs(DEMO_USER_ID, {
        action: "SCENARIO_STEP_COMPLETED",
        limit: 20,
      }),
    ).toHaveLength(6);
  });

  it("projects configured next steps for the shortened stock-only scenario", async () => {
    const created = await service.createRun(DEMO_USER_ID, {
      scenarioId: "scenario-stock-search-only",
      specificationId: "ALL_CURRENT_SPECIFICATIONS",
    });

    const completed = (await drainScenarioRun(DEMO_USER_ID, created.id)).run;
    const audits = (await repository.listAuditLogs(DEMO_USER_ID, {
      action: "SCENARIO_STEP_COMPLETED",
      limit: 20,
    }))
      .filter((audit) => audit.entityId === created.id)
      .toSorted((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));

    expect(completed.status).toBe("COMPLETED");
    expect(audits.map((audit) => audit.details)).toEqual([
      { step: "LOADING_APPIUS", next: "SYNCING_SAP" },
      { step: "SYNCING_SAP", next: "MATCHING_STOCK" },
      { step: "MATCHING_STOCK", next: "GENERATING_REPORT" },
      { step: "GENERATING_REPORT", next: "COMPLETED" },
    ]);
  });

  it("loads list-screen run summaries in one query stage without dropping persisted steps", async () => {
    const completed = await driveToTerminal(service, await createFullRun(service));

    const [summaries, fullRuns] = await Promise.all([
      repository.listRuns(DEMO_USER_ID, { includeSteps: false, limit: 10 }),
      repository.listRuns(DEMO_USER_ID, { limit: 10 }),
    ]);

    expect(summaries.find((run) => run.id === completed.id)?.steps).toEqual([]);
    expect(fullRuns.find((run) => run.id === completed.id)?.steps).toHaveLength(6);
    await expect(repository.listScenarioRunSteps(DEMO_USER_ID, completed.id)).resolves.toHaveLength(6);
  });

  it("preserves cancellation when it races an executing server drain", async () => {
    await repository.setIntegrationState(DEMO_USER_ID, "APPIUS", {
      state: "AVAILABLE",
      delayMs: 250,
    });
    const created = await createFullRun(service);
    const drainPromise = drainScenarioRun(DEMO_USER_ID, created.id);
    await waitForRunStatus(service, created.id, "LOADING_APPIUS");

    const cancelled = await service.cancel(DEMO_USER_ID, created.id);
    const drained = await drainPromise;
    const persisted = await service.getRun(DEMO_USER_ID, created.id);
    const stepAudits = await repository.listAuditLogs(DEMO_USER_ID, {
      action: "SCENARIO_STEP_COMPLETED",
    });

    expect(cancelled.status).toBe("CANCELLED");
    expect(drained).toMatchObject({ stopReason: "TERMINAL", run: { status: "CANCELLED" } });
    expect(persisted).toMatchObject({ status: "CANCELLED", progress: 100 });
    expect(persisted.steps.some((step) => step.outcome === "CANCELLED")).toBe(true);
    expect(persisted.steps.some((step) => step.outcome === "STARTED")).toBe(false);
    expect(persisted.steps.some((step) => step.outcome === "COMPLETED")).toBe(false);
    expect(persisted.steps.some((step) => step.status === "SYNCING_SAP")).toBe(false);
    expect(stepAudits.filter((audit) => audit.entityId === created.id)).toHaveLength(0);
  });

  it("не превращает инфраструктурный сбой записи результатов в business FAILED", async () => {
    let run = await createFullRun(service);
    while (run.status !== "FINDING_ANALOGUES") {
      run = await service.advance(DEMO_USER_ID, run.id, run.version);
    }
    vi.spyOn(repository, "saveAnalysisResults").mockRejectedValueOnce(new Error("transient database failure"));

    await expect(
      service.advance(DEMO_USER_ID, run.id, run.version),
    ).rejects.toThrow("transient database failure");

    const persisted = await service.getRun(DEMO_USER_ID, run.id);
    const failedAudits = await repository.listAuditLogs(DEMO_USER_ID, {
      action: "SCENARIO_STEP_FAILED",
    });
    expect(persisted.status).toBe("FINDING_ANALOGUES");
    expect(persisted.completedAt).toBeUndefined();
    expect(persisted.errorCode).toBeUndefined();
    expect(persisted.steps.at(-1)).toMatchObject({
      status: "FINDING_ANALOGUES",
      outcome: "STARTED",
    });
    expect(await repository.listAnalysisResults(DEMO_USER_ID, run.id)).toHaveLength(0);
    expect(failedAudits.filter((audit) => audit.entityId === run.id)).toHaveLength(0);
  });

  it("удаляет неподтверждённые результаты, когда cancel выигрывает после их записи", async () => {
    let run = await createFullRun(service);
    while (run.status !== "FINDING_ANALOGUES") {
      run = await service.advance(DEMO_USER_ID, run.id, run.version);
    }
    const originalSave = repository.saveAnalysisResults.bind(repository);
    let releaseSave!: () => void;
    let resultsSaved!: () => void;
    const releasePromise = new Promise<void>((resolve) => { releaseSave = resolve; });
    const savedPromise = new Promise<void>((resolve) => { resultsSaved = resolve; });
    vi.spyOn(repository, "saveAnalysisResults").mockImplementationOnce(async (...args) => {
      const rows = await originalSave(...args);
      resultsSaved();
      await releasePromise;
      return rows;
    });

    const advancePromise = service.advance(DEMO_USER_ID, run.id, run.version);
    await savedPromise;
    const cancelled = await service.cancel(DEMO_USER_ID, run.id);
    releaseSave();
    await expect(advancePromise).rejects.toBeInstanceOf(OptimisticLockError);

    const persisted = await service.getRun(DEMO_USER_ID, run.id);
    expect(cancelled.status).toBe("CANCELLED");
    expect(persisted.status).toBe("CANCELLED");
    expect(persisted.steps.some((step) => step.outcome === "STARTED")).toBe(false);
    expect(await repository.listAnalysisResults(DEMO_USER_ID, run.id)).toHaveLength(0);
  });

  it("rejects a stale advance and keeps terminal advances idempotent", async () => {
    const created = await createFullRun(service);
    const afterFirstStep = await service.advance(DEMO_USER_ID, created.id, created.version);
    const stepsAfterFirstAdvance = await repository.listScenarioRunSteps(DEMO_USER_ID, created.id);

    expect(afterFirstStep.status).toBe("SYNCING_SAP");
    expect(stepsAfterFirstAdvance).toHaveLength(1);
    expect(stepsAfterFirstAdvance[0]).toMatchObject({
      status: "LOADING_APPIUS",
      outcome: "COMPLETED",
    });

    await expect(
      service.advance(DEMO_USER_ID, created.id, created.version),
    ).rejects.toBeInstanceOf(OptimisticLockError);
    expect(await repository.listScenarioRunSteps(DEMO_USER_ID, created.id)).toHaveLength(1);

    const completed = await driveToTerminal(service, afterFirstStep);
    const repeatedOnce = await service.advance(DEMO_USER_ID, completed.id, created.version);
    const repeatedTwice = await service.advance(DEMO_USER_ID, completed.id, completed.version);

    expect(repeatedOnce).toEqual(completed);
    expect(repeatedTwice).toEqual(completed);
    expect(await repository.listScenarioRunSteps(DEMO_USER_ID, completed.id)).toHaveLength(6);
    expect(await repository.listAnalysisResults(DEMO_USER_ID, completed.id)).toHaveLength(24);
  });

  it("cancels idempotently and creates a clean retry linked to the original run", async () => {
    const created = await createFullRun(service);
    const cancelled = await service.cancel(DEMO_USER_ID, created.id);
    const cancelledAgain = await service.cancel(DEMO_USER_ID, created.id);

    expect(cancelled).toMatchObject({
      status: "CANCELLED",
      currentStep: "CANCELLED",
      progress: 100,
    });
    expect(cancelledAgain).toMatchObject({
      id: cancelled.id,
      status: "CANCELLED",
      currentStep: "CANCELLED",
      progress: 100,
      version: cancelled.version,
    });
    expect(await repository.listScenarioRunSteps(DEMO_USER_ID, created.id)).toHaveLength(1);

    const retry = await service.retry(DEMO_USER_ID, created.id);
    expect(retry).toMatchObject({
      userId: DEMO_USER_ID,
      scenarioId: FULL_SCENARIO_ID,
      specificationId: created.specificationId,
      retryOfRunId: created.id,
      status: "QUEUED",
      currentStep: "QUEUED",
      progress: 0,
      steps: [],
    });
    expect(retry.id).not.toBe(created.id);
    expect(retry.inputSnapshot).toMatchObject({
      retryOfRunId: created.id,
      specificationScope: "ALL_CURRENT",
      specificationIds: created.inputSnapshot.specificationIds,
      isSyntheticDemo: true,
    });
    expect(retry.inputSnapshot.retriedAt).toBeTruthy();

    const completedRetry = await drainScenarioRun(DEMO_USER_ID, retry.id);
    expect(completedRetry.run.status).toBe("COMPLETED");
  });

  it("атомарно публикует аудит выполненных шагов и отмены при cancel mid-run", async () => {
    const created = await createFullRun(service);
    const afterFirstStep = await service.advance(DEMO_USER_ID, created.id, created.version);

    const cancelled = await service.cancel(DEMO_USER_ID, created.id);
    const [stepAudits, cancelAudits] = await Promise.all([
      repository.listAuditLogs(DEMO_USER_ID, { action: "SCENARIO_STEP_COMPLETED" }),
      repository.listAuditLogs(DEMO_USER_ID, { action: "SCENARIO_RUN_CANCELLED" }),
    ]);

    expect(afterFirstStep.status).toBe("SYNCING_SAP");
    expect(cancelled).toMatchObject({ status: "CANCELLED", progress: 100 });
    expect(stepAudits.filter((audit) => audit.entityId === created.id)).toHaveLength(1);
    expect(cancelAudits.filter((audit) => audit.entityId === created.id)).toHaveLength(1);
  });

  it("не оставляет orphan CANCELLED step, когда cancel проигрывает CAS гонку advance", async () => {
    const created = await createFullRun(service);
    const staleCancelView = await service.advance(DEMO_USER_ID, created.id, created.version);
    const advanced = await service.advance(DEMO_USER_ID, created.id, staleCancelView.version);

    await expect(
      repository.stageScenarioCancellation(
        DEMO_USER_ID,
        created.id,
        staleCancelView.version,
        {
          runId: created.id,
          status: staleCancelView.status,
          label: "Запуск отменён администратором",
          outcome: "CANCELLED",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 0,
          idempotencyKey: `${created.id}:CANCELLED`,
          details: {},
        },
      ),
    ).rejects.toBeInstanceOf(OptimisticLockError);

    const completed = await driveToTerminal(service, advanced);
    const [steps, cancelAudits] = await Promise.all([
      repository.listScenarioRunSteps(DEMO_USER_ID, created.id),
      repository.listAuditLogs(DEMO_USER_ID, { action: "SCENARIO_RUN_CANCELLED" }),
    ]);

    expect(completed.status).toBe("COMPLETED");
    expect(steps.some((step) => step.outcome === "CANCELLED")).toBe(false);
    expect(cancelAudits.filter((audit) => audit.entityId === created.id)).toHaveLength(0);
  });

  it("не перехватывает свежий STARTED claim прямым advance", async () => {
    const created = await createFullRun(service);
    const claimed = await repository.claimScenarioStep(DEMO_USER_ID, created.id, created.version, {
      runId: created.id,
      status: "LOADING_APPIUS",
      label: "Загрузка спецификации Appius",
      outcome: "STARTED",
      startedAt: new Date().toISOString(),
      idempotencyKey: `${created.id}:LOADING_APPIUS:attempt-1`,
      details: { attemptVersion: created.version + 1 },
      runPatch: {
        status: "LOADING_APPIUS",
        currentStep: "LOADING_APPIUS",
        progress: 10,
        startedAt: new Date().toISOString(),
      },
    });
    const beforeAttempt = await service.getRun(DEMO_USER_ID, created.id);

    await expect(
      service.advance(DEMO_USER_ID, created.id, claimed.run.version),
    ).rejects.toBeInstanceOf(ScenarioStepClaimInProgressError);

    const afterAttempt = await service.getRun(DEMO_USER_ID, created.id);
    expect(afterAttempt).toEqual(beforeAttempt);
    expect(afterAttempt.steps).toHaveLength(1);
    expect(afterAttempt.steps[0]).toMatchObject({ outcome: "STARTED" });
  });

  it("откатывает terminal и cancel-step при конфликте детерминированного audit id", async () => {
    const created = await createFullRun(service);
    const afterFirstStep = await service.advance(DEMO_USER_ID, created.id, created.version);
    const firstStep = afterFirstStep.steps[0]!;
    const deterministicAuditId = `audit-step-${createHash("md5")
      .update(`${DEMO_USER_ID}:${created.id}:${created.id}:LOADING_APPIUS:attempt-1:${firstStep.outcome}`)
      .digest("hex")}`;
    const now = new Date().toISOString();
    const database = await getDatabase();
    await database.insert(auditLogs).values({
      id: deterministicAuditId,
      userId: DEMO_USER_ID,
      actorDisplayName: "Демо-пользователь",
      action: "CONFLICTING_AUDIT_PAYLOAD",
      entityType: "SCENARIO_RUN",
      entityId: created.id,
      outcome: "FAILURE",
      details: { conflict: true },
      occurredAt: now,
      retentionUntil: new Date(Date.now() + 366 * 24 * 60 * 60 * 1000).toISOString(),
      requestId: null,
    });
    const beforeAttempt = await service.getRun(DEMO_USER_ID, created.id);

    await expect(service.cancel(DEMO_USER_ID, created.id)).rejects.toThrow();

    const afterAttempt = await service.getRun(DEMO_USER_ID, created.id);
    const cancelAudits = await repository.listAuditLogs(DEMO_USER_ID, {
      action: "SCENARIO_RUN_CANCELLED",
    });
    expect(afterAttempt.status).toBe(beforeAttempt.status);
    expect(afterAttempt.version).toBe(beforeAttempt.version + 1);
    expect(afterAttempt.steps.some((step) => (
      step.outcome === "CANCELLED" &&
      step.details?.terminalStageSchema === "terminal-outcome-v1"
    ))).toBe(true);
    expect(cancelAudits.filter((audit) => audit.entityId === created.id)).toHaveLength(0);
  });

  it("fails safely when SAP is unavailable and resumes only after a parsed manual import", async () => {
    let run = await service.createRun(DEMO_USER_ID, {
      scenarioId: SAP_FAILURE_SCENARIO_ID,
      specificationId: "spec-demo-piping-001",
      mode: "NORMAL",
      seed: "ERROR_SAP_UNAVAILABLE",
    });

    run = (await drainScenarioRun(DEMO_USER_ID, run.id)).run;
    expect(run).toMatchObject({
      status: "FAILED",
      currentStep: "SYNCING_SAP",
      errorCode: "SAP_UNAVAILABLE",
    });
    expect(run.errorMessage).toMatch(/SAP S\/4HANA|SAP/i);
    expect(run.outputSnapshot.failure).toMatchObject({
      step: "SYNCING_SAP",
      code: "SAP_UNAVAILABLE",
      recommendedAction: "MANUAL_IMPORT",
    });
    const [completedStepAudits, failedStepAudits] = await Promise.all([
      repository.listAuditLogs(DEMO_USER_ID, { action: "SCENARIO_STEP_COMPLETED" }),
      repository.listAuditLogs(DEMO_USER_ID, { action: "SCENARIO_STEP_FAILED" }),
    ]);
    expect(completedStepAudits.filter((audit) => audit.entityId === run.id)).toHaveLength(1);
    expect(failedStepAudits.filter((audit) => audit.entityId === run.id)).toHaveLength(1);

    const manualSapBytes = new TextEncoder().encode([
      "materialCode;nameRu;legacyCode;equipmentType;standard;materialGrade;availableQuantity;unit;plant;warehouse;snapshotDate;user_id",
      "MANUAL-SAP-ONLY;Труба стальная прямая DN 50;APP-DEMO-PIPE-001;PIPE;GOST-DEMO-PIPE-001;STEEL-DEMO-C20;7;M;PLANT-UPLOAD;WH-UPLOAD;2026-08-10T10:00:00.000Z;another-user",
    ].join("\n"));
    const parsed = await parseUploadedFile("sap-demo.csv", manualSapBytes);
    const uploaded = await repository.saveUploadedFile(DEMO_USER_ID, {
      id: "upload-sap-integration-test",
      originalName: "sap-demo.csv",
      safeName: "sap-demo.csv",
      extension: ".csv",
      mimeType: "text/csv",
      sizeBytes: manualSapBytes.byteLength,
      checksumSha256: parsed.checksumSha256,
      storageUrl: "memory://sap-demo.csv",
      parseStatus: "PARSED",
      normalizedData: parsed.normalizedData,
    });

    await expect(
      service.resumeWithManualSapImport(DEMO_USER_ID, run.id, uploaded.id, run.version - 1),
    ).rejects.toBeInstanceOf(OptimisticLockError);
    await expect(
      service.resumeWithManualImport("another-user", run.id, uploaded.id, run.version),
    ).rejects.toMatchObject({ code: "RUN_NOT_FOUND" });

    const resumed = await service.resumeWithManualSapImport(DEMO_USER_ID, run.id, uploaded.id, run.version);
    expect(resumed).toMatchObject({
      status: "SYNCING_SAP",
      currentStep: "SYNCING_SAP",
    });
    expect(resumed.errorCode).toBeUndefined();
    expect(resumed.errorMessage).toBeUndefined();
    expect(resumed.outputSnapshot.manualSapImport).toMatchObject({
      uploadedFileId: uploaded.id,
      checksumSha256: parsed.checksumSha256,
      recordCount: 1,
    });
    expect(resumed.outputSnapshot.failure).toBeUndefined();

    const completed = (await drainScenarioRun(DEMO_USER_ID, resumed.id)).run;
    expect(completed.status).toBe("COMPLETED");
    expect(completed.outputSnapshot.sap).toMatchObject({
      state: "MANUAL_IMPORT",
      sourceKind: "UPLOADED_FILE",
      recordCount: 1,
      materials: [
        expect.objectContaining({
          userId: DEMO_USER_ID,
          materialCode: "MANUAL-SAP-ONLY",
          availableQuantity: 7,
          plant: "PLANT-UPLOAD",
          storageLocation: "WH-UPLOAD",
        }),
      ],
    });
    expect(JSON.stringify(completed.outputSnapshot.sap)).not.toContain("SAP-DEMO-0001");
    const report = completed.outputSnapshot.report as {
      summary: { total: number };
      results: Array<{ position: { id: string }; status: string; match: { material?: { materialCode: string; availableQuantity: number } } }>;
    };
    expect(report.results.find((result) => result.position.id === "position-001")).toMatchObject({
      status: "INSUFFICIENT",
      match: { material: { materialCode: "MANUAL-SAP-ONLY", availableQuantity: 7 } },
    });
    expect((completed.outputSnapshot.report as { summary: { total: number } }).summary.total).toBe(8);
    expect(await repository.listAnalysisResults(DEMO_USER_ID, completed.id)).toHaveLength(8);
    const audit = await repository.listAuditLogs(DEMO_USER_ID, { action: "SCENARIO_MANUAL_SAP_IMPORT_ATTACHED" });
    expect(audit[0]?.details).toMatchObject({ recordCount: 1, uploadedFileId: uploaded.id });
  });

  it("publishes a staged FAILED outcome before retry without executing the failed step again", async () => {
    const database = await getDatabase();
    const client = (database as unknown as {
      $client: { query: (...args: unknown[]) => Promise<unknown> };
    }).$client;
    const originalQuery = client.query.bind(client);
    let rejectFailedAudit = true;
    const query = vi.spyOn(client, "query").mockImplementation(async (...args) => {
      const statement = String(args[0]);
      const failedAudit = statement.includes('insert into "audit_logs"') &&
        statement.includes("projected_audits");
      if (failedAudit && rejectFailedAudit) {
        rejectFailedAudit = false;
        throw new Error("injected failed-step audit failure");
      }
      return originalQuery(...args);
    });
    const executeStep = vi.spyOn(
      service as unknown as {
        executeStep: (...args: unknown[]) => Promise<Record<string, unknown>>;
      },
      "executeStep",
    );

    try {
      const created = await service.createRun(DEMO_USER_ID, {
        scenarioId: SAP_FAILURE_SCENARIO_ID,
        specificationId: "spec-demo-piping-001",
        mode: "NORMAL",
        seed: "ERROR_SAP_UNAVAILABLE",
      });
      await expect(
        drainScenarioRunWithDriver(service, DEMO_USER_ID, created.id),
      ).rejects.toThrow();

      const staged = await service.getRun(DEMO_USER_ID, created.id);
      expect(staged.status).toBe("SYNCING_SAP");
      expect(staged.completedAt).toBeUndefined();
      expect(staged.steps).toEqual([
        expect.objectContaining({ status: "LOADING_APPIUS", outcome: "COMPLETED" }),
        expect.objectContaining({
          status: "SYNCING_SAP",
          outcome: "FAILED",
          details: expect.objectContaining({ terminalStageSchema: "terminal-outcome-v1" }),
        }),
      ]);
      expect(executeStep).toHaveBeenCalledTimes(2);

      const retry = await service.retry(DEMO_USER_ID, created.id);
      const publishedOriginal = await service.getRun(DEMO_USER_ID, created.id);
      const failedAudits = await repository.listAuditLogs(DEMO_USER_ID, {
        action: "SCENARIO_STEP_FAILED",
      });

      expect(publishedOriginal).toMatchObject({ status: "FAILED", errorCode: "SAP_UNAVAILABLE" });
      expect(retry).toMatchObject({ status: "QUEUED", retryOfRunId: created.id });
      expect(executeStep).toHaveBeenCalledTimes(2);
      expect(failedAudits.filter((audit) => audit.entityId === created.id)).toHaveLength(1);
    } finally {
      query.mockRestore();
    }
  });

  it("resumes an Appius outage from actual uploaded specification rows", async () => {
    await repository.setIntegrationState(DEMO_USER_ID, "APPIUS", {
      state: "UNAVAILABLE",
      safeMessage: "Appius PLM недоступен в тестовом сценарии",
    });
    let run = await service.createRun(DEMO_USER_ID, {
      scenarioId: FULL_SCENARIO_ID,
      specificationId: "spec-demo-piping-001",
      mode: "NORMAL",
      seed: "ERROR_APPIUS_UNAVAILABLE",
    });

    run = (await drainScenarioRun(DEMO_USER_ID, run.id)).run;
    expect(run).toMatchObject({
      status: "FAILED",
      currentStep: "LOADING_APPIUS",
      errorCode: "APPIUS_UNAVAILABLE",
    });

    const manualAppiusBytes = new TextEncoder().encode([
      "internalCode;nameRu;equipmentType;standard;materialGrade;requiredQuantity;unit;dn;user_id",
      "SAP-DEMO-0001;Труба из загруженной спецификации;PIPE;GOST-DEMO-PIPE-001;STEEL-DEMO-C20;5;M;50;another-user",
    ].join("\n"));
    const parsed = await parseUploadedFile("appius-demo.csv", manualAppiusBytes);
    const uploaded = await repository.saveUploadedFile(DEMO_USER_ID, {
      id: "upload-appius-integration-test",
      originalName: "appius-demo.csv",
      safeName: "appius-demo.csv",
      extension: ".csv",
      mimeType: "text/csv",
      sizeBytes: manualAppiusBytes.byteLength,
      checksumSha256: parsed.checksumSha256,
      storageUrl: "memory://appius-demo.csv",
      parseStatus: "PARSED",
      normalizedData: parsed.normalizedData,
    });

    const resumed = await service.resumeWithManualImport(DEMO_USER_ID, run.id, uploaded.id, run.version);
    expect(resumed).toMatchObject({ status: "LOADING_APPIUS", currentStep: "LOADING_APPIUS" });
    expect(resumed.outputSnapshot.manualAppiusImport).toMatchObject({
      uploadedFileId: uploaded.id,
      positionCount: 1,
      positions: [
        expect.objectContaining({
          userId: DEMO_USER_ID,
          internalCode: "SAP-DEMO-0001",
          nameRu: "Труба из загруженной спецификации",
          requiredQuantity: 5,
        }),
      ],
    });
    expect(JSON.stringify(resumed.outputSnapshot.manualAppiusImport)).not.toContain("another-user");

    const completed = (await drainScenarioRun(DEMO_USER_ID, resumed.id)).run;
    expect(completed.status).toBe("COMPLETED");
    expect(completed.outputSnapshot.appius).toMatchObject({
      state: "MANUAL_IMPORT",
      sourceKind: "UPLOADED_FILE",
      positionCount: 1,
    });
    const report = completed.outputSnapshot.report as {
      summary: { total: number; exact: number };
      results: Array<{ position: { nameRu: string; userId: string }; match: { material?: { materialCode: string } } }>;
    };
    expect(report.summary).toMatchObject({ total: 1, exact: 1 });
    expect(report.results[0]).toMatchObject({
      position: { nameRu: "Труба из загруженной спецификации", userId: DEMO_USER_ID },
      match: { material: { materialCode: "SAP-DEMO-0001" } },
    });
    expect(await repository.listAnalysisResults(DEMO_USER_ID, completed.id)).toHaveLength(1);
    const audit = await repository.listAuditLogs(DEMO_USER_ID, { action: "SCENARIO_MANUAL_APPIUS_IMPORT_ATTACHED" });
    expect(audit[0]?.details).toMatchObject({ positionCount: 1, uploadedFileId: uploaded.id });
  });

  it("retains audit records for at least one calendar year", async () => {
    const occurredAt = "2024-02-29T12:00:00.000Z";
    const audit = await repository.writeAudit(DEMO_USER_ID, {
      action: "AUDIT_RETENTION_TEST",
      entityType: "SCENARIO_RUN",
      entityId: "retention-test",
      outcome: "SUCCESS",
      occurredAt,
    });

    expect(Date.parse(audit.retentionUntil) - Date.parse(occurredAt)).toBeGreaterThanOrEqual(
      365 * 24 * 60 * 60 * 1000,
    );
    await expect(
      repository.writeAudit(DEMO_USER_ID, {
        action: "AUDIT_RETENTION_TOO_SHORT",
        entityType: "SCENARIO_RUN",
        entityId: "retention-test",
        outcome: "FAILURE",
        occurredAt,
        retentionUntil: "2024-12-01T12:00:00.000Z",
      }),
    ).rejects.toThrow(/не может быть меньше одного года/u);
  });

  it("versions and audits a manual responsibility correction with a mandatory reason", async () => {
    const completed = await driveToTerminal(service, await createFullRun(service));
    const [original] = await repository.listAnalysisResults(DEMO_USER_ID, completed.id);
    expect(original).toBeTruthy();
    const responsibility = original!.responsibility === "CUSTOMER" ? "CONTRACTOR" : "CUSTOMER";

    const updated = await repository.overrideAnalysisResponsibility(DEMO_USER_ID, {
      runId: completed.id,
      positionId: original!.positionId,
      responsibility,
      reason: "Эксперт проверил договорную границу; password=unsafe.",
      expectedVersion: original!.version,
      actorDisplayName: "Демо-пользователь 1",
    });

    expect(updated).toMatchObject({
      responsibility,
      version: original!.version + 1,
    });
    expect(updated.result).toMatchObject({
      responsibility,
      analysisVersion: original!.version + 1,
      manualResponsibilityOverrides: [
        {
          before: original!.responsibility,
          after: responsibility,
          reason: "Эксперт проверил договорную границу; password=unsafe.",
          actor: "Демо-пользователь 1",
        },
      ],
    });

    const { report } = await getReport(DEMO_USER_ID, completed.id);
    expect(report.results.find((result) => result.position.id === original!.positionId)).toMatchObject({
      responsibility,
      analysisVersion: original!.version + 1,
    });
    const audit = await repository.listAuditLogs(DEMO_USER_ID, {
      action: "POSITION_RESPONSIBILITY_OVERRIDDEN",
      limit: 10,
    });
    expect(audit).toEqual([
      expect.objectContaining({
        actorDisplayName: "Демо-пользователь 1",
        entityType: "POSITION_ANALYSIS_RESULT",
        outcome: "SUCCESS",
      }),
    ]);
    expect(JSON.stringify(audit)).not.toContain("password=unsafe");
    expect(JSON.stringify(audit)).toContain("password=[СКРЫТО]");
    if (!original?.responsibility) throw new Error("Тестовый результат должен содержать решение ответственности.");
    await expect(
      repository.overrideAnalysisResponsibility(DEMO_USER_ID, {
        runId: completed.id,
        positionId: original!.positionId,
        responsibility: original.responsibility,
        reason: "Повтор с устаревшей версией должен быть отклонён.",
        expectedVersion: original!.version,
      }),
    ).rejects.toBeInstanceOf(OptimisticLockError);
  });
});

async function createFullRun(service: ScenarioService): Promise<ScenarioRun> {
  return service.createRun(DEMO_USER_ID, {
    scenarioId: FULL_SCENARIO_ID,
    specificationId: "ALL_CURRENT_SPECIFICATIONS",
    mode: "NORMAL",
    seed: "BASE",
  });
}

async function driveToTerminal(service: ScenarioService, initial: ScenarioRun): Promise<ScenarioRun> {
  let run = initial;
  for (let step = 0; step < 12 && !["COMPLETED", "FAILED", "CANCELLED"].includes(run.status); step += 1) {
    run = await service.advance(DEMO_USER_ID, run.id, run.version);
  }
  expect(run.status, `run ${run.id} did not reach a terminal status`).toMatch(/^(COMPLETED|FAILED|CANCELLED)$/);
  return run;
}

async function waitForRunStatus(
  service: ScenarioService,
  runId: string,
  status: ScenarioRun["status"],
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await service.getRun(DEMO_USER_ID, runId)).status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`run ${runId} did not reach ${status}`);
}

function categoryCounts(categories: string[]): Record<string, number> {
  return categories.reduce<Record<string, number>>((counts, category) => {
    counts[category] = (counts[category] ?? 0) + 1;
    return counts;
  }, {});
}
