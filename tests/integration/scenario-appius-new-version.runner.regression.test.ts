import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { AppiusMockAdapter } from "@/adapters/mock/appius-adapter";
import { closeDatabase } from "@/adapters/persistence/db";
import {
  getRepository,
  OptimisticLockError,
} from "@/adapters/persistence/repository";
import { drainScenarioRun } from "@/application/scenario-runner";
import { ScenarioService } from "@/application/scenario-service";
import { DEMO_USER_ID } from "@/domain/models";

const SPECIFICATION_ID = "spec-demo-piping-001";
const SCENARIO_ID = "scenario-appius-new-version";

describe.sequential("ACC-FUNC-006: runner обрабатывает новую версию Appius", () => {
  beforeEach(async () => resetDemoDatabase(DEMO_USER_ID));
  afterAll(async () => closeDatabase());

  it("promotes v3 to immutable v4 once and analyses only promoted positions", async () => {
    const repository = await getRepository();
    const service = new ScenarioService(repository);
    const before = await repository.listSpecificationVersions(DEMO_USER_ID, SPECIFICATION_ID);
    const previous = before.find((version) => version.isCurrent)!;
    expect(previous).toMatchObject({ id: `${SPECIFICATION_ID}-v3`, versionNumber: 3 });

    const created = await service.createRun(DEMO_USER_ID, {
      scenarioId: SCENARIO_ID,
      specificationId: SPECIFICATION_ID,
      mode: "NORMAL",
      seed: "EVENT_APPIUS_NEW_VERSION",
    });
    const afterLoading = await service.advance(
      DEMO_USER_ID,
      created.id,
      created.version,
    );
    const appius = afterLoading.outputSnapshot.appius as {
      newVersionEvent: {
        previousVersionId: string;
        currentVersionId: string;
        usedVersionId: string;
        auditCode: string;
      };
      versions: Array<{ id: string; isCurrent: boolean; versionNumber: number }>;
      positions: Array<{ id: string; versionId: string; isCurrentVersion: boolean }>;
    };

    expect(appius.newVersionEvent).toMatchObject({
      previousVersionId: `${SPECIFICATION_ID}-v3`,
      currentVersionId: `${SPECIFICATION_ID}-v4`,
      usedVersionId: `${SPECIFICATION_ID}-v4`,
      auditCode: "NEW_VERSION_PROMOTED",
    });
    expect(appius.versions).toEqual([
      expect.objectContaining({ id: `${SPECIFICATION_ID}-v4`, versionNumber: 4, isCurrent: true }),
    ]);
    expect(appius.positions).toHaveLength(8);
    expect(appius.positions.every((position) => (
      position.versionId === `${SPECIFICATION_ID}-v4` && position.isCurrentVersion
    ))).toBe(true);

    const duplicateEvent = await new AppiusMockAdapter(repository).processNewVersionEvent({
      eventId: "appius-event:spec-demo-piping-001:v3-to-v4",
      specificationId: SPECIFICATION_ID,
      previousVersionId: `${SPECIFICATION_ID}-v2`,
      currentVersionId: `${SPECIFICATION_ID}-v3`,
    }, DEMO_USER_ID);
    expect(duplicateEvent).toMatchObject({
      previousVersionId: `${SPECIFICATION_ID}-v3`,
      currentVersionId: `${SPECIFICATION_ID}-v4`,
      usedVersionId: `${SPECIFICATION_ID}-v4`,
    });

    await expect(
      service.advance(DEMO_USER_ID, created.id, created.version),
    ).rejects.toBeInstanceOf(OptimisticLockError);
    await expect(
      repository.listSpecificationVersions(DEMO_USER_ID, SPECIFICATION_ID),
    ).resolves.toHaveLength(before.length + 1);

    const drained = await drainScenarioRun(DEMO_USER_ID, created.id);
    expect(drained).toMatchObject({
      stopReason: "TERMINAL",
      run: { status: "COMPLETED", progress: 100 },
    });
    const completed = await service.getRun(DEMO_USER_ID, created.id);
    const report = completed.outputSnapshot.report as {
      results: Array<{ position: { versionId: string; isCurrentVersion: boolean } }>;
      provenance: { appiusVersions: Array<{ versionId: string; versionNumber: number }> };
    };
    expect(report.results).toHaveLength(8);
    expect(report.results.every((result) => (
      result.position.versionId === `${SPECIFICATION_ID}-v4` &&
      result.position.isCurrentVersion
    ))).toBe(true);
    expect(report.provenance.appiusVersions).toEqual([
      expect.objectContaining({ versionId: `${SPECIFICATION_ID}-v4`, versionNumber: 4 }),
    ]);

    const after = await repository.listSpecificationVersions(DEMO_USER_ID, SPECIFICATION_ID);
    expect(after).toHaveLength(before.length + 1);
    expect(after.find((version) => version.id === `${SPECIFICATION_ID}-v3`)).toMatchObject({
      isCurrent: false,
      status: "SUPERSEDED",
    });
    expect(after.find((version) => version.id === `${SPECIFICATION_ID}-v4`)).toMatchObject({
      isCurrent: true,
      status: "ACTIVE",
      versionNumber: 4,
      positionCount: 8,
    });
    await expect(repository.listPositions(DEMO_USER_ID, {
      specificationId: SPECIFICATION_ID,
      versionId: `${SPECIFICATION_ID}-v3`,
      currentOnly: false,
    })).resolves.toHaveLength(8);
    await expect(repository.listAnalysisResults(DEMO_USER_ID, completed.id)).resolves.toHaveLength(8);

    const promotionAudit = await repository.listAuditLogs(DEMO_USER_ID, {
      action: "appius.new_version.promoted",
    });
    expect(promotionAudit).toHaveLength(1);
    expect(promotionAudit[0]).toMatchObject({
      entityId: SPECIFICATION_ID,
      outcome: "SUCCESS",
      details: {
        previousVersionId: `${SPECIFICATION_ID}-v3`,
        currentVersionId: `${SPECIFICATION_ID}-v4`,
        versionNumber: 4,
        positionCount: 8,
      },
    });

    await drainScenarioRun(DEMO_USER_ID, created.id);
    await expect(
      repository.listSpecificationVersions(DEMO_USER_ID, SPECIFICATION_ID),
    ).resolves.toHaveLength(before.length + 1);
    await expect(repository.listAuditLogs(DEMO_USER_ID, {
      action: "appius.new_version.promoted",
    })).resolves.toHaveLength(1);

    const retried = await service.retry(DEMO_USER_ID, completed.id);
    const retriedDrain = await drainScenarioRun(DEMO_USER_ID, retried.id);
    expect(retriedDrain.run).toMatchObject({ status: "COMPLETED", progress: 100 });
    expect(retriedDrain.run.steps.filter((step) => step.outcome === "COMPLETED").map((step) => step.status)).toEqual([
      "LOADING_APPIUS",
      "SYNCING_SAP",
      "MATCHING_STOCK",
      "GENERATING_REPORT",
    ]);
    expect(((retriedDrain.run.outputSnapshot.report as {
      results: Array<{ position: { versionId: string } }>;
    }).results).every((result) => result.position.versionId === `${SPECIFICATION_ID}-v4`)).toBe(true);

    const repeated = await service.createRun(DEMO_USER_ID, {
      scenarioId: SCENARIO_ID,
      specificationId: SPECIFICATION_ID,
      mode: "NORMAL",
      seed: "EVENT_APPIUS_NEW_VERSION",
    });
    const repeatedDrain = await drainScenarioRun(DEMO_USER_ID, repeated.id);
    expect(repeatedDrain.run).toMatchObject({ status: "COMPLETED", progress: 100 });
    expect(((repeatedDrain.run.outputSnapshot.report as {
      results: Array<{ position: { versionId: string } }>;
    }).results).every((result) => result.position.versionId === `${SPECIFICATION_ID}-v4`)).toBe(true);

    await expect(
      repository.listSpecificationVersions(DEMO_USER_ID, SPECIFICATION_ID),
    ).resolves.toHaveLength(before.length + 1);
    await expect(repository.listAuditLogs(DEMO_USER_ID, {
      action: "appius.new_version.promoted",
    })).resolves.toHaveLength(1);

    await resetDemoDatabase(DEMO_USER_ID);
    await expect(
      repository.listSpecificationVersions(DEMO_USER_ID, SPECIFICATION_ID),
    ).resolves.toHaveLength(before.length);
    const afterReset = await service.createRun(DEMO_USER_ID, {
      scenarioId: SCENARIO_ID,
      specificationId: SPECIFICATION_ID,
      mode: "NORMAL",
      seed: "EVENT_APPIUS_NEW_VERSION",
    });
    const afterResetDrain = await drainScenarioRun(DEMO_USER_ID, afterReset.id);
    expect(afterResetDrain.run).toMatchObject({ status: "COMPLETED", progress: 100 });
    await expect(
      repository.listSpecificationVersions(DEMO_USER_ID, SPECIFICATION_ID),
    ).resolves.toHaveLength(before.length + 1);
    await expect(repository.listAuditLogs(DEMO_USER_ID, {
      action: "appius.new_version.promoted",
    })).resolves.toHaveLength(1);
  });
});
