import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  EXPECTED_BASE_COUNTS,
  getSeedCounts,
  resetDemoDatabase,
} from "@/adapters/persistence/bootstrap";
import { seedIndustrialCatalogue } from "@/adapters/persistence/catalog-bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import {
  EXPECTED_UNIVERSAL_CHAT_COUNTS,
  ensureUniversalChatDataset,
  getUniversalChatCounts,
  seedUniversalChatDataset,
} from "@/adapters/persistence/universal-chat-bootstrap";
import {
  agentThreads,
  auditLogs,
  businessProjectPositions,
  businessProjects,
  operationalMaterialViews,
  specificationIntakeItems,
  users,
} from "@/adapters/persistence/schema";
import { createFixedScenarioClock } from "@/domain/agent/universal-chat/scenario-clock";
import { DEMO_USER_ID } from "@/domain/models";

const CLOCK = createFixedScenarioClock("2026-08-13T09:15:00.000Z");

describe.sequential("additive universal-chat-v1 seed", () => {
  beforeEach(async () => closeDatabase());
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => closeDatabase());

  test("seeds idempotently while preserving users, credentials, golden data and runtime rows", async () => {
    const database = await getDatabase({ migrations: "ensure" });
    await resetDemoDatabase(DEMO_USER_ID, database);
    await seedIndustrialCatalogue(DEMO_USER_ID, database);
    await database.insert(agentThreads).values({
      id: "thread-universal-seed-proof",
      userId: DEMO_USER_ID,
      title: "Проверка сохранности runtime",
      createdBy: DEMO_USER_ID,
    });
    await database.insert(auditLogs).values({
      id: "audit-universal-seed-proof",
      userId: DEMO_USER_ID,
      actorDisplayName: "Демо-пользователь 1",
      action: "UNIVERSAL_CHAT_SEED_PROOF",
      entityType: "DATASET",
      entityId: "universal-chat-v1",
      outcome: "SUCCESS",
      details: { scope: "integration-test" },
      occurredAt: "2026-08-13T09:15:00.000Z",
      retentionUntil: "2027-08-13T09:15:00.000Z",
    });

    const usersBefore = await database.select().from(users).orderBy(users.id);
    const baseBefore = await getSeedCounts(database, DEMO_USER_ID);
    const runtimeBefore = await runtimeProof(database);
    expect(baseBefore).toEqual(EXPECTED_BASE_COUNTS);

    await expect(seedUniversalChatDataset(DEMO_USER_ID, database, CLOCK)).resolves.toEqual(
      EXPECTED_UNIVERSAL_CHAT_COUNTS,
    );
    await expect(ensureUniversalChatDataset(DEMO_USER_ID, database, CLOCK)).resolves.toEqual({
      seeded: false,
      counts: EXPECTED_UNIVERSAL_CHAT_COUNTS,
    });
    await expect(seedUniversalChatDataset(DEMO_USER_ID, database, CLOCK)).resolves.toEqual(
      EXPECTED_UNIVERSAL_CHAT_COUNTS,
    );

    expect(await database.select().from(users).orderBy(users.id)).toEqual(usersBefore);
    expect(await getSeedCounts(database, DEMO_USER_ID)).toEqual(baseBefore);
    expect(await runtimeProof(database)).toEqual(runtimeBefore);
  }, 90_000);

  test("persists complete project, position, intake and 52-week operational coverage", async () => {
    const database = await getDatabase({ migrations: "ensure" });
    await resetDemoDatabase(DEMO_USER_ID, database);
    await seedIndustrialCatalogue(DEMO_USER_ID, database);
    await seedUniversalChatDataset(DEMO_USER_ID, database, CLOCK);

    const [projects, positions, materials, intake] = await Promise.all([
      database.select().from(businessProjects),
      database.select().from(businessProjectPositions),
      database.select().from(operationalMaterialViews),
      database.select().from(specificationIntakeItems),
    ]);
    expect(projects).toHaveLength(22);
    expect(positions).toHaveLength(3_584);
    expect(materials).toHaveLength(4_800);
    expect(intake).toHaveLength(83);
    expect(materials.every((material) => material.weeklyMovements.length === 52)).toBe(true);
    expect(positions.every((position) => position.projectAssociationConfidencePercent === 100)).toBe(true);
  }, 90_000);

  test("seeds the extended dataset through canonical reset only when the server flag is enabled", async () => {
    vi.stubEnv("MTR_AGENT_UNIVERSAL_CHAT_ENABLED", "true");
    const database = await getDatabase({ migrations: "ensure" });

    await resetDemoDatabase(DEMO_USER_ID, database);

    await expect(getUniversalChatCounts(database)).resolves.toEqual(
      EXPECTED_UNIVERSAL_CHAT_COUNTS,
    );
    await expect(getSeedCounts(database, DEMO_USER_ID)).resolves.toEqual(
      EXPECTED_BASE_COUNTS,
    );
    await expect(database.select().from(users)).resolves.toHaveLength(8);
  }, 90_000);
});

async function runtimeProof(database: Awaited<ReturnType<typeof getDatabase>>) {
  const [threads, audits] = await Promise.all([
    database.select().from(agentThreads).where(eq(agentThreads.id, "thread-universal-seed-proof")),
    database.select().from(auditLogs).where(eq(auditLogs.id, "audit-universal-seed-proof")),
  ]);
  return { threads, audits };
}
