import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { generateUniversalChatDataset } from "@/adapters/mock/fixtures/universal-chat-dataset";
import type { PublicUniversalResult } from "@/application/agent-orchestrator/universal-chat/public-projection";
import { createFixedScenarioClock } from "@/domain/agent/universal-chat/scenario-clock";

import { E2E_DEMO_LOGIN, E2E_DEMO_PASSWORD } from "./demo-auth";

const dataset = generateUniversalChatDataset(
  createFixedScenarioClock("2026-08-13T09:15:00.000Z"),
);
const pipeProject = project(dataset.manifest.referenceProjectIds.pipeRichProjectId);
const noPipeProject = project(dataset.manifest.referenceProjectIds.noPipeProjectId);
const compatibleSource = dataset.operationalMaterials.find((item) => item.familyId && item.catalogItemCode === "CAT-DEMO-PIP-0005")
  ?? dataset.operationalMaterials.find((item) => item.familyId)!;
const compatibleCandidate = dataset.operationalMaterials.find((item) =>
  item.familyId === compatibleSource.familyId && item.materialCode !== compatibleSource.materialCode)!;

interface ThreadView { readonly id: string }
interface MessageView {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly structuredOutput: Record<string, unknown> | null;
  readonly citations: readonly unknown[];
}

test.describe("Универсальный МТР-агент — business E2E 41–64", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "Каждый business-сценарий считается один раз; mobile покрыт сценарием 65");
    await login(page);
  });

  test("41. список проектов возвращается структурированной карточкой", async ({ page }) => {
    const result = answer(await ask(page.request, "Покажи активные проекты"));
    expect(result.summary).toContain("бизнес-проект");
    expect(result.tables[0]).toMatchObject({ title: "Активные проекты", totalRows: 22 });
  });

  test("42. остаток труб считается по фактическому названию проекта", async ({ page }) => {
    const result = answer(await ask(page.request, `Какой остаток по трубам по проекту ${pipeProject.name}?`));
    expect(fact(result, "Трубных позиций")).toBeGreaterThanOrEqual(24);
    expect(fact(result, "Дефицитных материалов")).toBeGreaterThanOrEqual(0);
    expect(result.tables[0]?.columns).toContain("Дозаказ");
  });

  test("43. проект без труб даёт доказанный нулевой срез, а не чужие позиции", async ({ page }) => {
    const result = answer(await ask(page.request, `Какой остаток по трубам по проекту ${noPipeProject.name}?`));
    expect(fact(result, "Трубных позиций")).toBe(0);
    expect(result.tables[0]?.totalRows).toBe(0);
  });

  test("44. спецификации фильтруются по выбранному бизнес-проекту", async ({ page }) => {
    const result = answer(await ask(page.request, `Покажи спецификации проекта ${pipeProject.code}`));
    expect(fact(result, "Актуальных спецификаций")).toBeGreaterThanOrEqual(3);
    expect(result.tables[0]?.title).toContain("Спецификации");
  });

  test("45. назначение обслуживание сужает проектную выборку", async ({ page }) => {
    const all = answer(await ask(page.request, `Покажи спецификации проекта ${pipeProject.code}`));
    const maintenance = answer(await ask(page.request, `Покажи спецификации проекта ${pipeProject.code}, только обслуживание`));
    expect(fact(maintenance, "Актуальных спецификаций")).toBeLessThan(fact(all, "Актуальных спецификаций"));
  });

  test("46. ближайшие сроки используют фиксированный календарный горизонт", async ({ page }) => {
    const result = answer(await ask(page.request, "Какие сроки в ближайшие 3 дня?"));
    expect(result.summary).toContain("3 дн.");
    expect(result.tables[0]?.title).toBe("Ближайшие сроки");
  });

  test("47. разговорное «упало сегодня» означает поступление", async ({ page }) => {
    const result = answer(await ask(page.request, "Сколько спецификаций упало сегодня?"));
    expect(fact(result, "Получено")).toBeGreaterThan(0);
    expect(result.summary).toContain("Сегодня получено");
  });

  test("48. слово ошибка переключает intake на реальные отказы", async ({ page }) => {
    const result = answer(await ask(page.request, "Сколько спецификаций упало сегодня с ошибкой?"));
    expect(result.summary).toMatch(/Сегодня с ошибкой: \d+/u);
    expect(result.tables[0]?.title).toBe("Ошибки загрузки");
  });

  test("49. очередь обработки показывает статусы и SLA", async ({ page }) => {
    const result = answer(await ask(page.request, "Что сейчас в очереди обработки спецификаций?"));
    expect(result.tables[0]?.columns).toEqual(expect.arrayContaining(["Статус", "Шаг", "SLA"]));
  });

  test("50. портфельные риски содержат доказательные источники", async ({ page }) => {
    const response = await askMessage(page.request, "Какие проекты под риском?");
    const result = answer(readUniversal(response));
    expect(fact(result, "Проектов под риском")).toBeGreaterThanOrEqual(0);
    expect(response.citations.length).toBeGreaterThan(0);
  });

  test("51. SLA-отставания не смешиваются со всеми рисками", async ({ page }) => {
    const result = answer(await ask(page.request, "Какие проекты отстают по SLA?"));
    expect(fact(result, "Нарушений SLA")).toBeGreaterThanOrEqual(0);
  });

  test("52. решения для человека выделяются отдельной выборкой", async ({ page }) => {
    const result = answer(await ask(page.request, "Какие решения ждут человека?"));
    expect(fact(result, "Ждут решения человека")).toBeGreaterThanOrEqual(0);
  });

  test("53. прогноз исчерпания показывает горизонт и ограничения", async ({ page }) => {
    const result = answer(await ask(page.request, "Что закончится в ближайшие 30 дней?"));
    expect(fact(result, "Материалов с риском исчерпания")).toBeGreaterThanOrEqual(0);
    expect(result.tables.some((table) => table.title === "Прогноз исчерпания")).toBe(true);
  });

  test("54. сборочный узел раскрывает шесть компонентов BOM", async ({ page }) => {
    const result = answer(await ask(page.request, "Покажи состав сборочного узла CAT-DEMO-ASM-PIP-0001"));
    expect(result.tables.find((table) => table.title.includes("сборочного узла"))?.totalRows).toBe(6);
  });

  test("55. сравнение двух деталей показывает проценты и вердикт", async ({ page }) => {
    const result = answer(await ask(
      page.request,
      `На сколько процентов ${compatibleSource.catalogItemCode} совместима с ${compatibleCandidate.catalogItemCode} и почему?`,
    ));
    expect(result.compatibility).toHaveLength(1);
    expect(result.compatibility[0]?.technicalCompatibilityPercent).toEqual(expect.any(Number));
    expect(result.compatibility[0]?.verdictLabel).not.toMatch(/EXACT|CONDITIONAL|PROHIBITED/u);
  });

  test("56. надёжность не подменяется технической совместимостью", async ({ page }) => {
    const result = answer(await ask(
      page.request,
      `Что надёжнее ${compatibleSource.catalogItemCode} или ${compatibleCandidate.catalogItemCode}?`,
    ));
    expect(result.recommendations.some((item) => /надёжност/iu.test(`${item.title} ${item.explanation}`))).toBe(true);
    expect(result.requiresHumanReview).toBe(true);
  });

  test("57. последняя версия спецификации объясняется по публичному коду", async ({ page }) => {
    const result = answer(await ask(page.request, "Что изменилось в последней версии spec-demo-piping-001?"));
    expect(result.tables[0]?.totalRows).toBeGreaterThanOrEqual(2);
    expect(result.summary).toContain("текущая версия");
  });

  test("58. неизвестный материал приводит к честному ограничению", async ({ page }) => {
    const result = answer(await ask(page.request, "Что это за материал CAT-DEMO-NOT-9999?"));
    expect(result.confidence).toBe(0);
    expect(result.requiresHumanReview).toBe(true);
    expect(result.limitations.length).toBeGreaterThan(0);
  });

  test("59. multi-turn сохраняет проект и назначение в одном диалоге", async ({ page }) => {
    const thread = await createThread(page.request, "E2E universal memory");
    const first = answer(readUniversal(await send(page.request, thread.id, `Покажи дефицит по трубам проекта ${pipeProject.code}`)));
    const second = answer(readUniversal(await send(page.request, thread.id, "А какие из дефицитных можно заменить? Оставь только обслуживание.")));
    expect(first.risks.length).toBeGreaterThan(0);
    expect(fact(second, "Активных спецификаций")).toBeGreaterThan(0);
  });

  test("60. сохранённый ответ не раскрывает внутренние runtime и scope id", async ({ page }) => {
    const thread = await createThread(page.request, "E2E public boundary");
    await send(page.request, thread.id, "Покажи активные проекты");
    const response = await page.request.get(`/api/agent/threads/${encodeURIComponent(thread.id)}/messages`);
    expect(response.ok()).toBe(true);
    const json = await response.text();
    expect(json).toContain("universal-agent-answer-public-v1");
    expect(json).not.toMatch(/resolvedContext|toolCalls|learningProvenance|providerVersion|scoreBreakdown/u);
  });

  test("61. файл без команды только предварительно проверяется", async ({ page }) => {
    const uploadId = await uploadCsv(page.request, `preview-${Date.now()}.csv`);
    const thread = await createThread(page.request, "E2E preview import");
    const message = await send(page.request, thread.id, "", {}, [{ uploadId, purpose: "SPECIFICATION" }]);
    expect(message.structuredOutput).toMatchObject({
      schemaVersion: "agent-attachment-import-v1",
      attachmentImport: { status: "PREVIEW", validRows: 2, invalidRows: 0 },
    });
  });

  test("62. явная команда публикует новую версию ровно идемпотентно", async ({ page }) => {
    const uploadId = await uploadCsv(page.request, `publish-${Date.now()}.csv`);
    const thread = await createThread(page.request, "E2E publish import");
    const body = [{ uploadId, purpose: "SPECIFICATION" }] as const;
    const first = await send(page.request, thread.id, "Опубликуй эту спецификацию как новую версию", {
      projectId: "demo-project-001",
      specificationId: "spec-demo-piping-001",
    }, body);
    const replay = await send(page.request, thread.id, "Опубликуй эту спецификацию как новую версию", {
      projectId: "demo-project-001",
      specificationId: "spec-demo-piping-001",
    }, body);
    const firstImport = attachment(first);
    const replayImport = attachment(replay);
    expect(firstImport.status).toBe("PUBLISHED");
    expect(replayImport).toMatchObject({
      status: "PUBLISHED",
      published: { versionNumber: (firstImport.published as Record<string, unknown>).versionNumber, positionCount: 2 },
    });
  });

  test("63. нечёткая новая спецификация остаётся preview без публикации", async ({ page }) => {
    const uploadId = await uploadCsv(page.request, `ambiguous-${Date.now()}.csv`);
    const thread = await createThread(page.request, "E2E ambiguous import");
    const result = attachment(await send(
      page.request,
      thread.id,
      "Сохрани как новую спецификацию",
      { projectId: "demo-project-001" },
      [{ uploadId, purpose: "SPECIFICATION" }],
    ));
    expect(result).toMatchObject({ status: "PREVIEW", targetMode: null });
    expect(result).not.toHaveProperty("published");
  });

  test("64. административная фраза создаёт только proposal без мутации", async ({ page }) => {
    const thread = await createThread(page.request, "E2E RBAC proposal");
    const output = await send(page.request, thread.id, "Заблокируй сотрудника analyst", { projectId: "demo-project-001" });
    expect(output.structuredOutput).toMatchObject({
      schemaVersion: "agent-privileged-action-v1",
      actionProposal: { status: "PROPOSED", summary: "Заблокировать пользователя" },
    });
    expect(JSON.stringify(output.structuredOutput)).not.toContain("demo-analyst-001");
  });
});

test("65. mobile-виджет показывает универсальную карточку без horizontal overflow", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile-компоновка");
  await login(page);
  await page.goto("/mtr-analysis");
  await page.getByRole("button", { name: "МТР-агент", exact: true }).click();
  const widget = page.getByRole("complementary", { name: "МТР-агент" });
  await widget.getByTestId("agent-input").fill("Покажи активные проекты");
  await widget.getByTestId("agent-input").press("Enter");
  await expect(widget.getByTestId("universal-agent-result")).toBeVisible({ timeout: 15_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});

function project(id: string) {
  const value = dataset.businessProjects.find((item) => item.id === id);
  if (!value) throw new Error(`Не найден reference project ${id}`);
  return value;
}

async function login(page: Page) {
  const response = await page.request.post("/api/auth/login", {
    data: { login: E2E_DEMO_LOGIN, password: E2E_DEMO_PASSWORD },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function ask(request: APIRequestContext, message: string): Promise<PublicUniversalResult> {
  return readUniversal(await askMessage(request, message));
}

async function askMessage(request: APIRequestContext, message: string): Promise<MessageView> {
  const thread = await createThread(request, `E2E ${message.slice(0, 70)}`);
  return send(request, thread.id, message);
}

async function createThread(request: APIRequestContext, title: string): Promise<ThreadView> {
  const response = await request.post("/api/agent/threads", { data: { title } });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json() as { thread: ThreadView }).thread;
}

async function send(
  request: APIRequestContext,
  threadId: string,
  message: string,
  selection: Record<string, string> = {},
  attachments: readonly Readonly<{ uploadId: string; purpose: "SPECIFICATION" }>[] = [],
): Promise<MessageView> {
  const response = await request.post(`/api/agent/threads/${encodeURIComponent(threadId)}/messages`, {
    data: { message, threadId, ...(Object.keys(selection).length ? { selection } : {}), ...(attachments.length ? { attachments } : {}) },
  });
  expect(response.status(), await response.text()).toBe(201);
  const items = (await response.json() as { items: readonly MessageView[] }).items;
  const assistant = items.find((item) => item.role === "assistant");
  if (!assistant) throw new Error("Ответ МТР-агента отсутствует");
  return assistant;
}

function readUniversal(message: MessageView): PublicUniversalResult {
  const output = message.structuredOutput as PublicUniversalResult | null;
  expect(output?.schemaVersion).toBe("universal-agent-answer-public-v1");
  if (!output || output.schemaVersion !== "universal-agent-answer-public-v1") throw new Error("Нет public universal result");
  return output;
}

function answer(result: PublicUniversalResult) {
  expect(result.kind).toBe("ANSWER");
  if (result.kind !== "ANSWER") throw new Error(result.question);
  return result;
}

function fact(result: ReturnType<typeof answer>, label: string): number {
  const value = result.facts.find((item) => item.label === label)?.value;
  expect(value, `Факт «${label}» отсутствует`).toEqual(expect.any(Number));
  return Number(value);
}

async function uploadCsv(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post("/api/uploads", {
    multipart: {
      purpose: "SPECIFICATION",
      file: {
        name,
        mimeType: "text/csv",
        buffer: Buffer.from("internalCode;nameRu;requiredQuantity;unit\nE2E-001;Труба E2E;2;EA\nE2E-002;Фланец E2E;4;EA\n", "utf8"),
      },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return String((await response.json() as { id: string }).id);
}

function attachment(message: MessageView): Record<string, unknown> {
  const value = message.structuredOutput?.attachmentImport;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Нет attachmentImport");
  return value as Record<string, unknown>;
}
