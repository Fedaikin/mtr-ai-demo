import { expect, test } from "@playwright/test";

import { E2E_DEMO_LOGIN, E2E_DEMO_PASSWORD } from "./demo-auth";

test.use({ viewport: { width: 1440, height: 1000 } });

test("ACC-AIUX-005: desktop прокручивает историю чата, а не страницу", async ({ page }) => {
  const login = await page.request.post("/api/auth/login", {
    data: { login: E2E_DEMO_LOGIN, password: E2E_DEMO_PASSWORD },
  });
  expect(login.ok()).toBe(true);

  await page.goto("/agent");
  await page.getByRole("tab", { name: "AI-агент" }).click();
  await expect(page.getByTestId("agent-input")).toBeInViewport();

  const geometry = await page.evaluate(() => {
    const history = document.querySelector<HTMLElement>('[aria-live="polite"]');
    if (!history) throw new Error("История чата не найдена");
    return {
      bodyHeight: document.body.scrollHeight,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      historyOverflowY: getComputedStyle(history).overflowY,
    };
  });

  expect(geometry.bodyHeight).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.documentHeight).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.historyOverflowY).toMatch(/auto|scroll/u);
});
