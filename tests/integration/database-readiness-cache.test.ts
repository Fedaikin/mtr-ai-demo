import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initializeDatabase,
  resetDemoDatabase,
} from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { DEMO_USER_ID } from "@/domain/models";

describe("database readiness cache", () => {
  beforeEach(async () => {
    await closeDatabase();
    await resetDemoDatabase(DEMO_USER_ID);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("executes one readiness count query for concurrent and sequential warm initializations", async () => {
    const database = await getDatabase();
    const execute = vi.spyOn(database, "execute");

    await Promise.all([initializeDatabase(), initializeDatabase(), initializeDatabase()]);
    expect(execute).toHaveBeenCalledTimes(1);

    const warmSeries = await Promise.all(
      Array.from({ length: 20 }, () => initializeDatabase()),
    );
    expect(warmSeries.at(-1)?.counts).toMatchObject({
      users: 7,
      canonicalPositions: 24,
      sapMaterials: 30,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("invalidates readiness after reset and verifies the canonical seed again", async () => {
    const database = await getDatabase();
    const execute = vi.spyOn(database, "execute");

    await initializeDatabase();
    await resetDemoDatabase(DEMO_USER_ID, database);
    const callsAfterReset = execute.mock.calls.length;

    await initializeDatabase();
    expect(execute).toHaveBeenCalledTimes(callsAfterReset + 1);
  });
});
