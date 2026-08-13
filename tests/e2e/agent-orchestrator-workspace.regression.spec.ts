import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  const response = await page.request.post("/api/auth/login", {
    data: { login: "demo", password: "Demo2026!" },
  });
  expect(response.ok()).toBe(true);
});

test("desktop: /mtr-analysis содержит единый workspace и выполняет typed command", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "Desktop-компоновка");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/mtr-analysis");

  const workspace = page.getByRole("region", { name: "Рабочее пространство МТР-агента" });
  await expect(workspace).toBeVisible();
  await expect(workspace.getByLabel("Проект МТР-агента")).toBeDisabled();
  await expect(workspace.getByLabel("Спецификация МТР-агента")).toBeVisible();
  await expect(workspace.getByLabel("Позиция МТР-агента")).toBeVisible();
  await expect(workspace.getByLabel("Запуск МТР-агента")).toBeVisible();
  await expect(workspace.getByLabel("Начало периода МТР-агента")).toBeVisible();
  await expect(workspace.getByLabel("Конец периода МТР-агента")).toBeVisible();

  await workspace.scrollIntoViewIfNeeded();
  const chat = workspace.getByRole("region", { name: "Диалог с МТР-аналитиком" });
  const composer = chat.getByTestId("agent-input");
  await expect(composer).toBeVisible();
  const geometry = await chat.evaluate((element) => {
    const history = element.querySelector<HTMLElement>('[aria-live="polite"]');
    const input = element.querySelector<HTMLElement>('[data-testid="agent-input"]');
    if (!history || !input) throw new Error("Рабочая область чата неполна");
    return {
      historyOverflowY: getComputedStyle(history).overflowY,
      inputBottom: Math.ceil(input.getBoundingClientRect().bottom),
      chatBottom: Math.ceil(element.getBoundingClientRect().bottom),
      bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(geometry.historyOverflowY).toMatch(/auto|scroll/u);
  expect(geometry.inputBottom).toBeLessThanOrEqual(geometry.chatBottom);
  expect(geometry.bodyOverflow).toBe(0);

  await chat.getByRole("button", { name: "Остатки", exact: true }).click();
  await expect(chat.getByTestId("agent-command-result")).toBeVisible({ timeout: 7_000 });
  await expect(chat.getByTestId("agent-command-result")).toContainText("Остатки");
  await expect(page.locator("body")).not.toContainText(/\b(?:SUMMARY|PARTIAL|Evidence)\b/u);
  await page.screenshot({ path: "/tmp/mtr-agent-orchestrator-workspace-desktop.png", fullPage: true });
});

test("mobile: workspace не создаёт горизонтальный overflow, composer доступен", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile-компоновка");
  await page.goto("/mtr-analysis");

  const workspace = page.getByRole("region", { name: "Рабочее пространство МТР-агента" });
  await workspace.scrollIntoViewIfNeeded();
  await expect(workspace.getByTestId("agent-input")).toBeVisible();
  await expect(workspace.getByRole("button", { name: /Кейсы/u })).toBeVisible();
  await expect(workspace.getByRole("button", { name: /Действия/u })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await page.screenshot({ path: "/tmp/mtr-agent-orchestrator-workspace-mobile.png", fullPage: true });
});
