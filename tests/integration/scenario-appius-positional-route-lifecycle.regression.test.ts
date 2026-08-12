import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scheduleScenarioRunDrain: vi.fn(),
  storeUploadedBytes: vi.fn(async (input: { safeName: string }) => ({
    url: `memory://uploads/${encodeURIComponent(input.safeName)}`,
    provider: "memory" as const,
  })),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({
  requireDemoRole: vi.fn(async () => ({
    user: { id: "demo-user-001", roles: ["USER", "ADMIN"] },
  })),
  SessionError: class SessionError extends Error {
    constructor(message: string, readonly status: 401 | 403) {
      super(message);
    }
  },
}));
vi.mock("@/adapters/storage/upload-storage", () => ({
  storeUploadedBytes: mocks.storeUploadedBytes,
}));
vi.mock("@/application/scenario-background", () => ({
  scheduleScenarioRunDrain: mocks.scheduleScenarioRunDrain,
}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase } from "@/adapters/persistence/db";
import { getRepository, type MtrRepository } from "@/adapters/persistence/repository";
import { POST as validateSpecificationImport } from "@/app/api/manual-imports/specification/route";
import { POST as resumeWithManualImport } from "@/app/api/scenario-runs/[id]/manual-import/route";
import { POST as uploadFile } from "@/app/api/uploads/route";
import { drainScenarioRun } from "@/application/scenario-runner";
import { ScenarioService } from "@/application/scenario-service";
import { DEMO_USER_ID } from "@/domain/models";

const IMPORTED_CODE = "HTTP-TXT-001";
const IMPORTED_NAME = "Труба из HTTP TXT";

describe.sequential("ACC-FUNC-002 positional TXT HTTP manual-import lifecycle", () => {
  let repository: MtrRepository;
  let service: ScenarioService;

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDemoDatabase(DEMO_USER_ID);
    repository = await getRepository();
    service = new ScenarioService(repository);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("uploads and validates positional TXT, resumes the failed run route, then reports the imported position", async () => {
    await repository.setIntegrationState(DEMO_USER_ID, "APPIUS", {
      state: "UNAVAILABLE",
      delayMs: 0,
      safeMessage: "Appius PLM недоступен в HTTP regression-сценарии",
    });
    const created = await service.createRun(DEMO_USER_ID, {
      scenarioId: "scenario-full-analysis",
      specificationId: "spec-demo-piping-001",
      mode: "NORMAL",
      seed: "ERROR_APPIUS_UNAVAILABLE",
    });
    const failed = (await drainScenarioRun(DEMO_USER_ID, created.id)).run;
    expect(failed).toMatchObject({
      status: "FAILED",
      currentStep: "LOADING_APPIUS",
      errorCode: "APPIUS_UNAVAILABLE",
    });

    const uploadResponse = await uploadFile(multipartRequest(
      "позиции-appius.txt",
      "text/plain",
      new TextEncoder().encode(`${IMPORTED_CODE};${IMPORTED_NAME};5;M\n`),
    ));
    expect(uploadResponse.status).toBe(201);
    const upload = await uploadResponse.json() as {
      id: string;
      parseStatus: string;
      normalizedData: { rowCount: number; rows: Array<Record<string, unknown>> };
    };
    expect(upload).toMatchObject({
      id: expect.any(String),
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
    expect(mocks.storeUploadedBytes).toHaveBeenCalledOnce();

    const validationResponse = await validateSpecificationImport(jsonRequest(
      "http://localhost/api/manual-imports/specification",
      { uploadedFileId: upload.id },
    ));
    expect(validationResponse.status).toBe(200);
    await expect(validationResponse.json()).resolves.toMatchObject({
      uploadedFileId: upload.id,
      positionCount: 1,
      sourceKind: "UPLOADED_FILE",
    });

    const resumeResponse = await resumeWithManualImport(
      jsonRequest(
        `http://localhost/api/scenario-runs/${encodeURIComponent(failed.id)}/manual-import`,
        { uploadedFileId: upload.id },
        { "if-match": String(failed.version) },
      ),
      context(failed.id),
    );
    expect(resumeResponse.status).toBe(200);
    const resumed = await resumeResponse.json() as { id: string; status: string };
    expect(resumed).toMatchObject({ id: failed.id, status: "LOADING_APPIUS" });
    expect(mocks.scheduleScenarioRunDrain).toHaveBeenCalledWith(DEMO_USER_ID, failed.id);

    const completed = (await drainScenarioRun(DEMO_USER_ID, failed.id)).run;
    expect(completed).toMatchObject({ status: "COMPLETED", progress: 100 });
    const report = completed.outputSnapshot.report as {
      summary: { total: number };
      results: Array<{
        position: { internalCode: string; nameRu: string; requiredQuantity: number; unit: string };
      }>;
    };
    expect(report.summary.total).toBe(1);
    expect(report.results).toEqual([
      expect.objectContaining({
        position: expect.objectContaining({
          internalCode: IMPORTED_CODE,
          nameRu: IMPORTED_NAME,
          requiredQuantity: 5,
          unit: "M",
        }),
      }),
    ]);
  });
});

function multipartRequest(name: string, mimeType: string, bytes: Uint8Array): Request {
  const data = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(data).set(bytes);
  const form = new FormData();
  form.set("purpose", "APPIUS_MANUAL_IMPORT");
  form.set("file", new File([data], name, { type: mimeType }));
  return new Request("http://localhost/api/uploads", { method: "POST", body: form });
}

function jsonRequest(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) } as RouteContext<"/api/scenario-runs/[id]/manual-import">;
}
