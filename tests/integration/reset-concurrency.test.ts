import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/adapters/persistence/db";
import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { users } from "@/adapters/persistence/schema";
import { DEMO_USER_ID } from "@/domain/models";

describe("demo reset concurrency safety", () => {
  beforeEach(async () => {
    await resetDemoDatabase(DEMO_USER_ID);
  });

  it("preserves the trusted identity parent row while restoring fixtures", async () => {
    const database = await getDatabase();
    const sentinelCreatedAt = "2020-01-01T00:00:00.000Z";
    await database
      .update(users)
      .set({ createdAt: sentinelCreatedAt })
      .where(eq(users.id, DEMO_USER_ID));

    const counts = await resetDemoDatabase(DEMO_USER_ID, database);
    const [identity] = await database
      .select({ createdAt: users.createdAt, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, DEMO_USER_ID));

    expect(identity?.displayName).toBe("Демо-пользователь 1");
    expect(new Date(identity?.createdAt ?? "").toISOString()).toBe(sentinelCreatedAt);
    expect(counts).toMatchObject({ users: 1, canonicalPositions: 24, sapMaterials: 30 });
  });

  it("allows repeated reset requests without duplicating the demo identity", async () => {
    const [first, second] = await Promise.all([
      resetDemoDatabase(DEMO_USER_ID),
      resetDemoDatabase(DEMO_USER_ID),
    ]);

    expect(first.users).toBe(1);
    expect(second.users).toBe(1);
  });
});
