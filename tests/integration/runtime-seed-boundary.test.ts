vi.mock("server-only", () => ({}));

import { eq, like } from "drizzle-orm";

import { createAppiusMockAdapter } from "@/adapters/mock/appius-adapter";
import { createNormativeMockAdapter } from "@/adapters/mock/normative-adapter";
import { createSapMockAdapter } from "@/adapters/mock/sap-adapter";
import { initializeDatabase, resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase, getDatabase } from "@/adapters/persistence/db";
import { getRepository } from "@/adapters/persistence/repository";
import {
  specificationPositions,
  specifications as specificationTable,
  specificationVersions,
  users,
} from "@/adapters/persistence/schema";
import { GET as healthCheck } from "@/app/api/health/route";
import { ScenarioService } from "@/application/scenario-service";
import { DEMO_USER_ID } from "@/domain/models";
import { hashSessionToken, resolveDemoSession } from "@/lib/session-core";

describe.sequential("authenticated runtime seed boundary", () => {
  beforeEach(async () => {
    await closeDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("does not execute the full seed-count readiness query in repeated services or factories", async () => {
    const { database, userId } = await createPersistedProtectedContext();
    const execute = vi.spyOn(database, "execute");

    const [firstService, secondService, appius, sap, normative] = await Promise.all([
      ScenarioService.create(),
      ScenarioService.create(),
      createAppiusMockAdapter(),
      createSapMockAdapter(),
      createNormativeMockAdapter(),
    ]);
    const repository = await getRepository();
    const [position] = await repository.listPositions(userId, { currentOnly: true, limit: 1 });
    expect(position).toBeDefined();

    const [firstRuns, secondRuns, specifications, stock, rules] = await Promise.all([
      firstService.listRuns(userId),
      secondService.listRuns(userId),
      appius.listSpecifications(userId),
      sap.searchMaterialStock({ top: 1 }, userId),
      normative.searchResponsibilityRules(position!, userId),
    ]);

    expect(firstRuns).toEqual(secondRuns);
    expect(specifications).toHaveLength(83);
    expect(stock.total).toBe(30);
    expect(rules.length).toBeGreaterThan(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps a runtime mismatch intact and exposes it through readiness health", async () => {
    const { database, userId } = await createPersistedProtectedContext();
    const [removed] = await database
      .select({ id: specificationPositions.id })
      .from(specificationPositions)
      .where(eq(specificationPositions.userId, userId))
      .limit(1);
    expect(removed).toBeDefined();
    await database
      .delete(specificationPositions)
      .where(eq(specificationPositions.id, removed!.id));

    const [service, appius] = await Promise.all([
      ScenarioService.create(),
      createAppiusMockAdapter(),
    ]);
    const [runs, specifications] = await Promise.all([
      service.listRuns(userId),
      appius.listSpecifications(userId),
    ]);
    expect(runs).toEqual([]);
    expect(specifications).toHaveLength(83);

    const repository = await getRepository();
    await expect(
      repository.listPositions(userId, { currentOnly: true }),
    ).resolves.toHaveLength(3_583);

    const response = await healthCheck(
      new Request("http://localhost/api/health?check=ready"),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "not_ready",
      seed: {
        status: "mismatch",
        counts: { canonicalPositions: 3_583 },
      },
    });
  });

  it("reports the canonical eight-subject RBAC seed as ready", async () => {
    await createPersistedProtectedContext();
    const response = await healthCheck(
      new Request("http://localhost/api/health?check=ready"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      seed: {
        status: "ok",
        counts: {
          users: 8,
          canonicalPositions: 3_584,
          sapMaterials: 30,
          sapBalances: 30,
        },
      },
    });
  });

  it("adds the 80-specification portfolio to a legacy seed without deleting runtime data", async () => {
    const { database, userId } = await createPersistedProtectedContext();
    const repository = await getRepository();
    await repository.writeAudit(userId, {
      action: "SPECIFICATION_PORTFOLIO_UPGRADE_SENTINEL",
      entityType: "DEMO_DATASET",
      entityId: userId,
      outcome: "SUCCESS",
    });

    await database
      .delete(specificationPositions)
      .where(like(specificationPositions.id, "position-portfolio-%"));
    await database
      .delete(specificationVersions)
      .where(like(specificationVersions.id, "spec-demo-portfolio-%"));
    await database
      .delete(specificationTable)
      .where(like(specificationTable.id, "spec-demo-portfolio-%"));

    await expect(repository.getCounts(userId)).resolves.toMatchObject({
      specifications: 3,
      canonicalPositions: 24,
    });
    const initialized = await initializeDatabase();

    expect(initialized).toMatchObject({
      seeded: true,
      counts: {
        users: 8,
        specifications: 83,
        specificationVersions: 88,
        canonicalPositions: 3_584,
      },
    });
    await expect(repository.listAuditLogs(userId, {
      action: "SPECIFICATION_PORTFOLIO_UPGRADE_SENTINEL",
    })).resolves.toHaveLength(1);
    const [identity] = await database
      .select({ displayName: users.displayName, login: users.login })
      .from(users)
      .where(eq(users.id, userId));
    expect(identity).toEqual({ displayName: "Демо-пользователь 1", login: "demo" });
  });
});

async function createPersistedProtectedContext() {
  const database = await getDatabase();
  await resetDemoDatabase(DEMO_USER_ID, database);
  const repository = await getRepository();
  const token = "A".repeat(43);
  await repository.createAuthSession({
    id: "session-runtime-boundary",
    userId: DEMO_USER_ID,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const session = await resolveDemoSession(token);
  expect(session?.user.id).toBe(DEMO_USER_ID);
  return { database, userId: session!.user.id };
}
