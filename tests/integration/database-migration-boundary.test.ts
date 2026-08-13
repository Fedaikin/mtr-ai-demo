vi.mock("server-only", () => ({}));

import { users } from "@/adapters/persistence/schema";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as healthCheck } from "@/app/api/health/route";

describe.sequential("database migration boundary", () => {
  beforeEach(async () => {
    await closeDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("keeps direct local/test database access auto-migrated by default", async () => {
    const database = await getDatabase();
    await expect(database.select().from(users)).resolves.toHaveLength(1);
  });

  it("returns 503 without migrating when readiness sees an unavailable schema", async () => {
    const database = await getDatabase({ migrations: "skip" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await healthCheck(
        new Request("http://localhost/api/health?check=ready"),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        status: "unavailable",
        check: "readiness",
        database: { status: "error" },
      });
      await expect(database.select().from(users)).rejects.toThrow();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("lets a fresh login explicitly migrate and seed an unmigrated connection", async () => {
    const database = await getDatabase({ migrations: "skip" });
    await expect(database.select().from(users)).rejects.toThrow();

    const response = await login(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", host: "localhost" },
        body: JSON.stringify({ login: "demo", password: "Demo2026!" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user: { id: "demo-user-001", displayName: "Демо-пользователь 1" },
    });
    await expect(database.select().from(users)).resolves.toHaveLength(8);
  });
});
