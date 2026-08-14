import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";

import { E2E_DEMO_LOGIN, E2E_DEMO_PASSWORD } from "./demo-auth";
import { RAW_USER_ENUM_PATTERN } from "./ui-contract";

interface RunView {
  id: string;
  status: string;
  version: number;
}

const TERMINAL_RUN_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
const RUN_COMPLETION_TIMEOUT_MS = process.env.PLAYWRIGHT_BASE_URL ? 90_000 : 15_000;

test.describe("Навигация, рабочая область аналитики и локализация", () => {
  test.beforeEach(async ({ page }) => {
    await loginDemoUser(page.request);
    await resetDemoData(page.request);
  });

  test("аналитика остаётся активной на чате, материале и отчёте", async ({ page }) => {
    const run = await completeRun(page.request, await createRun(page.request));
    const analyticsLink = page
      .getByRole("navigation", { name: "Основная навигация" })
      .getByRole("link", { name: "МТР-анализ" });

    for (const path of [
      "/agent",
      "/materials/SAP-DEMO-0001",
      `/reports/${encodeURIComponent(run.id)}`,
    ]) {
      await page.goto(path);
      await expect(analyticsLink, path).toHaveAttribute("aria-current", "page");
      await expect(page.locator('[aria-current="page"]'), path).toHaveCount(1);
    }

    await page.goto("/specifications/spec-demo-piping-001");
    await expect(
      page
        .getByRole("navigation", { name: "Основная навигация" })
        .getByRole("link", { name: "Спецификации" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("desktop: МТР Агент открывается виджетом, а поле ввода остаётся видимым", async ({
    page,
    isMobile,
  }) => {
    test.skip(Boolean(isMobile), "Проверка предназначена для desktop-компоновки");
    await page.goto("/mtr-analysis");

    const openAgent = page.getByRole("button", { name: "МТР-агент", exact: true });
    await expect(openAgent).toBeInViewport();
    // Chromium may restore a sub-pixel anchor as 1–3 CSS pixels; this is not
    // a user-visible page scroll and the launcher still has to be in viewport.
    expect(await page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(4);
    await openAgent.click();

    const widget = page.getByRole("complementary", { name: "МТР-агент", exact: true });
    const composer = widget.getByTestId("agent-input");
    await expect(composer).toBeVisible();
    await expect(composer).toBeInViewport();
    const layout = await readAgentLayout(page);
    expect(layout.panelTop).toBeGreaterThanOrEqual(0);
    expect(layout.panelHeight).toBeLessThanOrEqual(layout.viewportHeight);
    expect(layout.composerBottom).toBeLessThanOrEqual(layout.viewportHeight);
    expect(layout.historyOverflowY).toMatch(/auto|scroll/u);
  });

  test("mobile: МТР Агент закрывается без потери позиции страницы", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "Проверка предназначена для мобильной компоновки");
    await page.goto("/specifications");

    await page.evaluate(() => window.scrollTo(0, Math.min(96, document.documentElement.scrollHeight - window.innerHeight)));
    const initialScrollY = await page.evaluate(() => window.scrollY);
    const openButton = page.getByRole("button", { name: "МТР-агент", exact: true });
    await openButton.click();
    const panel = page.getByRole("complementary", { name: "МТР-агент", exact: true });
    const composer = panel.getByTestId("agent-input");
    await expect(panel).toBeVisible();
    await expect(composer).toBeVisible();
    await expect(composer).toBeInViewport();
    const layout = await readAgentLayout(page);
    expect(layout.panelTop).toBe(0);
    expect(layout.panelLeft).toBe(0);
    expect(layout.panelWidth).toBe(layout.viewportWidth);
    expect(layout.panelHeight).toBe(layout.viewportHeight);
    expect(layout.composerBottom).toBeLessThanOrEqual(layout.viewportHeight);

    await page.getByRole("button", { name: "Закрыть агента" }).click();
    await expect(panel).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(initialScrollY);
  });

  test("основные экраны не показывают необработанные английские enum", async ({ page }) => {
    const run = await completeRun(page.request, await createRun(page.request));
    const routes = [
      "/",
      "/specifications",
      "/specifications/spec-demo-piping-001",
      "/runs",
      `/runs/${encodeURIComponent(run.id)}`,
      `/reports/${encodeURIComponent(run.id)}`,
      "/agent",
      "/admin/integrations",
    ];

    for (const path of routes) {
      await gotoStable(page, path);
      const visibleText = await page.locator("body").innerText();
      expect(visibleText, `${path}: найден необработанный enum`).not.toMatch(RAW_USER_ENUM_PATTERN);
    }
  });

  test("состояние интеграции обновляется на обзоре без reload", async ({ page }) => {
    await page.goto("/admin/integrations");
    await page.waitForLoadState("networkidle");
    const sapForm = page.getByTestId("integration-sap");
    await sapForm.getByLabel("Состояние").selectOption("UNAVAILABLE");
    await sapForm.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(sapForm.getByRole("status")).toContainText("Настройка сохранена");

    await page
      .getByRole("navigation", { name: "Основная навигация" })
      .getByRole("link", { name: "Обзор", exact: true })
      .click();
    await expect(page).toHaveURL(/\/$/u);
    const sapState = page.getByTestId("dashboard-integration-sap");
    await expect(sapState).toContainText("Недоступно");
  });
});

async function gotoStable(page: Page, path: string): Promise<void> {
  try {
    await page.goto(path, { waitUntil: "domcontentloaded" });
  } catch (error) {
    // A completed background run can refresh the current RSC tree at the same
    // instant as navigation. Chromium reports that harmless supersession as
    // ERR_ABORTED; retry the explicit user navigation once.
    if (!(error instanceof Error) || !error.message.includes("ERR_ABORTED")) throw error;
    await page.goto(path, { waitUntil: "domcontentloaded" });
  }
}

async function readAgentLayout(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>("#mtr-agent-widget");
    const composer = panel?.querySelector<HTMLElement>('[data-testid="agent-input"]');
    const history = panel?.querySelector<HTMLElement>('[aria-live="polite"]');
    if (!panel || !composer || !history) throw new Error("Рабочая область AI-агента не найдена");
    const panelRect = panel.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      windowScrollY: window.scrollY,
      panelTop: Math.round(panelRect.top),
      panelLeft: Math.round(panelRect.left),
      panelWidth: Math.round(panelRect.width),
      panelHeight: Math.round(panelRect.height),
      composerBottom: Math.ceil(composerRect.bottom),
      historyOverflowY: getComputedStyle(history).overflowY,
    };
  });
}

async function loginDemoUser(request: APIRequestContext): Promise<void> {
  await responseJson(
    await request.post("/api/auth/login", {
      data: { login: E2E_DEMO_LOGIN, password: E2E_DEMO_PASSWORD },
    }),
  );
}

async function resetDemoData(request: APIRequestContext): Promise<void> {
  await responseJson(
    await request.post("/api/admin/reset", {
      data: { confirmation: "RESET_DEMO_DATA" },
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
  const deadline = Date.now() + RUN_COMPLETION_TIMEOUT_MS;
  let run = initial;
  while (!TERMINAL_RUN_STATUSES.has(run.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    run = await responseJson<RunView>(
      await request.get(`/api/scenario-runs/${encodeURIComponent(run.id)}`),
    );
  }
  expect(run.status).toBe("COMPLETED");
  return run;
}

async function responseJson<T = unknown>(response: APIResponse): Promise<T> {
  const text = await response.text();
  expect(response.ok(), `${response.status()} ${response.url()}\n${text}`).toBe(true);
  return JSON.parse(text) as T;
}
