import { Buffer } from "node:buffer";

import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Download,
  type Page,
} from "@playwright/test";
import * as XLSX from "xlsx";

import { findRawUserEnum, RAW_USER_ENUM_PATTERN } from "./ui-contract";

interface RunView {
  id: string;
  userId: string;
  scenarioId: string;
  status: string;
  currentStep: string;
  progress: number;
  version: number;
  errorCode?: string;
  errorMessage?: string;
  steps: Array<{ status: string; outcome: string }>;
}

const isRemotePreview = Boolean(process.env.PLAYWRIGHT_BASE_URL);
const scenarioCompletionTimeout = isRemotePreview ? 90_000 : 15_000;
const resetCompletionTimeout = isRemotePreview ? 30_000 : 5_000;
const INTERNAL_AGENT_CONTENT_PATTERN =
  /\b(?:appius|sap|norms?|normative|scenarios?|reports?|llm)\.[a-z][a-z0-9_.-]*\b|"(?:toolCalls|systemPrompt|arguments|stackTrace)"\s*:/iu;

test.describe("МТР — обязательные сценарии мастер-промта", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    if (isRemotePreview) testInfo.setTimeout(120_000);
    await loginDemoUser(page.request);
    await resetDemoData(page.request);
  });

  test("1. пользователь видит свои данные и имя в шапке", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("header").getByText("Демо-пользователь 1", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Демо-пользователь 1" })).toBeVisible();
    await expectMetric(page, "Актуальные позиции", "24");
    const userCard = page.getByText("Данные пользователя", { exact: true }).locator("..");
    await expect(userCard.getByText("Спецификации", { exact: true }).locator("..")).toContainText("3");
    await expect(userCard.getByText("Запуски", { exact: true }).locator("..")).toContainText("0");
    await expect(page.getByText("Только синтетические демонстрационные данные", { exact: true })).toHaveCount(1);
  });

  test("2. администратор запускает полный анализ спецификации", async ({ page }) => {
    await page.goto("/admin/scenarios");

    await page.getByLabel("Сценарий", { exact: true }).selectOption("scenario-full-analysis");
    await page.getByLabel("Спецификация", { exact: true }).selectOption("ALL_CURRENT_SPECIFICATIONS");
    const createdResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/scenario-runs",
    );
    await page.getByTestId("launch-scenario").click();
    const created = await responseJson<RunView>(await createdResponse);

    await expect(page.getByRole("heading", { name: "Завершено", exact: true })).toBeVisible({
      timeout: scenarioCompletionTimeout,
    });
    await expect(page.getByRole("link", { name: "Открыть отчёт" })).toBeVisible();
    await expect(page.getByLabel("Журнал шагов").getByText("Завершено", { exact: true })).toHaveCount(6);

    await page
      .getByRole("navigation", { name: "Основная навигация" })
      .getByRole("link", { name: "Запуски", exact: true })
      .click();
    const runRow = page
      .getByRole("link", { name: created.id.slice(-12), exact: true })
      .locator("xpath=ancestor::tr");
    await expect(runRow).toContainText("Завершено");
  });

  test("2a. сервер завершает запуск без UI и вызовов advance", async ({ page }) => {
    const created = await createRun(page.request);

    const completed = await waitForTerminal(page.request, created);

    expect(completed).toMatchObject({ status: "COMPLETED", progress: 100 });
    expect(completed.steps).toHaveLength(6);
    expect(completed.steps.every((step) => step.outcome === "COMPLETED")).toBe(true);
  });

  test("2b. отмена сохраняется при гонке с выполняющимся server drain", async ({ page }) => {
    await setIntegrationState(page.request, {
      system: "APPIUS",
      state: "SLOW",
      safeMessage: "Appius выполняет тестовый медленный ответ.",
      delayMs: 2_000,
    });
    const created = await createRun(page.request);

    const cancelled = await responseJson<RunView>(
      await page.request.post(`/api/scenario-runs/${encodeURIComponent(created.id)}/cancel`),
    );
    const persisted = await responseJson<RunView>(
      await page.request.get(`/api/scenario-runs/${encodeURIComponent(created.id)}`),
    );

    expect(cancelled.status).toBe("CANCELLED");
    expect(persisted.status).toBe("CANCELLED");
    expect(persisted.steps.some((step) => step.status === "SYNCING_SAP")).toBe(false);
  });

  test("3. stepper доходит до завершения и открывает сохранённый отчёт", async ({ page }) => {
    const request = page.request;
    const run = await createRun(request);

    await page.goto(`/runs/${encodeURIComponent(run.id)}`);

    await expect(page.getByRole("heading", { name: "Завершено", exact: true })).toBeVisible({
      timeout: scenarioCompletionTimeout,
    });
    await expect(page.getByText("100%", { exact: true })).toBeVisible();
    const stepJournal = page.getByText("Журнал шагов", { exact: true }).locator("..");
    await expect(stepJournal).toBeVisible();
    await expect(stepJournal.getByText("Завершено", { exact: true })).toHaveCount(6);
    const reportLink = page.getByRole("link", { name: "Открыть отчёт" });
    await expect(reportLink).toBeVisible();
    await reportLink.click();
    await expect(page.getByRole("heading", { name: "Итоговый отчёт" })).toBeVisible();
  });

  test("4. отчёт содержит все категории совпадений и варианты аналогов", async ({ page }) => {
    const request = page.request;
    const run = await completeRun(request, await createRun(request));
    const report = await responseJson<{ summary: { analogues: number } }>(
      await request.get(`/api/reports/${encodeURIComponent(run.id)}`),
    );
    await page.goto(`/reports/${encodeURIComponent(run.id)}`);

    await expectMetric(page, "Всего", "24");
    await expectMetric(page, "Точные", "8");
    await expectMetric(page, "Вероятные", "8");
    await expectMetric(page, "Требуют проверки", "5");
    await expectMetric(page, "Не найдено", "3");
    const resultRows = page.locator("table").first().locator("tbody");
    await expect(resultRows.getByText("Точное совпадение", { exact: true })).toHaveCount(8);
    await expect(resultRows.getByText("Вероятное совпадение", { exact: true })).toHaveCount(8);
    await expect(resultRows.getByText("Требуется проверка", { exact: true })).toHaveCount(5);
    await expect(resultRows.getByText("Не найдено", { exact: true })).toHaveCount(3);
    expect(report.summary.analogues).toBeGreaterThan(0);
    await expectMetric(page, "Аналоги", String(report.summary.analogues));
    await expect(page.getByRole("heading", { name: "Варианты аналогов" })).toBeVisible();
    await expect(page.getByTestId("analogue-option").first()).toBeVisible();
    await expect(page.getByText("Основной план покрытия", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Альтернативный план покрытия", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Компонент покрытия", { exact: false }).first()).toBeVisible();
  });

  test("5. агент возвращает подтверждённый остаток, а свежие логи открываются без reload", async ({
    page,
    isMobile,
  }) => {
    await page.goto("/agent");
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "AI-агент" }).click();
    const userChat = page.getByLabel("Диалог с МТР-аналитиком");
    await page.getByTestId("agent-input").fill("Каков текущий остаток материала SAP-DEMO-0001?");
    const messageResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/api\/agent\/threads\/[^/]+\/messages$/u.test(new URL(response.url()).pathname),
    );
    await page.getByTestId("agent-send").click();
    const payload = await responseJson<{
      items: Array<{
        role: string;
        content: string;
        citations: Array<{ sourceSystem: string; entityId: string; versionOrSnapshot: string }>;
        structuredOutput?: {
          confidence?: number;
          requiresHumanReview?: boolean;
        };
      }>;
    }>(await messageResponse);
    const assistant = payload.items.find((item) => item.role === "assistant");

    expect(assistant?.content).toContain("200");
    expect(Object.keys(assistant?.structuredOutput ?? {}).sort()).toEqual([
      "confidence",
      "requiresHumanReview",
    ]);
    expect(assistant?.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceSystem: "SAP", entityId: "SAP-DEMO-0001" }),
      ]),
    );
    expect(assistant?.citations[0]?.versionOrSnapshot).toBeTruthy();
    expect(JSON.stringify(payload)).not.toMatch(INTERNAL_AGENT_CONTENT_PATTERN);

    await expect(page.getByRole("heading", { name: /МТР-аналитик|AI-агент|Проектный агент/i })).toBeVisible();
    await expect(userChat).toContainText("200");
    await expect(userChat).not.toContainText("sap.getMaterialStock");
    await expect(userChat).not.toContainText("sap.getState");
    await expect(userChat).not.toContainText("llm.respond");

    if (isMobile) await page.getByRole("button", { name: "Закрыть" }).click();
    await page
      .getByRole("navigation", { name: "Основная навигация" })
      .getByRole("link", { name: "Логи агента", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "Логи AI-агента" })).toBeVisible();
    await expect(page.getByTestId("agent-logs-dashboard")).toContainText("Вызовы инструментов");
    await expect(page.getByTestId("agent-operation-card").filter({ hasText: "sap.getMaterialStock" }).first()).toBeVisible();
  });

  test("6. при отключённом SAP видны безопасная ошибка и ручной импорт", async ({ page }) => {
    const request = page.request;
    await setIntegrationState(request, {
      system: "SAP",
      state: "UNAVAILABLE",
      safeMessage: "SAP временно недоступна для демонстрационной проверки.",
    });
    const run = await waitForTerminal(request, await createRun(request));
    expect(run).toMatchObject({ status: "FAILED", errorCode: "SAP_UNAVAILABLE" });

    await page.goto(`/runs/${encodeURIComponent(run.id)}`);
    const safeFailure = page.getByRole("alert").filter({ hasText: "SAP временно недоступна" });
    await expect(safeFailure).toContainText("SAP временно недоступна");
    await expect(page.locator("main")).not.toContainText("SAP_UNAVAILABLE");
    await expect(safeFailure).toContainText("Технические сведения сохранены");
    await expect(page.getByText("Продолжить через ручной импорт", { exact: true })).toBeVisible();
    const manualSapFile = page.getByLabel("Файл остатков SAP");
    await expect(manualSapFile).toBeVisible();
    await manualSapFile.setInputFiles({
      name: "sap-manual-e2e.csv",
      mimeType: "text/csv",
      buffer: Buffer.from([
        "materialCode;nameRu;legacyCode;equipmentType;standard;materialGrade;availableQuantity;unit;plant;warehouse;snapshotDate",
        "MANUAL-SAP-E2E;Труба стальная DN 50;APP-DEMO-PIPE-001;PIPE;GOST-DEMO-PIPE-001;STEEL-DEMO-C20;7;M;PLANT-E2E;WH-E2E;2026-08-12T00:00:00.000Z",
      ].join("\n"), "utf8"),
    });

    await expect(page.getByRole("heading", { name: "Завершено", exact: true })).toBeVisible({
      timeout: scenarioCompletionTimeout,
    });
    await expect(page.getByRole("link", { name: "Открыть отчёт" })).toBeVisible();
  });

  test("7. Appius использует только актуальную версию", async ({ page }) => {
    const request = page.request;
    const versionsResponse = await request.get(
      "/api/mock/appius/specifications/spec-demo-piping-001/versions",
    );
    const versions = await responseJson<{
      currentVersionId: string;
      versions: Array<{ id: string; versionNumber: number; isCurrent: boolean }>;
    }>(versionsResponse);
    const current = versions.versions.find((version) => version.isCurrent);

    expect(current).toMatchObject({
      id: "spec-demo-piping-001-v3",
      versionNumber: 3,
      isCurrent: true,
    });
    expect(versions.currentVersionId).toBe(current?.id);

    const positionsResponse = await request.get(
      "/api/mock/appius/specifications/spec-demo-piping-001/positions",
    );
    const positions = await responseJson<{
      versionId: string;
      positions: Array<{ versionId: string }>;
    }>(positionsResponse);
    expect(positions.versionId).toBe(current?.id);
    expect(positions.positions).toHaveLength(8);
    expect(positions.positions.every((position) => position.versionId === current?.id)).toBe(true);

    const staleResponse = await request.get(
      "/api/mock/appius/specifications/spec-demo-piping-001/positions?version=spec-demo-piping-001-v2",
    );
    expect(staleResponse.status()).toBe(409);

    await page.goto("/specifications/spec-demo-piping-001");
    await expect(page.getByText("Версия 3 · актуальная для анализа", { exact: true })).toBeVisible();
  });

  test("8. reset восстанавливает 24 позиции Appius и 30 записей SAP", async ({ page }) => {
    const request = page.request;
    await setIntegrationState(request, {
      system: "SAP",
      state: "UNAVAILABLE",
      safeMessage: "Состояние перед reset.",
    });
    await page.goto("/admin/audit");

    await page.getByRole("checkbox", { name: /Понимаю, что запуски/ }).check();
    await page.getByRole("button", { name: "Восстановить базовый набор" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Готово: Appius — 24, SAP — 30 материалов и 30 остатков.",
      { timeout: resetCompletionTimeout },
    );

    const specifications = await responseJson<{ specifications: unknown[] }>(
      await request.get("/api/mock/appius/specifications"),
    );
    const sap = await responseJson<{ d: { __count: string; results: unknown[] } }>(
      await request.get(
        "/api/mock/sap/odata/sap/API_MATERIAL_STOCK_SRV/A_MaterialStock?$top=100",
      ),
    );
    const integrations = await responseJson<{
      integrations: Array<{ system: string; state: string }>;
    }>(await request.get("/api/admin/integrations"));

    expect(specifications.specifications).toHaveLength(3);
    expect(sap.d.__count).toBe("30");
    expect(sap.d.results).toHaveLength(30);
    expect(integrations.integrations.find((item) => item.system === "SAP")?.state).toBe("AVAILABLE");
  });

  test("9. подмена user_id не раскрывает чужие данные", async ({ page }) => {
    const request = page.request;
    const foreignUser = "foreign-user-e2e";
    const response = await request.get(
      `/api/mock/appius/specifications?user_id=${foreignUser}&userId=${foreignUser}`,
      { headers: { "x-user-id": foreignUser } },
    );
    const payload = await responseJson<{
      specifications: Array<{ userId: string }>;
      isSyntheticDemo: boolean;
    }>(response);
    const serialized = JSON.stringify(payload);

    expect(payload.isSyntheticDemo).toBe(true);
    expect(payload.specifications).toHaveLength(3);
    expect(new Set(payload.specifications.map((item) => item.userId))).toEqual(
      new Set(["demo-user-001"]),
    );
    expect(serialized).not.toContain(foreignUser);

    const spoofedBodyResponse = await request.post("/api/scenario-runs", {
      data: {
        scenarioId: "scenario-full-analysis",
        specificationId: "ALL_CURRENT_SPECIFICATIONS",
        mode: "NORMAL",
        seed: "BASE",
        user_id: foreignUser,
      },
    });
    const spoofedRun = await responseJson<RunView>(spoofedBodyResponse);
    expect(spoofedRun.userId).toBe("demo-user-001");
    expect(JSON.stringify(spoofedRun)).not.toContain(foreignUser);
  });

  test("10. JSON, Excel и PDF корректны, локализованы и содержат варианты аналогов", async ({ page }) => {
    const request = page.request;
    const run = await completeRun(request, await createRun(request));
    await page.goto(`/reports/${encodeURIComponent(run.id)}`);

    const json = await clickAndReadDownload(page, "JSON");
    const xlsx = await clickAndReadDownload(page, "Excel");
    const pdf = await clickAndReadDownload(page, "PDF");

    expect(json.name).toMatch(/\.json$/u);
    expect(json.bytes.byteLength).toBeGreaterThan(10_000);
    const jsonReport = JSON.parse(json.bytes.toString("utf8")) as Record<string, unknown>;
    expect(jsonReport).toMatchObject({
      runId: run.id,
      status: "Завершено",
      summary: { total: 24, exact: 8, likely: 8, review: 5, noMatch: 3 },
    });
    expect(
      findRawUserEnum(JSON.stringify(jsonReport)),
      "JSON-экспорт содержит необработанный enum",
    ).toBeUndefined();

    expect(xlsx.name).toMatch(/\.xlsx$/u);
    expect(xlsx.bytes.byteLength).toBeGreaterThan(5_000);
    expect(Array.from(xlsx.bytes.subarray(0, 2))).toEqual([0x50, 0x4b]);
    const workbook = XLSX.read(xlsx.bytes, { type: "buffer" });
    expect(workbook.SheetNames).toContain("Варианты аналогов");
    const workbookText = workbook.SheetNames.map((name) =>
      XLSX.utils.sheet_to_csv(workbook.Sheets[name]!),
    ).join("\n");
    expect(workbookText).toContain("Основной план покрытия");
    expect(workbookText).toContain("Альтернативный план покрытия");
    expect(workbookText).toContain("Компонент покрытия");
    expect(
      findRawUserEnum(workbookText),
      "Excel-экспорт содержит необработанный enum",
    ).toBeUndefined();

    expect(pdf.name).toMatch(/\.pdf$/u);
    expect(pdf.bytes.byteLength).toBeGreaterThan(5_000);
    expect(pdf.bytes.subarray(0, 8).toString("latin1")).toMatch(/^%PDF-1\./u);
    expect(pdf.bytes.toString("latin1")).not.toMatch(RAW_USER_ENUM_PATTERN);
  });
});

async function resetDemoData(request: APIRequestContext): Promise<void> {
  await responseJson(
    await request.post("/api/admin/reset", {
      data: { confirmation: "RESET_DEMO_DATA" },
    }),
  );
}

async function loginDemoUser(request: APIRequestContext): Promise<void> {
  await responseJson(
    await request.post("/api/auth/login", {
      data: { login: "demo", password: "Demo2026!" },
    }),
  );
}

async function createRun(request: APIRequestContext): Promise<RunView> {
  return responseJson<RunView>(
    await request.post("/api/scenario-runs", {
      data: {
        scenarioId: "scenario-full-analysis",
        specificationId: "ALL_CURRENT_SPECIFICATIONS",
        mode: "NORMAL",
        seed: "BASE",
      },
    }),
  );
}

async function completeRun(request: APIRequestContext, initial: RunView): Promise<RunView> {
  const run = await waitForTerminal(request, initial);
  expect(run.status).toBe("COMPLETED");
  return run;
}

async function waitForTerminal(request: APIRequestContext, initial: RunView): Promise<RunView> {
  const deadline = Date.now() + scenarioCompletionTimeout;
  let run = initial;
  while (!["COMPLETED", "FAILED", "CANCELLED"].includes(run.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    run = await responseJson<RunView>(
      await request.get(`/api/scenario-runs/${encodeURIComponent(run.id)}`),
    );
  }
  expect(["COMPLETED", "FAILED", "CANCELLED"]).toContain(run.status);
  return run;
}

async function setIntegrationState(
  request: APIRequestContext,
  input: { system: "SAP" | "APPIUS"; state: string; safeMessage: string; delayMs?: number },
): Promise<void> {
  await responseJson(
    await request.patch("/api/admin/integrations", {
      data: { ...input, delayMs: input.delayMs ?? 0 },
    }),
  );
}

async function responseJson<T = unknown>(
  response: Pick<APIResponse, "text" | "ok" | "status" | "url">,
): Promise<T> {
  const text = await response.text();
  expect(response.ok(), `${response.status()} ${response.url()}\n${text}`).toBe(true);
  return JSON.parse(text) as T;
}

async function expectMetric(page: Page, label: string, value: string): Promise<void> {
  const metric = page.getByText(label, { exact: true }).first().locator("..");
  await expect(metric).toContainText(value);
}

async function clickAndReadDownload(
  page: Page,
  linkName: "JSON" | "Excel" | "PDF",
): Promise<{ name: string; bytes: Buffer }> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: linkName, exact: true }).click(),
  ]);
  return { name: download.suggestedFilename(), bytes: await readDownload(download) };
}

async function readDownload(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error(`Не удалось прочитать ${download.suggestedFilename()}`);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
