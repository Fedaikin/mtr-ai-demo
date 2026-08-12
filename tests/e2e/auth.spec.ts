import { expect, test } from "@playwright/test";

const DEMO_LOGIN = process.env.E2E_DEMO_LOGIN ?? "demo";
const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "Demo2026!";

const PROTECTED_API_PATHS = [
  "/api/scenario-runs",
  "/api/agent/threads",
  "/api/admin/audit",
] as const;

const PROTECTED_PAGE_PATHS = [
  "/",
  "/specifications",
  "/runs",
  "/agent",
  "/admin/scenarios",
] as const;

test("анонимный пользователь перенаправляется на вход, а API возвращают 401", async ({ page }) => {
  for (const path of PROTECTED_PAGE_PATHS) {
    const response = await page.request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(307);
    expect(response.headers().location, path).toContain("/login?next=");
  }

  for (const path of PROTECTED_API_PATHS) {
    const response = await page.request.get(path);
    expect(response.status(), path).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
  }

  await page.goto("/runs?source=audit");
  await expect(page).toHaveURL(/\/login\?next=%2Fruns%3Fsource%3Daudit$/u);
  await expect(page.getByRole("heading", { name: "Вход в анализ МТР" })).toBeVisible();
  await expect(page.getByText("Данные для входа", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Демо-пользователь 1", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Demo2026!", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Логин")).toHaveValue("");
  await expect(page.getByLabel("Пароль")).toHaveValue("");
});

test("вход сохраняется после обновления, показывает пользователя и завершается выходом", async ({ page }) => {
  await page.goto("/login?next=%2Fagent");
  await page.getByLabel("Логин").fill(DEMO_LOGIN);
  await page.getByLabel("Пароль").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();

  await expect(page).toHaveURL(/\/agent$/u);
  await expect(page.locator("header").getByText("Демо-пользователь 1", { exact: true })).toBeVisible();
  expect((await page.request.get("/api/scenario-runs")).status()).toBe(200);

  await page.reload();
  await expect(page).toHaveURL(/\/agent$/u);
  await expect(page.locator("header").getByText("Демо-пользователь 1", { exact: true })).toBeVisible();

  await page.goto("/");
  const userCard = page.getByText("Данные пользователя", { exact: true }).locator("..");
  await expect(userCard).toContainText("Демо-пользователь 1");
  await expect(userCard).toContainText("Пользователь · Администратор");
  await expect(userCard).toContainText("Спецификации");
  await expect(userCard).toContainText("Запуски");
  await expect(userCard).toContainText("Последний запуск");
  await expect(userCard).toContainText("Последний отчёт");

  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await expect(page.getByRole("heading", { name: "Вход в анализ МТР" })).toBeVisible();
  expect((await page.request.get("/api/scenario-runs")).status()).toBe(401);

  await page.goto("/agent");
  await expect(page).toHaveURL(/\/login\?next=%2Fagent$/u);
});

test("защищённые retry и admin PATCH принимают только доверенный browser origin", async (
  { request },
  testInfo,
) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "Проверка HTTP-контракта не зависит от viewport");

  const loginResponse = await request.post("/api/auth/login", {
    data: { login: DEMO_LOGIN, password: DEMO_PASSWORD },
  });
  expect(loginResponse.status()).toBe(200);
  const applicationOrigin = new URL(loginResponse.url()).origin;

  const integrationPayload = {
    system: "SAP",
    state: "AVAILABLE",
    delayMs: 0,
    safeMessage: "Оперативный контур доступен",
  };
  const crossOriginPatch = await request.patch("/api/admin/integrations", {
    headers: { Origin: "https://attacker.example" },
    data: integrationPayload,
  });
  await expectInvalidOrigin(crossOriginPatch);

  expect(
    (
      await request.patch("/api/admin/integrations", {
        headers: { Origin: applicationOrigin },
        data: integrationPayload,
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.patch("/api/admin/integrations", {
        data: integrationPayload,
      })
    ).status(),
  ).toBe(200);

  const original = await request.post("/api/scenario-runs", {
    data: {
      scenarioId: "scenario-full-analysis",
      specificationId: "ALL_CURRENT_SPECIFICATIONS",
      mode: "NORMAL",
      seed: "BASE",
    },
  });
  expect(original.status()).toBe(201);
  const originalRun = (await original.json()) as { id: string };
  const retryPath = `/api/scenario-runs/${encodeURIComponent(originalRun.id)}/retry`;

  await expectInvalidOrigin(
    await request.post(retryPath, {
      headers: { Origin: "https://attacker.example" },
    }),
  );
  expect(
    (
      await request.post(retryPath, {
        headers: { Origin: applicationOrigin },
      })
    ).status(),
  ).toBe(201);
  expect((await request.post(retryPath)).status()).toBe(201);

  expect(
    (
      await request.get("/api/admin/integrations", {
        headers: { Origin: "https://attacker.example" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.fetch("/api/admin/integrations", {
        method: "OPTIONS",
        headers: { Origin: "https://attacker.example" },
      })
    ).status(),
  ).toBe(204);
});

async function expectInvalidOrigin(response: {
  status(): number;
  json(): Promise<unknown>;
}): Promise<void> {
  expect(response.status()).toBe(403);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "INVALID_ORIGIN", message: "Источник запроса не разрешён." },
  });
}
