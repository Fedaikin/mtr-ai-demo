import { describe, expect, it } from "vitest";

import {
  assertDurableDatabaseConfiguration,
  resolveDatabaseMigrationDecision,
} from "@/adapters/persistence/db";

describe("database deployment configuration", () => {
  it("allows local PGlite when Vercel is not active", () => {
    expect(() => assertDurableDatabaseConfiguration(false, undefined)).not.toThrow();
  });

  it("refuses ephemeral PGlite in a Vercel runtime", () => {
    expect(() => assertDurableDatabaseConfiguration(true, undefined)).toThrow(
      "Для Vercel обязателен DATABASE_URL",
    );
  });

  it("allows Vercel when PostgreSQL is configured", () => {
    expect(() => assertDurableDatabaseConfiguration(true, "postgres://configured")).not.toThrow();
  });
});

describe("database migration decision", () => {
  it("auto-migrates runtime access locally but skips it on Vercel", () => {
    expect(
      resolveDatabaseMigrationDecision({ intent: "runtime", isVercel: false }),
    ).toBe("ensure");
    expect(
      resolveDatabaseMigrationDecision({ intent: "runtime", isVercel: true }),
    ).toBe("skip");
  });

  it("honours explicit bootstrap and diagnostic decisions on every runtime", () => {
    for (const isVercel of [false, true]) {
      expect(
        resolveDatabaseMigrationDecision({ intent: "ensure", isVercel }),
      ).toBe("ensure");
      expect(
        resolveDatabaseMigrationDecision({ intent: "skip", isVercel }),
      ).toBe("skip");
    }
  });
});
