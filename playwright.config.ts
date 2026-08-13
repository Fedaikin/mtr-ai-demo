import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 3100);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
// Remote/production runs include database reset and a server-driven scenario
// whose own polling contract allows up to 90 seconds.
const usesRemoteOrProductionServer = Boolean(process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: usesRemoteOrProductionServer ? 120_000 : 30_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL,
    extraHTTPHeaders: protectionBypass
      ? { "x-vercel-protection-bypass": protectionBypass }
      : undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `pnpm dev --hostname 127.0.0.1 --port ${port}`,
        url: baseURL,
        env: {
          ...process.env,
          DATABASE_URL: "",
          BLOB_READ_WRITE_TOKEN: "",
          PGLITE_DATA_DIR: "memory://",
          APP_MODE: "demo",
          LLM_PROVIDER: "mock",
          MTR_AGENT_ORCHESTRATOR_ENABLED: "true",
          MTR_AGENT_ACTIONS_ENABLED: "true",
          // Public local-test hash for MtrLocalTestOnly!; remote E2E must pass E2E_DEMO_PASSWORD.
          DEMO_PASSWORD_HASH: "scrypt$16384$8$1$5Qr53Li_UbDOnhJzIumUzw$OnJc6NYv7o1rF5xkdJKUCPb_QbSc9Yeuc-GaCB_KVuABn4SxmUKk2qYt0S3tNsUtAOQPHhIIkyVKn3l-leakrg",
        },
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "chromium-mobile", use: { ...devices["iPhone 13"] } },
  ],
});
