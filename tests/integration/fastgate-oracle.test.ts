import { sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { prepareLocalFastGateFixture } from "@/evals/fastgate/local-fixture";
import { buildLocalFastGateOracle } from "@/evals/fastgate/reference-oracle";

describe.sequential("MTR Agent FastGate independent oracle", () => {
  afterAll(async () => closeDatabase());

  it("reads versioned raw rows without production intent/capability services", async () => {
    process.env.MTR_AGENT_UNIVERSAL_CHAT_ENABLED = "true";
    const snapshot = await buildLocalFastGateOracle("a".repeat(40));
    expect(snapshot.environment).toBe("LOCAL_TEST");
    expect(snapshot.projects.length).toBeGreaterThan(1);
    expect(snapshot.specifications).toHaveLength(83);
    expect(snapshot.materials.length).toBeGreaterThan(100);
    expect(snapshot.intakes).toHaveLength(83);
    expect(snapshot.activeProjectIdsBySubject["demo-user-001"]?.length).toBeGreaterThan(1);
    expect(snapshot.accessibleProjectIdsBySubject["demo-user-001"]).toEqual(
      expect.arrayContaining([...(snapshot.activeProjectIdsBySubject["demo-user-001"] ?? [])]),
    );
    expect(snapshot.roleProfiles["demo-viewer-001"]?.permissions).toContain("agent.chat");
    expect(snapshot.roleProfiles["demo-viewer-001"]?.permissions).not.toContain("stock.search");
    expect(snapshot.roleProfiles["demo-analyst-001"]?.permissions).toContain("stock.search");
    expect(snapshot.analoguePairs.some((pair) => (pair.expectedCompatibilityPercent ?? 0) >= 85)).toBe(true);
    expect(snapshot.analoguePairs.some((pair) => (pair.expectedCompatibilityPercent ?? 0) < 85)).toBe(true);
    expect(snapshot.analoguePairs.every((pair) => Number.isFinite(pair.expectedQuantityCoveragePercent))).toBe(true);
    expect(snapshot.lastCompletedRun?.decisions.length).toBe(snapshot.lastCompletedRun?.resultCount);
    expect(snapshot.dataChecksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(snapshot.targetStateChecksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(snapshot.databaseState.checksumSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(snapshot.databaseState.tables.map((table) => table.tableName)).toEqual(expect.arrayContaining([
      "users", "role_assignments", "agent_action_proposals", "audit_logs", "agent_threads",
      "agent_messages", "agent_event_inbox", "agent_cases", "business_projects",
    ]));
    expect(snapshot.actionSafetyState).toEqual([]);
  }, 60_000);

  it("separates accessible project scope from ACTIVE business status", async () => {
    const db = await getDatabase({ migrations: "skip" });
    const [project] = (await db.execute(sql`
      select id, status from business_projects order by id limit 1
    `)).rows as Array<{ id: string; status: string }>;
    if (!project) throw new Error("business project fixture missing");
    try {
      await db.execute(sql`update business_projects set status='ON_HOLD' where id=${project.id}`);
      const snapshot = await buildLocalFastGateOracle("c".repeat(40));
      expect(snapshot.accessibleProjectIdsBySubject["demo-user-001"]).toContain(project.id);
      expect(snapshot.activeProjectIdsBySubject["demo-user-001"]).not.toContain(project.id);
    } finally {
      await db.execute(sql`update business_projects set status=${project.status} where id=${project.id}`);
    }
  });

  it("derives responsibility from raw positions and rules, not persisted analysis results", async () => {
    const expectedRunId = "run-fastgate-oracle-deterministic";
    await prepareLocalFastGateFixture(expectedRunId);
    const before = await buildLocalFastGateOracle("b".repeat(40));
    const run = before.lastCompletedRun;
    const decision = run?.decisions[0];
    if (!run || !decision) throw new Error("completed run fixture missing");
    expect(run.id).toBe(expectedRunId);
    const db = await getDatabase({ migrations: "skip" });
    const stored = (await db.execute(sql`
      select responsibility_decision_state, responsibility, responsibility_citation
      from position_analysis_results
      where run_id=${run.id} and position_id=${decision.positionId}
    `)).rows[0] as Record<string, unknown> | undefined;
    if (!stored) throw new Error("persisted result fixture missing");
    try {
      await db.execute(sql`
        update position_analysis_results
        set responsibility_decision_state='INSUFFICIENT_DATA', responsibility=null, responsibility_citation=null
        where run_id=${run.id} and position_id=${decision.positionId}
      `);
      const after = await buildLocalFastGateOracle("b".repeat(40));
      expect(after.lastCompletedRun?.decisions).toEqual(run.decisions);
      expect(after.lastCompletedRun?.decisions[0]).toEqual(decision);
    } finally {
      await db.execute(sql`
        update position_analysis_results
        set responsibility_decision_state=${stored.responsibility_decision_state},
            responsibility=${stored.responsibility},
            responsibility_citation=${stored.responsibility_citation}
        where run_id=${run.id} and position_id=${decision.positionId}
      `);
    }
  }, 60_000);
});
