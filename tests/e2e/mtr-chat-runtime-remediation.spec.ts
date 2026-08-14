import { Buffer } from "node:buffer";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { E2E_DEMO_LOGIN, E2E_DEMO_PASSWORD } from "./demo-auth";

test.describe("Corrective universal chat and responsibility analysis — business E2E 66–71", () => {
  test.beforeEach(async ({ page, isMobile }, testInfo) => {
    test.skip(Boolean(isMobile), "Каждый business case считается один раз; mobile уже покрыт отдельным universal case.");
    testInfo.setTimeout(300_000);
    await login(page.request);
  });

  test("66. TC-CHAT-01-ACTIVE-PROJECTS — literal UI query", async ({ page }) => {
    const result = await askInWidget(page, "Покажи активные проекты");
    await expect(result).toContainText("Доступно 22 активных бизнес-проекта");
    await expect(result.getByRole("heading", { name: "Активные проекты" })).toBeVisible();
    await expect(result.getByText("Активен", { exact: true })).toHaveCount(22);
    await expect(result).not.toContainText(/mock|детерминированн|уверенность 100%/iu);
  });

  test("67. TC-CHAT-02-INVENTORY-OBJECT — literal full object keeps warehouse ambiguity", async ({ page }) => {
    const result = await askInWidget(
      page,
      "Есть ли на втором складке шкаф управления электродвигателем № 0001?",
    );
    await expect(result).toContainText("Уточните склад для материала");
    await expect(result).toContainText("Шкаф управления электродвигателем № 0001");
    await expect(result).toContainText("WH-DEMO-CENTRAL");
    await expect(result).toContainText("WH-DEMO-SOUTH");
    await expect(result).not.toContainText(/общий список|электродвигатели|уверенность/iu);
  });

  test("68. TC-CHAT-03-PROJECT-STATUS — active, planned и all не смешиваются", async ({ page }) => {
    const active = await askApi(page.request, "Покажи активные проекты");
    const planned = await askApi(page.request, "Покажи запланированные проекты");
    const all = await askApi(page.request, "Покажи все проекты");

    expect(answer(active).tables[0]?.totalRows).toBe(22);
    expect(answer(active).tables[0]?.rows.every((row) => row["Статус"] === "Активен")).toBe(true);
    expect(answer(planned).tables[0]?.totalRows).toBe(0);
    expect(answer(all).tables[0]?.totalRows).toBe(22);
  });

  test("69. TC-CHAT-04-WAREHOUSE-AMBIGUITY — provider fallback keeps universal clarification", async ({ page }) => {
    const result = await askApi(
      page.request,
      "Есть ли на неизвестном складе шкаф управления электродвигателем № 0001?",
    );
    expect(result).toMatchObject({
      kind: "CLARIFICATION",
      candidates: [
        { kindLabel: "Склад", code: "WH-DEMO-CENTRAL" },
        { kindLabel: "Склад", code: "WH-DEMO-SOUTH" },
      ],
    });
    expect(result).not.toHaveProperty("confidence");
    expect(result).not.toHaveProperty("requiresHumanReview");
  });

  test("70. TC-ANALYSIS-01-RULE-COVERAGE — новый run показывает rule-based decisions", async ({ page }) => {
    await reset(page.request);
    const run = await completeRun(page.request, await createRun(page.request, "spec-demo-piping-001"));
    await page.goto("/mtr-analysis");
    const section = page.locator("#responsibility");

    await expect(section.locator("tbody tr")).toHaveCount(8);
    await expect(section).not.toContainText("45%");
    await expect(section).not.toContainText("UNRESOLVED");
    await expect(section).not.toContainText("Явное демонстрационное правило не найдено");
    const report = await json<{ results: Array<{ responsibilityDecisionState: string; responsibilityCitation: unknown }> }>(
      await page.request.get(`/api/reports/${encodeURIComponent(run.id)}`),
    );
    expect(report.results.every((row) =>
      ["RESOLVED", "REVIEW_REQUIRED"].includes(row.responsibilityDecisionState) && row.responsibilityCitation)).toBe(true);
  });

  test("71. TC-ANALYSIS-02-NO-RULE — unknown type remains insufficient and unassigned", async ({ page }) => {
    await reset(page.request);
    const uploadId = await uploadNoRuleSpecification(page.request);
    const thread = await createThread(page.request, "No-rule fixture");
    const published = await send(page.request, thread.id, "Опубликуй эту спецификацию как новую версию", {
      projectId: "demo-project-001",
      specificationId: "spec-demo-piping-001",
    }, [{ uploadId, purpose: "SPECIFICATION" }]);
    expect(published.structuredOutput).toMatchObject({
      attachmentImport: { status: "PUBLISHED", published: { positionCount: 1 } },
    });

    const run = await completeRun(page.request, await createRun(page.request, "spec-demo-piping-001"));
    const report = await json<{ results: Array<{ responsibilityDecisionState: string; responsibility: unknown; responsibilityConfidence: unknown; responsibilityCitation: unknown }> }>(
      await page.request.get(`/api/reports/${encodeURIComponent(run.id)}`),
    );
    expect(report.results).toEqual([
      expect.objectContaining({
        responsibilityDecisionState: "INSUFFICIENT_DATA",
        responsibility: null,
        responsibilityConfidence: null,
        responsibilityCitation: null,
      }),
    ]);

    await page.goto("/mtr-analysis");
    await expect(page.locator("#responsibility")).toContainText("Недостаточно данных");
    await expect(page.getByText("Заказчик", { exact: true }).locator("..")).toContainText("0 поз.");
    await expect(page.getByText("Подрядчик", { exact: true }).locator("..")).toContainText("0 поз.");
  });
});

interface PublicUniversal {
  schemaVersion: "universal-agent-answer-public-v1";
  kind: "ANSWER" | "CLARIFICATION";
  summary?: string;
  tables?: Array<{ totalRows: number; rows: Array<Record<string, string | number | null>> }>;
  candidates?: Array<{ kindLabel: string; code: string; name: string }>;
}

interface MessageView {
  role: "user" | "assistant";
  structuredOutput: Record<string, unknown> | null;
}

interface RunView { id: string; status: string }

async function askInWidget(page: Page, message: string) {
  await page.goto("/mtr-analysis");
  await page.getByRole("button", { name: "МТР-агент", exact: true }).click();
  const widget = page.getByRole("complementary", { name: "МТР-агент" });
  await widget.getByTestId("agent-input").fill(message);
  await widget.getByTestId("agent-send").click();
  const result = widget.getByTestId("universal-agent-result").last();
  await expect(result).toBeVisible({ timeout: 20_000 });
  return result;
}

async function askApi(request: APIRequestContext, message: string): Promise<PublicUniversal> {
  const thread = await createThread(request, `Corrective ${message.slice(0, 50)}`);
  const assistant = await send(request, thread.id, message);
  const output = assistant.structuredOutput as PublicUniversal | null;
  expect(output?.schemaVersion).toBe("universal-agent-answer-public-v1");
  if (!output) throw new Error("Нет public universal ответа.");
  return output;
}

function answer(result: PublicUniversal) {
  expect(result.kind).toBe("ANSWER");
  if (result.kind !== "ANSWER" || !result.tables) throw new Error("Ожидался answer.");
  return result as Required<Pick<PublicUniversal, "tables">> & PublicUniversal;
}

async function createThread(request: APIRequestContext, title: string) {
  return (await json<{ thread: { id: string } }>(await request.post("/api/agent/threads", { data: { title } }))).thread;
}

async function send(
  request: APIRequestContext,
  threadId: string,
  message: string,
  selection: Record<string, string> = {},
  attachments: readonly { uploadId: string; purpose: "SPECIFICATION" }[] = [],
): Promise<MessageView> {
  const payload = await json<{ items: MessageView[] }>(await request.post(
    `/api/agent/threads/${encodeURIComponent(threadId)}/messages`,
    { data: { threadId, message, ...(Object.keys(selection).length ? { selection } : {}), ...(attachments.length ? { attachments } : {}) } },
  ));
  const assistant = payload.items.find((item) => item.role === "assistant");
  if (!assistant) throw new Error("Ответ МТР-агента отсутствует.");
  return assistant;
}

async function uploadNoRuleSpecification(request: APIRequestContext): Promise<string> {
  const response = await request.post("/api/uploads", {
    multipart: {
      purpose: "SPECIFICATION",
      file: {
        name: "no-rule-fixture.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          "internalCode;nameRu;requiredQuantity;unit;equipmentType\nNO-RULE-001;Контролируемая позиция без правила;2;EA;NO_RULE_TEST\n",
          "utf8",
        ),
      },
    },
  });
  return String((await json<{ id: string }>(response)).id);
}

async function createRun(request: APIRequestContext, specificationId: string): Promise<RunView> {
  return json<RunView>(await request.post("/api/scenario-runs", {
    data: { scenarioId: "scenario-full-analysis", specificationId, mode: "NORMAL", seed: "BASE" },
  }));
}

async function completeRun(request: APIRequestContext, initial: RunView): Promise<RunView> {
  const deadline = Date.now() + 30_000;
  let run = initial;
  while (!new Set(["COMPLETED", "FAILED", "CANCELLED"]).has(run.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    run = await json<RunView>(await request.get(`/api/scenario-runs/${encodeURIComponent(run.id)}`));
  }
  expect(run.status).toBe("COMPLETED");
  return run;
}

async function login(request: APIRequestContext) {
  const response = await request.post("/api/auth/login", { data: { login: E2E_DEMO_LOGIN, password: E2E_DEMO_PASSWORD } });
  expect(response.ok(), await response.text()).toBe(true);
}

async function reset(request: APIRequestContext) {
  const response = await request.post("/api/admin/reset", {
    data: { confirmation: "RESET_DEMO_DATA" },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function json<T>(response: { ok(): boolean; text(): Promise<string>; json(): Promise<unknown> }): Promise<T> {
  if (!response.ok()) throw new Error(await response.text());
  return response.json() as Promise<T>;
}
