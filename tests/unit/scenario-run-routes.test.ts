import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRun: vi.fn(),
  getRun: vi.fn(),
  listRuns: vi.fn(),
  retry: vi.fn(),
  resumeWithManualImport: vi.fn(),
  scheduleScenarioRunDrain: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/application/scenario-service", () => ({
  ScenarioService: {
    create: vi.fn(async () => ({
      createRun: mocks.createRun,
      getRun: mocks.getRun,
      listRuns: mocks.listRuns,
      retry: mocks.retry,
      resumeWithManualImport: mocks.resumeWithManualImport,
    })),
  },
}));
vi.mock("@/application/scenario-background", () => ({
  scheduleScenarioRunDrain: mocks.scheduleScenarioRunDrain,
}));
vi.mock("@/lib/session", () => ({
  requireDemoRole: vi.fn(async () => ({ user: { id: "demo-user-001" } })),
}));

import { GET as getRunRoute } from "@/app/api/scenario-runs/[id]/route";
import { POST as manualImportRoute } from "@/app/api/scenario-runs/[id]/manual-import/route";
import { POST as retryRoute } from "@/app/api/scenario-runs/[id]/retry/route";
import { POST as createRunRoute } from "@/app/api/scenario-runs/route";

describe("scenario run route background handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createRun.mockResolvedValue(run("run-created", "QUEUED"));
    mocks.getRun.mockResolvedValue(run("run-existing", "SYNCING_SAP"));
    mocks.retry.mockResolvedValue(run("run-retry", "QUEUED"));
    mocks.resumeWithManualImport.mockResolvedValue(run("run-manual", "SYNCING_SAP"));
  });

  it("returns the created run and hands execution to the server background scheduler", async () => {
    const response = await createRunRoute(jsonRequest("http://localhost/api/scenario-runs", {
      scenarioId: "scenario-full-analysis",
      specificationId: "ALL_CURRENT_SPECIFICATIONS",
      mode: "NORMAL",
      seed: "BASE",
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: "run-created", status: "QUEUED" });
    expect(mocks.scheduleScenarioRunDrain).toHaveBeenCalledWith(
      "demo-user-001",
      "run-created",
    );
  });

  it("self-heals a non-terminal run when it is observed", async () => {
    const response = await getRunRoute(
      new Request("http://localhost/api/scenario-runs/run-existing"),
      context<"/api/scenario-runs/[id]">("run-existing"),
    );

    expect(response.status).toBe(200);
    expect(mocks.scheduleScenarioRunDrain).toHaveBeenCalledWith(
      "demo-user-001",
      "run-existing",
    );
  });

  it("hands retry execution to the same server background scheduler", async () => {
    const response = await retryRoute(
      new Request("http://localhost/api/scenario-runs/run-original/retry", { method: "POST" }),
      context<"/api/scenario-runs/[id]/retry">("run-original"),
    );

    expect(response.status).toBe(201);
    expect(mocks.scheduleScenarioRunDrain).toHaveBeenCalledWith(
      "demo-user-001",
      "run-retry",
    );
  });

  it("hands a successfully attached manual import back to server execution", async () => {
    const response = await manualImportRoute(
      jsonRequest("http://localhost/api/scenario-runs/run-manual/manual-import", {
        uploadedFileId: "upload-parsed",
      }, { "if-match": "7" }),
      context<"/api/scenario-runs/[id]/manual-import">("run-manual"),
    );

    expect(response.status).toBe(200);
    expect(mocks.resumeWithManualImport).toHaveBeenCalledWith(
      "demo-user-001",
      "run-manual",
      "upload-parsed",
      7,
    );
    expect(mocks.scheduleScenarioRunDrain).toHaveBeenCalledWith(
      "demo-user-001",
      "run-manual",
    );
  });
});

function run(id: string, status: string) {
  return { id, status, version: 1, steps: [] };
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

type ScenarioRoutePath =
  | "/api/scenario-runs/[id]"
  | "/api/scenario-runs/[id]/retry"
  | "/api/scenario-runs/[id]/manual-import";

function context<Path extends ScenarioRoutePath>(id: string) {
  return { params: Promise.resolve({ id }) } as RouteContext<Path>;
}
