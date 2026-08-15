import { sql } from "drizzle-orm";

import { initializeDatabase } from "@/adapters/persistence/bootstrap";
import { getDatabase, type Database } from "@/adapters/persistence/db";
import { applyDatabaseCounterfactualOverlay } from "@/evals/fastgate/official/database-overlay";

describe.sequential("official FastGate semantic clock", () => {
  it("pins every material snapshot and reliability observation before independent checksums", async () => {
    const previousOfficial = process.env.FASTGATE_OFFICIAL;
    const previousMode = process.env.APP_MODE;
    const previousUniversal = process.env.MTR_AGENT_UNIVERSAL_CHAT_ENABLED;
    process.env.FASTGATE_OFFICIAL = "1";
    process.env.APP_MODE = "test";
    process.env.MTR_AGENT_UNIVERSAL_CHAT_ENABLED = "true";
    try {
      await initializeDatabase();
      const database = await getDatabase();
      const rollback = new Error("ROLLBACK_FASTGATE_CLOCK_TEST");

      await expect(database.transaction(async (tx) => {
        await applyDatabaseCounterfactualOverlay(tx as unknown as Database, {
          seed: "a".repeat(64),
          scenarioInstant: "2026-08-14T12:00:00.000Z",
        });
        const [row] = (await tx.execute(sql`
          select count(*)::int as total,
            count(*) filter (where stock->>'snapshotAt' = '2026-08-14T12:00:00.000Z')::int as stable_stock,
            count(*) filter (where reliability->>'observedAt' = '2026-08-14T12:00:00.000Z')::int as stable_reliability
          from operational_material_views
        `)).rows as Array<{ total: number; stable_stock: number; stable_reliability: number }>;
        expect(row.total).toBe(4_800);
        expect(row.stable_stock).toBe(row.total);
        expect(row.stable_reliability).toBe(row.total);
        throw rollback;
      })).rejects.toBe(rollback);
    } finally {
      if (previousOfficial === undefined) delete process.env.FASTGATE_OFFICIAL;
      else process.env.FASTGATE_OFFICIAL = previousOfficial;
      if (previousMode === undefined) delete process.env.APP_MODE;
      else process.env.APP_MODE = previousMode;
      if (previousUniversal === undefined) delete process.env.MTR_AGENT_UNIVERSAL_CHAT_ENABLED;
      else process.env.MTR_AGENT_UNIVERSAL_CHAT_ENABLED = previousUniversal;
    }
  }, 60_000);
});
