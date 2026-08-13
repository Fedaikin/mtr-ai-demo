import { afterAll, beforeAll } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session")>();
  return {
    ...actual,
    requireDemoRole: vi.fn(async () => ({
      user: {
        id: "demo-user-001",
        displayName: "Демо-пользователь 1",
        roles: ["USER", "ADMIN"],
        locale: "ru-RU",
      },
    })),
  };
});

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase } from "@/adapters/persistence/db";
import { getRepository } from "@/adapters/persistence/repository";
import { ScenarioService } from "@/application/scenario-service";
import { GET as exportReport } from "@/app/api/reports/[runId]/export/route";
import { DEMO_USER_DISPLAY_NAME, DEMO_USER_ID, type ScenarioRun } from "@/domain/models";
import { MTR_AGENT_UNIVERSAL_VERSION } from "@/application/agent-orchestrator/system-prompt";

describe.sequential("report export route audit", () => {
  let completedRun: ScenarioRun;

  beforeAll(async () => {
    await resetDemoDatabase(DEMO_USER_ID);
    const service = await ScenarioService.create();
    const created = await service.createRun(DEMO_USER_ID, {
      scenarioId: "scenario-full-analysis",
      specificationId: "ALL_CURRENT_SPECIFICATIONS",
      mode: "NORMAL",
      seed: "BASE",
    });
    completedRun = await driveToCompletion(service, created);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("records successful JSON, XLSX and PDF exports with report and source versions", async () => {
    for (const format of ["json", "xlsx", "pdf"] as const) {
      const response = await exportReport(
        new Request(
          `http://localhost/api/reports/${completedRun.id}/export?format=${format}`,
          { headers: { "x-request-id": `caller-controlled-${format}` } },
        ),
        context(completedRun.id),
      );
      expect(response.status, format).toBe(200);
      expect((await response.arrayBuffer()).byteLength, format).toBeGreaterThan(100);
    }

    const repository = await getRepository();
    const events = await repository.listAuditLogs(DEMO_USER_ID, {
      action: "REPORT_EXPORT_SUCCEEDED",
      limit: 10,
    });
    expect(events).toHaveLength(3);

    for (const format of ["json", "xlsx", "pdf"] as const) {
      const event = events.find((candidate) => candidate.details.format === format);
      expect(event).toMatchObject({
        actorDisplayName: DEMO_USER_DISPLAY_NAME,
        entityType: "REPORT_EXPORT",
        entityId: completedRun.id,
        outcome: "SUCCESS",
        details: {
          runId: completedRun.id,
          format,
          reportSchemaVersion: "1.1.0",
          reportGeneratedAt: expect.any(String),
          sourceVersions: {
            appius: expect.any(String),
            appiusVersions: expect.any(Array),
            sap: expect.any(String),
            normative: "DEMO_RULES_VERSIONED",
            promptVersion: MTR_AGENT_UNIVERSAL_VERSION,
            responsibilityRules: expect.any(Array),
            analogueRules: expect.any(Array),
          },
        },
      });
      expect(event?.requestId).toMatch(/^request-[0-9a-f-]{36}$/u);
      expect(event?.details).toMatchObject({ correlationId: event?.requestId });
    }

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("caller-controlled-json");
    expect(serialized).not.toContain("caller-controlled-xlsx");
    expect(serialized).not.toContain("caller-controlled-pdf");
  });

  it("records redacted failures for every supported format and hides foreign run existence", async () => {
    const foreignRunId = "run-foreign-tenant-audit-proof";
    for (const format of ["json", "xlsx", "pdf"] as const) {
      const response = await exportReport(
        new Request(
          `http://localhost/api/reports/${foreignRunId}/export?format=${format}`,
        ),
        context(foreignRunId),
      );
      expect(response.status, format).toBe(404);
      const body = await response.text();
      expect(body).toContain("RUN_NOT_FOUND");
      expect(body).not.toContain(foreignRunId);
      expect(body).not.toContain("provenance");
    }

    const unsupported = await exportReport(
      new Request(
        `http://localhost/api/reports/${completedRun.id}/export?format=token%3Dunsafe-export-secret`,
      ),
      context(completedRun.id),
    );
    expect(unsupported.status).toBe(400);

    const repository = await getRepository();
    const events = await repository.listAuditLogs(DEMO_USER_ID, {
      action: "REPORT_EXPORT_FAILED",
      limit: 10,
    });
    expect(events).toHaveLength(4);

    for (const format of ["json", "xlsx", "pdf"] as const) {
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actorDisplayName: DEMO_USER_DISPLAY_NAME,
            entityType: "REPORT_EXPORT",
            entityId: foreignRunId,
            outcome: "FAILURE",
            details: expect.objectContaining({
              runId: foreignRunId,
              format,
              errorCode: "RUN_NOT_FOUND",
              sourceVersions: null,
            }),
          }),
        ]),
      );
    }
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: completedRun.id,
          details: expect.objectContaining({
            runId: completedRun.id,
            format: "UNSUPPORTED",
            errorCode: "UNSUPPORTED_EXPORT_FORMAT",
          }),
        }),
      ]),
    );

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("unsafe-export-secret");
    expect(events.every((event) => event.requestId === event.details.correlationId)).toBe(true);
  });
});

async function driveToCompletion(
  service: ScenarioService,
  initial: ScenarioRun,
): Promise<ScenarioRun> {
  let run = initial;
  for (let step = 0; step < 12 && run.status !== "COMPLETED"; step += 1) {
    if (["FAILED", "CANCELLED"].includes(run.status)) break;
    run = await service.advance(DEMO_USER_ID, run.id, run.version);
  }
  expect(run.status).toBe("COMPLETED");
  return run;
}

function context(runId: string) {
  return {
    params: Promise.resolve({ runId }),
  } as RouteContext<"/api/reports/[runId]/export">;
}
