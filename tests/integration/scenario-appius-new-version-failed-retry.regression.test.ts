import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase } from "@/adapters/persistence/db";
import { getRepository, type MtrRepository } from "@/adapters/persistence/repository";
import { drainScenarioRun } from "@/application/scenario-runner";
import { ScenarioService } from "@/application/scenario-service";
import { DEMO_USER_ID } from "@/domain/models";

const SPECIFICATION_ID = "spec-demo-piping-001";

describe.sequential("ACC-FUNC-006 failed post-promotion retry", () => {
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

  it("reuses the durable v4 event receipt after SAP failure and never promotes v5", async () => {
    const baselineVersions = await repository.listSpecificationVersions(
      DEMO_USER_ID,
      SPECIFICATION_ID,
    );
    await repository.setIntegrationState(DEMO_USER_ID, "SAP", {
      state: "UNAVAILABLE",
      delayMs: 0,
      safeMessage: "SAP S/4HANA недоступна после promotion",
    });

    const created = await service.createRun(DEMO_USER_ID, {
      scenarioId: "scenario-appius-new-version",
      specificationId: SPECIFICATION_ID,
      mode: "NORMAL",
      seed: "EVENT_APPIUS_NEW_VERSION",
    });
    const failed = (await drainScenarioRun(DEMO_USER_ID, created.id)).run;
    expect(failed).toMatchObject({
      status: "FAILED",
      currentStep: "SYNCING_SAP",
      errorCode: "SAP_UNAVAILABLE",
      outputSnapshot: {
        appius: {
          newVersionEvent: {
            previousVersionId: `${SPECIFICATION_ID}-v3`,
            currentVersionId: `${SPECIFICATION_ID}-v4`,
            usedVersionId: `${SPECIFICATION_ID}-v4`,
          },
        },
      },
    });
    await expect(
      repository.listSpecificationVersions(DEMO_USER_ID, SPECIFICATION_ID),
    ).resolves.toHaveLength(baselineVersions.length + 1);
    await expect(repository.listAuditLogs(DEMO_USER_ID, {
      action: "appius.new_version.promoted",
    })).resolves.toHaveLength(1);

    await repository.setIntegrationState(DEMO_USER_ID, "SAP", {
      state: "AVAILABLE",
      delayMs: 0,
      safeMessage: "SAP S/4HANA доступна",
      lastSynchronizedAt: new Date().toISOString(),
    });
    const retried = await service.retry(DEMO_USER_ID, failed.id);
    expect(retried).toMatchObject({
      status: "QUEUED",
      retryOfRunId: failed.id,
    });
    const completed = (await drainScenarioRun(DEMO_USER_ID, retried.id)).run;
    expect(completed).toMatchObject({ status: "COMPLETED", progress: 100 });

    const report = completed.outputSnapshot.report as {
      results: Array<{ position: { versionId: string; isCurrentVersion: boolean } }>;
      provenance: { appiusVersions: Array<{ versionId: string; versionNumber: number }> };
    };
    expect(report.results).toHaveLength(8);
    expect(report.results.every(({ position }) => (
      position.versionId === `${SPECIFICATION_ID}-v4` && position.isCurrentVersion
    ))).toBe(true);
    expect(report.provenance.appiusVersions).toEqual([
      expect.objectContaining({ versionId: `${SPECIFICATION_ID}-v4`, versionNumber: 4 }),
    ]);

    const finalVersions = await repository.listSpecificationVersions(
      DEMO_USER_ID,
      SPECIFICATION_ID,
    );
    expect(finalVersions).toHaveLength(baselineVersions.length + 1);
    expect(finalVersions).not.toContainEqual(expect.objectContaining({
      id: `${SPECIFICATION_ID}-v5`,
    }));
    await expect(repository.listAuditLogs(DEMO_USER_ID, {
      action: "appius.new_version.promoted",
    })).resolves.toHaveLength(1);
  });
});
