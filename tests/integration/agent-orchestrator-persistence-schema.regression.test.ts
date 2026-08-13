import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { getTableName, sql } from "drizzle-orm";

import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import {
  agentActionProposals,
  agentCases,
  agentEventInbox,
  agentEvidenceFacts,
  agentMetricEvents,
  agentPlanExecutions,
  agentProactiveInsights,
  agentTasks,
  materialMovements,
} from "@/adapters/persistence/schema";

const REQUIRED_TABLES = [
  "agent_cases",
  "agent_evidence_facts",
  "agent_plan_executions",
  "agent_tasks",
  "agent_action_proposals",
  "agent_event_inbox",
  "agent_proactive_insights",
  "agent_metric_events",
  "material_movements",
] as const;

describe.sequential("orchestrator durable persistence migration 0006", () => {
  beforeEach(async () => {
    await closeDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("keeps occupied product and RBAC migrations byte-for-byte unchanged", async () => {
    await expect(sha256("drizzle/0004_product_iteration.sql")).resolves.toBe(
      "d9c6abab9b0f272e412b9a8f52b5d89959e0614e3ce9eb6fc17ff84daf7c01c8",
    );
    await expect(sha256("drizzle/0005_scoped_rbac.sql")).resolves.toBe(
      "d1fd10b4f0e8da824b1462f838761ab035c96226a2ea92a9c85f87b3629fee32",
    );
  });

  it("exports every typed table without creating a competing review decision model", async () => {
    expect(
      [
        agentCases,
        agentEvidenceFacts,
        agentPlanExecutions,
        agentTasks,
        agentActionProposals,
        agentEventInbox,
        agentProactiveInsights,
        agentMetricEvents,
        materialMovements,
      ].map(getTableName),
    ).toEqual(REQUIRED_TABLES);

    const migration = await readFile("drizzle/0006_mtr_agent_orchestrator.sql", "utf8");
    for (const table of REQUIRED_TABLES) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
    expect(migration).not.toMatch(/CREATE TABLE[^;]+(?:review_tasks|agent_review_decisions)/iu);
    expect(migration).not.toMatch(
      /CREATE TABLE(?: IF NOT EXISTS)? "analysis_review_decisions"/u,
    );
    expect(migration).toContain(
      '"review_decision_id" text REFERENCES "analysis_review_decisions"("id")',
    );
  });

  it("registers 0006 and a complete snapshot after the occupied migrations", async () => {
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.at(-1)).toEqual(
      expect.objectContaining({ idx: 6, tag: "0006_mtr_agent_orchestrator" }),
    );
    expect(journal.entries.filter((entry) => entry.idx === 6)).toHaveLength(1);

    const snapshot = JSON.parse(
      await readFile("drizzle/meta/0006_snapshot.json", "utf8"),
    ) as { tables: Record<string, unknown> };
    for (const table of REQUIRED_TABLES) {
      expect(snapshot.tables).toHaveProperty(`public.${table}`);
    }
  });

  it("applies 0006 to a clean database with scope, retention and project foreign keys", async () => {
    const database = await getDatabase();
    const tableRows = rows(
      await database.execute(sql`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name in (${sql.join(REQUIRED_TABLES.map((name) => sql`${name}`), sql`, `)})
        order by table_name
      `),
    );
    expect(tableRows.map((row) => row.table_name).sort()).toEqual([...REQUIRED_TABLES].sort());

    const scopedColumns = rows(
      await database.execute(sql`
        select table_name, column_name, is_nullable
        from information_schema.columns
        where table_schema = 'public'
          and table_name in (${sql.join(REQUIRED_TABLES.map((name) => sql`${name}`), sql`, `)})
          and column_name in (
            'tenant_id',
            'project_id',
            'authorization_version',
            'role_assignment_snapshot',
            'retention_until'
          )
      `),
    );
    for (const table of REQUIRED_TABLES) {
      expect(scopedColumns).toContainEqual(
        expect.objectContaining({ table_name: table, column_name: "tenant_id", is_nullable: "NO" }),
      );
      expect(scopedColumns).toContainEqual(
        expect.objectContaining({ table_name: table, column_name: "project_id" }),
      );
      expect(scopedColumns).toContainEqual(
        expect.objectContaining({ table_name: table, column_name: "authorization_version" }),
      );
      expect(scopedColumns).toContainEqual(
        expect.objectContaining({
          table_name: table,
          column_name: "role_assignment_snapshot",
          is_nullable: "NO",
        }),
      );
      expect(scopedColumns).toContainEqual(
        expect.objectContaining({ table_name: table, column_name: "retention_until", is_nullable: "NO" }),
      );
    }

    const projectForeignKeys = rows(
      await database.execute(sql`
        select tc.table_name
        from information_schema.table_constraints tc
        join information_schema.constraint_column_usage ccu
          on ccu.constraint_schema = tc.constraint_schema and ccu.constraint_name = tc.constraint_name
        where tc.table_schema = 'public'
          and tc.constraint_type = 'FOREIGN KEY'
          and tc.table_name in (${sql.join(REQUIRED_TABLES.map((name) => sql`${name}`), sql`, `)})
          and ccu.table_name = 'projects'
          and ccu.column_name = 'id'
      `),
    );
    expect(new Set(projectForeignKeys.map((row) => String(row.table_name)))).toEqual(
      new Set(REQUIRED_TABLES),
    );

    const movementSourceForeignKeys = rows(
      await database.execute(sql`
        select tc.table_name
        from information_schema.table_constraints tc
        join information_schema.constraint_column_usage ccu
          on ccu.constraint_schema = tc.constraint_schema and ccu.constraint_name = tc.constraint_name
        where tc.table_schema = 'public'
          and tc.constraint_type = 'FOREIGN KEY'
          and tc.table_name = 'material_movements'
          and ccu.table_name = 'source_scopes'
          and ccu.column_name = 'id'
      `),
    );
    expect(movementSourceForeignKeys).toHaveLength(1);
  });

  it("enforces project isolation, event idempotency, retention and movement signs", async () => {
    const database = await getDatabase();
    const baseCase: typeof agentCases.$inferInsert = {
      id: "case-durable-1",
      tenantId: "tenant-demo-001",
      projectId: "demo-project-001",
      ownerUserId: "demo-user-001",
      status: "DRAFT",
      title: "Синтетический долговечный кейс",
      contextSnapshot: {},
      authorizationVersion: 1,
      roleAssignmentSnapshot: ["assignment-demo-analyst"],
      createdByUserId: "demo-user-001",
      createdAt: "2026-08-13T12:00:00.000Z",
      updatedAt: "2026-08-13T12:00:00.000Z",
      retentionUntil: "2027-08-13T12:00:00.000Z",
    };
    await expect(database.insert(agentCases).values(baseCase)).resolves.toBeDefined();
    await expect(
      database.insert(agentCases).values({
        ...baseCase,
        id: "case-closed-project",
        projectId: "project-not-visible",
      }),
    ).rejects.toThrow();
    await expect(
      database.insert(agentCases).values({
        ...baseCase,
        id: "case-short-retention",
        retentionUntil: "2027-08-13T11:59:59.000Z",
      }),
    ).rejects.toThrow();

    const inboxEvent: typeof agentEventInbox.$inferInsert = {
      id: "event-inbox-1",
      tenantId: "tenant-demo-001",
      projectId: "demo-project-001",
      sourceSystem: "APPIUS",
      sourceEventId: "source-event-1",
      eventType: "APPIUS_VERSION_PUBLISHED",
      payload: {},
      status: "PENDING",
      idempotencyKey: "appius:source-event-1",
      correlationId: "correlation-durable-1",
      createdAt: "2026-08-13T12:00:00.000Z",
      updatedAt: "2026-08-13T12:00:00.000Z",
      retentionUntil: "2027-08-13T12:00:00.000Z",
    };
    await expect(database.insert(agentEventInbox).values(inboxEvent)).resolves.toBeDefined();
    await expect(
      database.insert(agentEventInbox).values({ ...inboxEvent, id: "event-inbox-replay" }),
    ).rejects.toThrow();

    await expect(
      database.insert(materialMovements).values({
        id: "movement-invalid-sign",
        tenantId: "tenant-demo-001",
        projectId: "demo-project-001",
        sourceScopeId: "demo-sap-001",
        materialCode: "SAP-DEMO-0001",
        plant: "PLANT-DEMO-01",
        storageLocation: "WAREHOUSE-DEMO-01",
        movementType: "CONSUMPTION",
        quantity: "-1",
        unit: "шт.",
        occurredAt: "2026-08-13T10:00:00.000Z",
        sourceDocumentId: "DOC-DEMO-001",
        snapshotVersion: "SAP-SNAPSHOT-DEMO-001",
        idempotencyKey: "movement:invalid-sign",
        ingestedAt: "2026-08-13T12:00:00.000Z",
        retentionUntil: "2027-08-13T12:00:00.000Z",
      }),
    ).rejects.toThrow();
  });
});

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function rows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) {
    return result.rows as Array<Record<string, unknown>>;
  }
  return [];
}
