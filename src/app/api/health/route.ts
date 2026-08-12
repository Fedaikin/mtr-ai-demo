import { NextResponse } from "next/server";

import { getSeedCounts } from "@/adapters/persistence/bootstrap";
import { getDatabase, getDatabaseKind } from "@/adapters/persistence/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEALTH_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
} as const;

export async function GET(request: Request) {
  const check = new URL(request.url).searchParams.get("check") ?? "ready";
  if (check !== "live" && check !== "ready") {
    return NextResponse.json(
      {
        status: "invalid_request",
        error: { code: "INVALID_HEALTH_CHECK", message: "Параметр check: live или ready." },
      },
      { status: 400, headers: HEALTH_HEADERS },
    );
  }

  if (check === "live") {
    return NextResponse.json(
      { status: "ok", check: "liveness", service: "mtr-ai-demo" },
      { headers: HEALTH_HEADERS },
    );
  }

  const startedAt = performance.now();
  try {
    // Readiness is an exact, non-mutating diagnostic. An unavailable schema
    // must surface as 503 instead of turning a probe into a migration job.
    const database = await getDatabase({ migrations: "skip" });
    const counts = await getSeedCounts(database);
    const seedReady =
      counts.users === 1 &&
      counts.canonicalPositions === 24 &&
      counts.sapMaterials === 30 &&
      counts.sapBalances === 30;
    const status = seedReady ? 200 : 503;

    return NextResponse.json(
      {
        status: seedReady ? "ok" : "not_ready",
        check: "readiness",
        service: "mtr-ai-demo",
        database: { status: "ok", kind: getDatabaseKind() },
        seed: {
          status: seedReady ? "ok" : "mismatch",
          counts: {
            users: counts.users,
            canonicalPositions: counts.canonicalPositions,
            sapMaterials: counts.sapMaterials,
            sapBalances: counts.sapBalances,
          },
        },
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      },
      { status, headers: HEALTH_HEADERS },
    );
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.error("Health readiness check failed", {
      requestId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      {
        status: "unavailable",
        check: "readiness",
        service: "mtr-ai-demo",
        database: { status: "error" },
        requestId,
      },
      { status: 503, headers: HEALTH_HEADERS },
    );
  }
}
