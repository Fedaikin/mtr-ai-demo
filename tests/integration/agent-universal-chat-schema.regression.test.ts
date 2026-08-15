import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { getTableName, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, test } from "vitest";

import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import {
  businessProjectDeadlines,
  businessProjectPositions,
  businessProjectSpecifications,
  businessProjects,
  operationalMaterialViews,
  projectMaterialAllocations,
  specificationIntakeItems,
} from "@/adapters/persistence/schema";

const TABLES = [
  "business_projects",
  "business_project_deadlines",
  "business_project_specifications",
  "operational_material_views",
  "business_project_positions",
  "specification_intake_items",
  "project_material_allocations",
] as const;

const IMMUTABLE_MIGRATIONS = {
  "drizzle/0000_majestic_gorgon.sql": "b54619b5a2b51d9b96ee0827204132dc9c103479109db058ed41ed24dd538841",
  "drizzle/0001_dazzling_the_hand.sql": "5eff62c04781980b62bbbfd60c50b6f0a751050d13fc4e264cf924a1cb5b2910",
  "drizzle/0002_married_payback.sql": "4e574a0b8e91cd302fe8a15618c675bd3267b236069e677ed58c6760a05c1c61",
  "drizzle/0003_industrial_catalogue.sql": "d727a74533028bbfca122bb4c9d32a8ae3f270d16e7026b15f05fdbc02d4ff6b",
  "drizzle/0004_product_iteration.sql": "d9c6abab9b0f272e412b9a8f52b5d89959e0614e3ce9eb6fc17ff84daf7c01c8",
  "drizzle/0005_scoped_rbac.sql": "d1fd10b4f0e8da824b1462f838761ab035c96226a2ea92a9c85f87b3629fee32",
  "drizzle/0006_mtr_agent_orchestrator.sql": "dd4c725106e4f07059c58c1944457586193ef1187d169b60d14d36b6f5327acd",
  "drizzle/0007_mtr_agent_learning.sql": "74c3a7c4a74e5a8295ddec0a3047c84978aead03d52eadca2ab60a8bf08ffb85",
} as const;

describe.sequential("additive universal chat migration 0008", () => {
  beforeEach(async () => closeDatabase());
  afterAll(async () => closeDatabase());

  test("keeps every existing migration byte-for-byte immutable", async () => {
    for (const [path, expected] of Object.entries(IMMUTABLE_MIGRATIONS)) {
      await expect(sha256(path)).resolves.toBe(expected);
    }
  });

  test("exports and registers only the additive universal-chat tables", async () => {
    expect([
      businessProjects,
      businessProjectDeadlines,
      businessProjectSpecifications,
      operationalMaterialViews,
      businessProjectPositions,
      specificationIntakeItems,
      projectMaterialAllocations,
    ].map(getTableName)).toEqual(TABLES);

    const migration = await readFile("drizzle/0008_universal_chat.sql", "utf8");
    for (const table of TABLES) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
    expect(migration).not.toMatch(/(?:ALTER|DROP|TRUNCATE) TABLE "(?:users|roles|permissions|role_assignments)"/u);

    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.filter((entry) => entry.idx === 8)).toEqual([
      expect.objectContaining({ idx: 8, tag: "0008_universal_chat" }),
    ]);
  });

  test("applies tenant/project/catalog/source relationships and domain checks", async () => {
    const database = await getDatabase();
    const tableRows = rows(await database.execute(sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (${sql.join(TABLES.map((name) => sql`${name}`), sql`, `)})
      order by table_name
    `));
    expect(tableRows.map((row) => row.table_name).sort()).toEqual([...TABLES].sort());

    const foreignKeys = rows(await database.execute(sql`
      select tc.table_name, ccu.table_name as foreign_table
      from information_schema.table_constraints tc
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_schema = tc.constraint_schema
       and ccu.constraint_name = tc.constraint_name
      where tc.table_schema = 'public'
        and tc.constraint_type = 'FOREIGN KEY'
        and tc.table_name in (${sql.join(TABLES.map((name) => sql`${name}`), sql`, `)})
    `));
    expect(foreignKeys).toContainEqual(expect.objectContaining({
      table_name: "business_projects",
      foreign_table: "projects",
    }));
    expect(foreignKeys).toContainEqual(expect.objectContaining({
      table_name: "operational_material_views",
      foreign_table: "catalog_items",
    }));
    expect(foreignKeys).toContainEqual(expect.objectContaining({
      table_name: "operational_material_views",
      foreign_table: "source_scopes",
    }));

    await expect(database.insert(businessProjects).values({
      id: "business-project-invalid-status",
      tenantId: "demo-tenant-001",
      accessProjectId: "demo-project-001",
      code: "INVALID",
      name: "Некорректный статус",
      aliases: [],
      externalProjectCodes: [],
      status: "UNKNOWN",
      phase: "DESIGN",
      needDate: "2026-08-20T06:00:00.000Z",
      datasetVersion: "1.0.0-DEMO",
      createdBy: "demo-user-001",
    })).rejects.toThrow();
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
