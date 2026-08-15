import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

import { E2E_DEMO_LOGIN, E2E_DEMO_PASSWORD } from "./demo-auth";

test.describe("ACC-FUNC-009 — главный CTA моделирования", () => {
  test.beforeEach(async ({ page }) => {
    await loginDemoUser(page.request);
    await resetDemoData(page.request);
  });

  test("desktop 1440×1000: кнопка запуска полностью видна без прокрутки", async ({
    page,
    isMobile,
  }) => {
    test.skip(Boolean(isMobile), "Проверка геометрии предназначена для desktop-компоновки");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/admin/scenarios");

    const launchButton = page.getByRole("button", { name: "Запустить сценарий", exact: true });
    await expect(launchButton).toBeVisible();
    await expect(launchButton).toBeEnabled();
    await expect(launchButton).toBeInViewport();
    await expect(
      page.getByRole("switch", {
        name: "Сценарий «Недостаточный остаток и составные аналоги»",
      }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    const box = await launchButton.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(1000);
  });

  test("mobile: список остаётся одноколоночным, без overflow, а CTA доступен по имени", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "Проверка предназначена для мобильной компоновки");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/scenarios");

    const scenarioGrid = page.locator('[aria-labelledby="scenario-access-title"] .grid');
    const itemLeftEdges = await scenarioGrid.locator(":scope > div").evaluateAll((items) =>
      items.map((item) => Math.round(item.getBoundingClientRect().left)),
    );
    expect(new Set(itemLeftEdges).size).toBe(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    await expect(page.getByRole("switch")).toHaveCount(5);
    const launchButton = page.getByRole("button", { name: "Запустить сценарий", exact: true });
    await expect(launchButton).toBeAttached();
    await expect(launchButton).toBeEnabled();
    await launchButton.scrollIntoViewIfNeeded();
    await expect(launchButton).toBeInViewport();
  });
});

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

async function responseJson(
  response: Pick<APIResponse, "text" | "ok" | "status" | "url">,
): Promise<unknown> {
  const text = await response.text();
  expect(response.ok(), `${response.status()} ${response.url()}\n${text}`).toBe(true);
  return JSON.parse(text) as unknown;
}
