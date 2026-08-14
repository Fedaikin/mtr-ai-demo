import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("0010 responsibility decision state migration", () => {
  it("не изменяет занятые universal/RBAC migrations", async () => {
    await expect(sha256("drizzle/0008_universal_chat.sql")).resolves.toBe(
      "28fcd66c09d47c121e9097cab1d67c573174d3a90994ac7a8a8173a8c597d289",
    );
    await expect(sha256("drizzle/0009_chat_rbac_actions.sql")).resolves.toBe(
      "7ce293efe890695767063d0e7924ce4f85ef70511c2a5a5f19639a8c8c0ddf21",
    );
  });

  it("делает новый decision state additive и сохраняет старую строку byte-for-byte", async () => {
    const database = new PGlite();
    try {
      await database.exec(`
        create table position_analysis_results (
          id text primary key,
          responsibility text not null,
          responsibility_confidence numeric(5,4) not null,
          responsibility_citation jsonb not null
        );
        insert into position_analysis_results values
          ('legacy-result', 'CONTRACTOR', 0.4500, '{"clauseId":"UNRESOLVED"}'::jsonb);
      `);
      const before = await database.query("select row_to_json(row) as value from position_analysis_results row");
      const migration = await readFile("drizzle/0010_responsibility_decision_state.sql", "utf8");
      for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) {
        await database.exec(statement);
      }
      const after = await database.query("select row_to_json(row) as value from position_analysis_results row");

      expect(after.rows[0]).toEqual({
        value: {
          ...(before.rows[0] as { value: Record<string, unknown> }).value,
          responsibility_decision_state: null,
        },
      });
    } finally {
      await database.close();
    }
  });
});

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
