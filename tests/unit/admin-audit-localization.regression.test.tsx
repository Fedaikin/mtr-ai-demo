import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAuditLogs: vi.fn(),
}));

vi.mock("@/adapters/persistence/repository", () => ({
  getRepository: vi.fn(async () => ({
    listAuditLogs: mocks.listAuditLogs,
  })),
}));

vi.mock("@/lib/session", () => ({
  requireAnyPermission: vi.fn(async () => ({
    id: "session-demo",
    user: {
      id: "demo-user-001",
      displayName: "Демо-пользователь",
      roles: ["USER", "ADMIN"],
    },
    expiresAt: "2026-08-13T00:00:00.000Z",
  })),
  SessionError: class SessionError extends Error {},
}));

vi.mock("@/components/admin-config-reset", () => ({
  AdminConfigReset: () => null,
}));

import AdminAuditPage from "@/app/admin/audit/page";
import { GET as getAuditApi } from "@/app/api/admin/audit/route";

const RAW_UI_CODES = [
  "SCENARIO_RUN_CREATED",
  "SCENARIO_RUN",
  "FILE_UPLOADED_AND_PARSED",
  "UPLOADED_FILE",
  "AUTH_LOGIN_SUCCEEDED",
  "AUTH_LOGIN_FAILED",
  "AUTH_SESSION",
  "AUTHENTICATION",
  "ADMIN_INTEGRATION_STATE_UPDATED",
  "INTEGRATION",
  "DEMO_CREDENTIALS",
  "INVALID_CREDENTIALS",
  "appius.stale_version.rejected",
  "specification_version",
  "STALE_VERSION_REJECTED",
  "APPIUS_UNAVAILABLE",
  "MANUAL_IMPORT",
  "TIME_LIMIT",
  "authenticationMethod",
  "errorCode",
  "recommendedAction",
  "stopReason",
  "sourceSystem",
  "arguments",
  "entityId",
  "attempts",
  "sap.getState",
] as const;

describe("ACC-REACCEPT2-001: локализация журнала аудита", () => {
  beforeEach(() => {
    mocks.listAuditLogs.mockReset();
    mocks.listAuditLogs.mockResolvedValue(auditEntries());
  });

  it("не выводит raw action/entity/reason коды в тексте и HTML-атрибутах", async () => {
    const entries = auditEntries();
    mocks.listAuditLogs.mockResolvedValue(entries);

    const html = renderToStaticMarkup(
      await AdminAuditPage({
        searchParams: Promise.resolve({
          action: "SCENARIO_RUN_CREATED",
          entityType: "SCENARIO_RUN",
        }),
      }),
    );

    expect(mocks.listAuditLogs).toHaveBeenCalledWith("demo-user-001", {
      action: "SCENARIO_RUN_CREATED",
      entityType: "SCENARIO_RUN",
      limit: 100,
    });
    expect(entries).toEqual(auditEntries());
    for (const rawCode of RAW_UI_CODES) {
      expect(html, rawCode).not.toContain(rawCode);
    }
    expect(html).toContain("Запуск сценария создан");
    expect(html).toContain("Файл загружен и обработан");
    expect(html).toContain("Вход выполнен");
    expect(html).toContain("Неудачная попытка входа");
    expect(html).toContain("Устаревшая версия Appius отклонена");
    expect(html).toContain("Appius PLM недоступен");
    expect(html).toContain("Выполнить ручной импорт");
    expect(html).toContain("Достигнут лимит времени");
    expect(html).toContain("Способ аутентификации");
    expect(html).toContain("Код ошибки");
    expect(html).toContain("Рекомендуемое действие");
    expect(html).toContain("Причина остановки");
    expect(html).toContain("Исходная система");
    expect(html).toContain("Аргументы");
    expect(html).toContain("Идентификатор объекта");
    expect(html).toContain("Попытки");
    expect(html).toContain("Получить состояние SAP S/4HANA");
    expect(html).toContain("Системное поле");
    expect(html).not.toContain("futureInternalKey");
  });

  it("преобразует русские значения фильтров без учёта регистра обратно в raw-коды только для запроса", async () => {
    await AdminAuditPage({
      searchParams: Promise.resolve({
        action: "запуск сценария создан",
        entityType: "запуск сценария",
      }),
    });

    expect(mocks.listAuditLogs).toHaveBeenCalledWith("demo-user-001", {
      action: "SCENARIO_RUN_CREATED",
      entityType: "SCENARIO_RUN",
      limit: 100,
    });
  });

  it("сохраняет machine-коды в API без UI-локализации", async () => {
    const response = await getAuditApi(new Request("http://localhost/api/admin/audit?limit=100"));
    const payload = await response.json() as {
      entries: Array<{
        action: string;
        entityType: string;
        details: Record<string, unknown>;
      }>;
    };

    expect(response.status).toBe(200);
    expect(payload.entries[0]).toMatchObject({
      action: "SCENARIO_RUN_CREATED",
      entityType: "SCENARIO_RUN",
      details: { mode: "NORMAL", scenarioId: "scenario-full-analysis" },
    });
    expect(payload.entries[2]?.details).toMatchObject({
      authenticationMethod: "DEMO_CREDENTIALS",
    });
    expect(payload.entries[3]?.details).toMatchObject({ errorCode: "INVALID_CREDENTIALS" });
  });
});

function auditEntries() {
  const common = {
    userId: "demo-user-001",
    actorDisplayName: "Демо-пользователь",
    occurredAt: "2026-08-12T10:00:00.000Z",
    retentionUntil: "2027-08-12T10:00:00.000Z",
    requestId: null,
  };
  return [
    {
      ...common,
      id: "audit-scenario",
      action: "SCENARIO_RUN_CREATED",
      entityType: "SCENARIO_RUN",
      entityId: "run-demo",
      outcome: "SUCCESS",
      details: { mode: "NORMAL", scenarioId: "scenario-full-analysis" },
    },
    {
      ...common,
      id: "audit-file",
      action: "FILE_UPLOADED_AND_PARSED",
      entityType: "UPLOADED_FILE",
      entityId: "file-demo",
      outcome: "SUCCESS",
      details: { parseStatus: "PARSED" },
    },
    {
      ...common,
      id: "audit-login-success",
      action: "AUTH_LOGIN_SUCCEEDED",
      entityType: "AUTH_SESSION",
      entityId: "session-demo",
      outcome: "SUCCESS",
      details: { authenticationMethod: "DEMO_CREDENTIALS" },
    },
    {
      ...common,
      id: "audit-login-failure",
      action: "AUTH_LOGIN_FAILED",
      entityType: "AUTHENTICATION",
      entityId: null,
      outcome: "FAILURE",
      details: { errorCode: "INVALID_CREDENTIALS" },
    },
    {
      ...common,
      id: "audit-integration",
      action: "ADMIN_INTEGRATION_STATE_UPDATED",
      entityType: "INTEGRATION",
      entityId: "APPIUS",
      outcome: "SUCCESS",
      details: { system: "APPIUS", state: "AVAILABLE" },
    },
    {
      ...common,
      id: "audit-stale-version",
      action: "appius.stale_version.rejected",
      entityType: "specification_version",
      entityId: "spec-demo-v2",
      outcome: "FAILURE",
      details: { auditCode: "STALE_VERSION_REJECTED" },
    },
    {
      ...common,
      id: "audit-scenario-failure",
      action: "SCENARIO_STEP_FAILED",
      entityType: "SCENARIO_RUN",
      entityId: "run-failure",
      outcome: "FAILURE",
      details: {
        errorCode: "APPIUS_UNAVAILABLE",
        recommendedAction: "MANUAL_IMPORT",
        stopReason: "TIME_LIMIT",
        sourceSystem: "SAP",
        tool: "sap.getState",
        arguments: { entityId: "integration-state" },
        attempts: 1,
        futureInternalKey: "FUTURE_INTERNAL_VALUE",
      },
    },
  ];
}
