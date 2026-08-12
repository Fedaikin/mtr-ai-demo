import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase } from "@/adapters/persistence/db";
import { getRepository, type MtrRepository } from "@/adapters/persistence/repository";
import { parseUploadedFile } from "@/application/file-parser";
import { getReport } from "@/application/report-service";
import { drainScenarioRun } from "@/application/scenario-runner";
import { ScenarioService } from "@/application/scenario-service";
import { DEMO_USER_ID } from "@/domain/models";

const SCENARIO_ID = "scenario-full-analysis";
const SPECIFICATION_ID = "spec-demo-piping-001";
const IMPORTED_CODE = "SAP-DEMO-0001";
const IMPORTED_NAME = "Труба из позиционного TXT";

describe.sequential("ACC-FUNC-002 positional TXT manual-import lifecycle", () => {
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

  it("persists a parsed row, resumes a failed Appius run, and uses it in results and the report", async () => {
    await repository.setIntegrationState(DEMO_USER_ID, "APPIUS", {
      state: "UNAVAILABLE",
      safeMessage: "Appius PLM недоступен в regression-сценарии",
    });
    const created = await service.createRun(DEMO_USER_ID, {
      scenarioId: SCENARIO_ID,
      specificationId: SPECIFICATION_ID,
      mode: "NORMAL",
      seed: "ERROR_APPIUS_UNAVAILABLE",
    });
    const failed = (await drainScenarioRun(DEMO_USER_ID, created.id)).run;

    expect(failed).toMatchObject({
      status: "FAILED",
      currentStep: "LOADING_APPIUS",
      errorCode: "APPIUS_UNAVAILABLE",
    });

    const bytes = new TextEncoder().encode(
      `${IMPORTED_CODE};${IMPORTED_NAME};5;M\n`,
    );
    const parsed = await parseUploadedFile("позиции-appius.txt", bytes);

    expect(parsed).toMatchObject({
      extension: ".txt",
      parseStatus: "PARSED",
      normalizedData: {
        kind: "TEXT",
        rowCount: 1,
        rows: [{
          internalCode: IMPORTED_CODE,
          nameRu: IMPORTED_NAME,
          requiredQuantity: "5",
          unit: "M",
        }],
      },
    });

    const uploaded = await repository.saveUploadedFile(DEMO_USER_ID, {
      id: "upload-appius-positional-txt-regression",
      originalName: "позиции-appius.txt",
      safeName: "позиции-appius.txt",
      extension: parsed.extension,
      mimeType: "text/plain",
      sizeBytes: bytes.byteLength,
      checksumSha256: parsed.checksumSha256,
      storageUrl: "memory://позиции-appius.txt",
      parseStatus: parsed.parseStatus,
      normalizedData: parsed.normalizedData,
    });
    const persistedUpload = await repository.getUploadedFile(DEMO_USER_ID, uploaded.id);

    expect(persistedUpload).toMatchObject({
      parseStatus: "PARSED",
      normalizedData: {
        rowCount: 1,
        rows: [{
          internalCode: IMPORTED_CODE,
          nameRu: IMPORTED_NAME,
          requiredQuantity: "5",
          unit: "M",
        }],
      },
    });

    const resumed = await service.resumeWithManualImport(
      DEMO_USER_ID,
      failed.id,
      uploaded.id,
      failed.version,
    );
    expect(resumed).toMatchObject({
      status: "LOADING_APPIUS",
      currentStep: "LOADING_APPIUS",
      outputSnapshot: {
        manualAppiusImport: {
          uploadedFileId: uploaded.id,
          positionCount: 1,
          positions: [expect.objectContaining({
            userId: DEMO_USER_ID,
            internalCode: IMPORTED_CODE,
            nameRu: IMPORTED_NAME,
            requiredQuantity: 5,
            unit: "M",
          })],
        },
      },
    });

    const completed = (await drainScenarioRun(DEMO_USER_ID, resumed.id)).run;
    expect(completed).toMatchObject({
      status: "COMPLETED",
      currentStep: "COMPLETED",
      progress: 100,
      outputSnapshot: {
        appius: {
          state: "MANUAL_IMPORT",
          sourceKind: "UPLOADED_FILE",
          positionCount: 1,
        },
      },
    });

    const persistedResults = await repository.listAnalysisResults(DEMO_USER_ID, completed.id);
    expect(persistedResults).toHaveLength(1);
    expect(persistedResults[0]).toMatchObject({
      positionId: expect.stringMatching(/^manual-position-/u),
      result: {
        position: {
          userId: DEMO_USER_ID,
          internalCode: IMPORTED_CODE,
          nameRu: IMPORTED_NAME,
          requiredQuantity: 5,
          unit: "M",
          fixtureTags: ["source:manual-import"],
        },
      },
    });

    const { report } = await getReport(DEMO_USER_ID, completed.id);
    expect(report.summary.total).toBe(1);
    expect(report.results).toEqual([
      expect.objectContaining({
        position: expect.objectContaining({
          userId: DEMO_USER_ID,
          internalCode: IMPORTED_CODE,
          nameRu: IMPORTED_NAME,
        }),
      }),
    ]);
  });
});
