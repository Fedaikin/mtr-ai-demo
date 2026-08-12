import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { getRepository } from "@/adapters/persistence/repository";
import {
  drainScenarioRun,
  drainScenarioRunWithDriver,
} from "@/application/scenario-runner";
import { ScenarioService } from "@/application/scenario-service";
import { DEMO_USER_ID } from "@/domain/models";

describe.sequential("DEF-PERF-001: пакетное выполнение сценария", () => {
  beforeEach(async () => resetDemoDatabase(DEMO_USER_ID));
  afterAll(async () => closeDatabase());

  it("обрабатывает 24 позиции без нормативного и persistence N+1", async () => {
    const database = await getDatabase();
    const client = (database as unknown as {
      $client: { query: (...args: unknown[]) => Promise<unknown> };
    }).$client;
    const query = vi.spyOn(client, "query");
    const repository = await getRepository();
    const calls = {
      ragState: vi.spyOn(repository, "getIntegrationState"),
      responsibilityRules: vi.spyOn(repository, "listResponsibilityRules"),
      analogueRules: vi.spyOn(repository, "listAnalogueRules"),
      chunks: vi.spyOn(repository, "listNormativeChunks"),
      dictionaries: vi.spyOn(repository, "listDictionaries"),
      batchSave: vi.spyOn(repository, "saveAnalysisResults"),
      singleSave: vi.spyOn(repository, "saveAnalysisResult"),
      getRun: vi.spyOn(repository, "getRun"),
      getScenario: vi.spyOn(repository, "getScenario"),
    };
    const service = new ScenarioService(repository);
    const startedAt = performance.now();
    const created = await service.createRun(DEMO_USER_ID, {
      scenarioId: "scenario-full-analysis",
      specificationId: "ALL_CURRENT_SPECIFICATIONS",
    });
    const queriesBeforeDrain = query.mock.calls.length;
    const getRunBeforeDrain = calls.getRun.mock.calls.length;
    const getScenarioBeforeDrain = calls.getScenario.mock.calls.length;
    const drained = await drainScenarioRunWithDriver(
      service,
      DEMO_USER_ID,
      created.id,
    );
    const completed = drained.run;
    const durationMs = performance.now() - startedAt;
    const counts = {
      responsibilityRules: calls.responsibilityRules.mock.calls.length,
      analogueRules: calls.analogueRules.mock.calls.length,
      chunks: calls.chunks.mock.calls.length,
      dictionaries: calls.dictionaries.mock.calls.length,
      batchSave: calls.batchSave.mock.calls.length,
      singleSave: calls.singleSave.mock.calls.length,
      ragState: calls.ragState.mock.calls.filter(([, system]) => system === "RAG").length,
      pgliteQueries: query.mock.calls.length,
      drainQueries: query.mock.calls.length - queriesBeforeDrain,
      drainGetRun: calls.getRun.mock.calls.length - getRunBeforeDrain,
      drainGetScenario: calls.getScenario.mock.calls.length - getScenarioBeforeDrain,
    };
    vi.restoreAllMocks();

    expect(completed.status).toBe("COMPLETED");
    expect(durationMs).toBeLessThan(3_000);
    expect(counts).toMatchObject({
      responsibilityRules: 1,
      analogueRules: 1,
      chunks: 2,
      dictionaries: 2,
      batchSave: 1,
      singleSave: 0,
      ragState: 2,
      drainGetRun: 1,
      drainGetScenario: 0,
    });
    expect(counts.drainQueries).toBeLessThanOrEqual(55);
    expect(counts.pgliteQueries).toBeLessThanOrEqual(60);
  });

  it("учитывает durable-аудит в created-to-completed и сохраняет SLA 15 секунд", async () => {
    const database = await getDatabase();
    const client = (database as unknown as {
      $client: { query: (...args: unknown[]) => Promise<unknown> };
    }).$client;
    const originalQuery = client.query.bind(client);
    let stepAuditInsertCalls = 0;
    let stepAuditInsertCompleted = false;
    // Frozen Preview outliers were 5_092 ms and 2_621 ms; scale them 10:1 so
    // the regression keeps the same critical-path boundary without a slow test.
    const scaledFrozenAuditLatencyMs = 509 + 262;
    const query = vi.spyOn(client, "query").mockImplementation(async (...args) => {
      const statement = String(args[0]);
      const stepAudit = statement.includes('insert into "audit_logs"') &&
        statement.includes("projected_audits");
      if (stepAudit) {
        stepAuditInsertCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, scaledFrozenAuditLatencyMs));
      }
      const result = await originalQuery(...args);
      if (stepAudit) stepAuditInsertCompleted = true;
      return result;
    });

    try {
      const repository = await getRepository();
      const service = new ScenarioService(repository);
      const created = await service.createRun(DEMO_USER_ID, {
        scenarioId: "scenario-full-analysis",
        specificationId: "ALL_CURRENT_SPECIFICATIONS",
      });
      const drainStartedAt = performance.now();
      const completed = (await drainScenarioRun(DEMO_USER_ID, created.id)).run;
      const drainDurationMs = performance.now() - drainStartedAt;
      const createdToCompletedMs = Date.parse(completed.completedAt!) -
        Date.parse(completed.createdAt);
      const audits = await repository.listAuditLogs(DEMO_USER_ID, {
        action: "SCENARIO_STEP_COMPLETED",
      });

      expect(completed.status).toBe("COMPLETED");
      expect(createdToCompletedMs).toBeGreaterThanOrEqual(scaledFrozenAuditLatencyMs);
      expect(createdToCompletedMs).toBeLessThan(15_000);
      expect(drainDurationMs).toBeGreaterThanOrEqual(scaledFrozenAuditLatencyMs);
      expect(drainDurationMs - createdToCompletedMs).toBeLessThan(100);
      expect(stepAuditInsertCalls).toBe(1);
      expect(stepAuditInsertCompleted).toBe(true);
      expect(audits.filter((audit) => audit.entityId === created.id)).toHaveLength(6);
    } finally {
      query.mockRestore();
    }
  });

  it("не публикует terminal state без полного аудита и восстанавливается следующим drain", async () => {
    const database = await getDatabase();
    const client = (database as unknown as {
      $client: { query: (...args: unknown[]) => Promise<unknown> };
    }).$client;
    const originalQuery = client.query.bind(client);
    let rejectFinalStepAudit = true;
    const query = vi.spyOn(client, "query").mockImplementation(async (...args) => {
      const statement = String(args[0]);
      const finalStepAudit = statement.includes('insert into "audit_logs"') &&
        statement.includes("projected_audits");
      if (finalStepAudit && rejectFinalStepAudit) {
        rejectFinalStepAudit = false;
        throw new Error("injected final scenario audit failure");
      }
      return originalQuery(...args);
    });

    try {
      const repository = await getRepository();
      const service = new ScenarioService(repository);
      const executeStep = vi.spyOn(
        service as unknown as {
          executeStep: (...args: unknown[]) => Promise<Record<string, unknown>>;
        },
        "executeStep",
      );
      const created = await service.createRun(DEMO_USER_ID, {
        scenarioId: "scenario-full-analysis",
        specificationId: "ALL_CURRENT_SPECIFICATIONS",
      });

      await expect(
        drainScenarioRunWithDriver(service, DEMO_USER_ID, created.id),
      ).rejects.toThrow();

      const afterRejectedAudit = await service.getRun(DEMO_USER_ID, created.id);
      const auditsAfterFailure = await repository.listAuditLogs(DEMO_USER_ID, {
        action: "SCENARIO_STEP_COMPLETED",
      });
      expect(afterRejectedAudit.status).not.toBe("COMPLETED");
      expect(afterRejectedAudit.completedAt).toBeUndefined();
      expect(afterRejectedAudit.steps.filter((step) => step.outcome === "COMPLETED")).toHaveLength(6);
      expect(auditsAfterFailure.filter((audit) => audit.entityId === created.id)).toHaveLength(0);
      expect(executeStep).toHaveBeenCalledTimes(6);

      const recovered = (await drainScenarioRunWithDriver(
        service,
        DEMO_USER_ID,
        created.id,
      )).run;
      const recoveredAudits = await repository.listAuditLogs(DEMO_USER_ID, {
        action: "SCENARIO_STEP_COMPLETED",
      });
      const runAudits = recoveredAudits.filter((audit) => audit.entityId === created.id);

      expect(recovered).toMatchObject({ status: "COMPLETED", progress: 100 });
      expect(runAudits).toHaveLength(6);
      expect(new Set(runAudits.map((audit) => audit.id)).size).toBe(6);
      expect(executeStep).toHaveBeenCalledTimes(6);
    } finally {
      query.mockRestore();
    }
  });

});
