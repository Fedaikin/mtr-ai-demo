import "server-only";

import { sql } from "drizzle-orm";

import { initializeDatabase } from "@/adapters/persistence/bootstrap";
import { getDatabase } from "@/adapters/persistence/db";
import { getRepository } from "@/adapters/persistence/repository";
import { ScenarioService } from "@/application/scenario-service";
import { drainScenarioRun } from "@/application/scenario-runner";
import { DEMO_USER_ID } from "@/domain/models";

const fastGateRunIdPattern = /^run-fastgate-[a-z0-9][a-z0-9-]{0,160}$/u;

/** Creates only the sanctioned local completed run required by FG-08. */
export async function prepareLocalFastGateFixture(desiredRunId?: string): Promise<string> {
  if (process.env.DATABASE_URL?.trim()) throw new Error("FASTGATE_LOCAL_FIXTURE_REMOTE_DATABASE_FORBIDDEN");
  if (desiredRunId && !fastGateRunIdPattern.test(desiredRunId)) {
    throw new Error("FASTGATE_FIXTURE_RUN_ID_INVALID");
  }
  await initializeDatabase();
  const database = await getDatabase({ migrations: "skip" });
  const existing = extractRows(desiredRunId
    ? await database.execute(sql`
        select id, status from scenario_runs where user_id=${DEMO_USER_ID} and id=${desiredRunId} limit 1
      `)
    : await database.execute(sql`
        select id, status from scenario_runs where user_id=${DEMO_USER_ID} and status='COMPLETED'
        order by completed_at desc nulls last, id desc limit 1
      `))[0];
  if (existing?.id && existing.status !== "COMPLETED") {
    throw new Error("FASTGATE_FIXTURE_RUN_ID_COLLISION");
  }
  if (existing?.id) return String(existing.id);

  const service = new ScenarioService(await getRepository());
  const run = await service.createRun(DEMO_USER_ID, {
    scenarioId: "scenario-full-analysis",
    specificationId: "ALL_CURRENT_SPECIFICATIONS",
    mode: "NORMAL",
    seed: "BASE",
  });
  const fixtureRunId = desiredRunId ?? run.id;
  if (desiredRunId) {
    const renamed = extractRows(await database.execute(sql`
      update scenario_runs
      set id=${desiredRunId}, updated_at=clock_timestamp()
      where id=${run.id} and user_id=${DEMO_USER_ID}
      returning id
    `))[0];
    if (renamed?.id !== desiredRunId) throw new Error("FASTGATE_FIXTURE_RUN_ID_RENAME_FAILED");
    await database.execute(sql`
      update audit_logs
      set entity_id=${desiredRunId}
      where user_id=${DEMO_USER_ID}
        and entity_type='SCENARIO_RUN'
        and entity_id=${run.id}
        and action='SCENARIO_RUN_CREATED'
    `);
  }
  const completed = await drainScenarioRun(DEMO_USER_ID, fixtureRunId);
  if (completed.run.status !== "COMPLETED") throw new Error(`FASTGATE_LOCAL_FIXTURE_${completed.stopReason}`);
  return completed.run.id;
}

function extractRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  return value && typeof value === "object" && "rows" in value && Array.isArray(value.rows)
    ? value.rows as Array<Record<string, unknown>>
    : [];
}
