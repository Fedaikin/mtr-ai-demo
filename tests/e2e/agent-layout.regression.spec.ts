import { expect, test } from "@playwright/test";

import { E2E_DEMO_LOGIN, E2E_DEMO_PASSWORD } from "./demo-auth";

test.use({ viewport: { width: 1440, height: 1000 } });

test("ACC-AIUX-005: desktop-виджет прокручивает историю внутри МТР Агента", async ({ page }) => {
  const login = await page.request.post("/api/auth/login", {
    data: { login: E2E_DEMO_LOGIN, password: E2E_DEMO_PASSWORD },
  });
  expect(login.ok()).toBe(true);

  await page.goto("/mtr-analysis");
  await page.getByRole("button", { name: "МТР-агент", exact: true }).click();
  const widget = page.getByRole("complementary", { name: "МТР-агент", exact: true });
  await expect(widget).toBeVisible();
  await expect(widget.getByTestId("agent-input")).toBeInViewport();

  const geometry = await widget.evaluate((element) => {
    const history = element.querySelector<HTMLElement>('[aria-live="polite"]');
    if (!history) throw new Error("История чата не найдена");
    const box = element.getBoundingClientRect();
    return {
      position: getComputedStyle(element).position,
      top: box.top,
      bottom: box.bottom,
      viewportHeight: window.innerHeight,
      historyOverflowY: getComputedStyle(history).overflowY,
    };
  });

  expect(geometry.position).toBe("fixed");
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.historyOverflowY).toMatch(/auto|scroll/u);
});
