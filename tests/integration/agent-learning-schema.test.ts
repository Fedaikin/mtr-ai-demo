import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { getTableName, sql } from "drizzle-orm";

import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { agentLearningCandidates } from "@/adapters/persistence/schema";

describe.sequential("agent learning migration 0007", () => {
  beforeEach(async () => closeDatabase());
  afterAll(async () => closeDatabase());

  it("is additive after immutable product, RBAC and orchestrator migrations", async () => {
    await expect(sha256("drizzle/0004_product_iteration.sql")).resolves.toBe(
      "d9c6abab9b0f272e412b9a8f52b5d89959e0614e3ce9eb6fc17ff84daf7c01c8",
    );
    await expect(sha256("drizzle/0005_scoped_rbac.sql")).resolves.toBe(
      "d1fd10b4f0e8da824b1462f838761ab035c96226a2ea92a9c85f87b3629fee32",
    );
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.at(-1)).toEqual({
      idx: 7,
      version: "7",
      when: expect.any(Number),
      tag: "0007_mtr_agent_learning",
      breakpoints: true,
    });
    expect(getTableName(agentLearningCandidates)).toBe("agent_learning_candidates");
    const migration = await readFile("drizzle/0007_mtr_agent_learning.sql", "utf8");
    expect(migration).toContain('CREATE TABLE "agent_learning_candidates"');
    expect(migration).not.toMatch(/(?:ALTER TABLE|INSERT INTO|UPDATE|DELETE FROM) "(?:users|roles|role_assignments|permissions)"/u);
  });

  it("applies scope, owner, message, lifecycle, checksum and retention constraints", async () => {
    const database = await getDatabase();
    const constraints = rows(await database.execute(sql`
      select constraint_name
      from information_schema.table_constraints
      where table_schema = 'public' and table_name = 'agent_learning_candidates'
      order by constraint_name
    `)).map((row) => String(row.constraint_name));
    expect(constraints).toEqual(expect.arrayContaining([
      "agent_learning_candidates_project_id_projects_id_fk",
      "agent_learning_candidates_owner_user_id_users_id_fk",
      "agent_learning_candidates_response_message_id_agent_messages_id",
      "agent_learning_feedback_kind_check",
      "agent_learning_status_check",
      "agent_learning_approval_bundle_check",
      "agent_learning_promotion_check",
      "agent_learning_retention_check",
    ]));
  });
});

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function rows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: Array<Record<string, unknown>> }).rows;
  }
  return [];
}
