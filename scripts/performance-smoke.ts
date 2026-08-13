import { chromium, type Page } from "@playwright/test";

const baseUrl = (process.env.PERF_BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/u, "");
const iterations = positiveInteger(process.env.PERF_ITERATIONS, 20);
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
const demoLogin = process.env.E2E_DEMO_LOGIN ?? "demo";
const demoPassword = process.env.PERF_DEMO_PASSWORD ?? process.env.E2E_DEMO_PASSWORD;

const routes = [
  "/",
  "/specifications",
  "/runs",
  "/agent",
  "/admin/scenarios",
  "/admin/integrations",
] as const;

interface TransitionMetric {
  route: string;
  visualReactionMs: number;
  readyMs: number;
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      extraHTTPHeaders: bypass ? { "x-vercel-protection-bypass": bypass } : undefined,
    });
    const page = await context.newPage();
    await login(page);
    await installLongTaskObserver(page);

    // Warm every main route once. The measured sample excludes cold starts.
    for (const route of routes) await transition(page, route);
    await page.evaluate(() => {
      const state = window as typeof window & { __mtrLongTasks?: number[] };
      state.__mtrLongTasks = [];
    });

    const samples: TransitionMetric[] = [];
    for (let index = 0; index < iterations; index += 1) {
      samples.push(await transition(page, routes[index % routes.length]));
    }

    const ready = samples.map((sample) => sample.readyMs);
    const visual = samples.map((sample) => sample.visualReactionMs);
    const longTasks = await page.evaluate(() => {
      const state = window as typeof window & { __mtrLongTasks?: number[] };
      return state.__mtrLongTasks ?? [];
    });
    process.stdout.write(`${JSON.stringify({
      baseUrl,
      iterations,
      coldStartExcluded: true,
      routes,
      readyMs: summarize(ready),
      visualReactionMs: summarize(visual),
      longTasks: {
        count: longTasks.length,
        maxMs: round(Math.max(0, ...longTasks)),
        over200Ms: longTasks.filter((duration) => duration > 200).length,
      },
      samples,
    }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

async function installLongTaskObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as typeof window & { __mtrLongTasks?: number[] };
    state.__mtrLongTasks = [];
    if (!("PerformanceObserver" in window)) return;
    const observer = new PerformanceObserver((list) => {
      state.__mtrLongTasks?.push(...list.getEntries().map((entry) => entry.duration));
    });
    observer.observe({ type: "longtask", buffered: true });
  });
}

async function login(page: Page): Promise<void> {
  if (!demoPassword) {
    throw new Error("PERF_DEMO_PASSWORD or E2E_DEMO_PASSWORD is required.");
  }
  const response = await page.request.post(`${baseUrl}/api/auth/login`, {
    data: { login: demoLogin, password: demoPassword },
  });
  if (!response.ok()) {
    throw new Error(`Performance login failed with HTTP ${response.status()}.`);
  }
  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
}

async function transition(page: Page, route: string): Promise<TransitionMetric> {
  if (new URL(page.url()).pathname === route) return { route, visualReactionMs: 0, readyMs: 0 };
  const link = page.locator(`nav a[href="${route}"]`).first();
  await link.waitFor({ state: "visible" });
  await page.evaluate(() => {
    const target = document.querySelector("main");
    const startedAt = performance.now();
    const state = window as typeof window & { __mtrVisualReaction?: Promise<number> };
    state.__mtrVisualReaction = new Promise<number>((resolve) => {
      if (!target) {
        resolve(0);
        return;
      }
      const observer = new MutationObserver(() => {
        observer.disconnect();
        resolve(performance.now() - startedAt);
      });
      observer.observe(target, { attributes: true, childList: true, subtree: true });
      window.setTimeout(() => {
        observer.disconnect();
        resolve(performance.now() - startedAt);
      }, 1_500);
    });
  });

  const startedAt = performance.now();
  await link.click();
  await page.waitForURL((url) => url.pathname === route);
  await page.waitForFunction(
    (targetRoute) =>
      window.location.pathname === targetRoute &&
      !document.querySelector('[aria-label="Загрузка раздела"]') &&
      Boolean(document.querySelector(`nav a[href="${targetRoute}"][aria-current="page"]`)),
    route,
  );
  const readyMs = performance.now() - startedAt;
  const visualReactionMs = await page.evaluate(async () => {
    const state = window as typeof window & { __mtrVisualReaction?: Promise<number> };
    return state.__mtrVisualReaction ? state.__mtrVisualReaction : 0;
  });
  return {
    route,
    visualReactionMs: round(visualReactionMs),
    readyMs: round(readyMs),
  };
}

function summarize(values: number[]) {
  return {
    min: round(Math.min(...values)),
    p50: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    p95: percentile(values, 0.95),
    max: round(Math.max(...values)),
  };
}

function percentile(values: number[], quantile: number): number {
  const sorted = values.toSorted((left, right) => left - right);
  return round(sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0);
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

void main();
