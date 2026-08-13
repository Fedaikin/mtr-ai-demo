import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  AppiusMockAdapter,
  AppiusMockError,
  createAppiusMockAdapter,
} from "@/adapters/mock/appius-adapter";
import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase } from "@/adapters/persistence/db";
import {
  getRepository,
  OptimisticLockError,
} from "@/adapters/persistence/repository";
import { DEMO_USER_ID } from "@/domain/models";

const SPECIFICATION_ID = "spec-demo-piping-001";
const EVENT_ID = "appius-event:spec-demo-piping-001:v3-to-v4";

describe.sequential("ACC-FUNC-006: событие новой версии Appius", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetDemoDatabase(DEMO_USER_ID);
  });
  afterAll(async () => closeDatabase());

  it("создаёт новую immutable-версию, переключает current и сохраняет историю", async () => {
    const adapter = await createAppiusMockAdapter();
    const before = await adapter.listVersions(SPECIFICATION_ID, DEMO_USER_ID);
    const previous = before.find((version) => version.isCurrent)!;

    const event = await adapter.processNewVersionEvent(
      { specificationId: SPECIFICATION_ID, currentVersionId: previous.id },
      DEMO_USER_ID,
    );
    const after = await adapter.listVersions(SPECIFICATION_ID, DEMO_USER_ID);
    const current = after.find((version) => version.isCurrent)!;

    expect(after).toHaveLength(before.length + 1);
    expect(event).toMatchObject({
      previousVersionId: previous.id,
      currentVersionId: current.id,
      usedVersionId: current.id,
      auditCode: "NEW_VERSION_PROMOTED",
    });
    expect(current.versionNumber).toBe(previous.versionNumber + 1);
    await expect(
      adapter.getPositions(SPECIFICATION_ID, current.id, DEMO_USER_ID),
    ).resolves.toHaveLength(8);
    await expect(
      adapter.getPositions(SPECIFICATION_ID, previous.id, DEMO_USER_ID, { history: true }),
    ).resolves.toHaveLength(8);
    await expect(
      (await getRepository()).listPositions(DEMO_USER_ID, { currentOnly: true }),
    ).resolves.toHaveLength(3_584);
  });

  it("возвращает полностью одинаковый результат при replay события без previousVersionId", async () => {
    const repository = await getRepository();
    const adapter = new AppiusMockAdapter(repository);
    const event = {
      eventId: "appius-event:without-previous-version",
      specificationId: SPECIFICATION_ID,
      currentVersionId: `${SPECIFICATION_ID}-v3`,
    };

    const first = await adapter.processNewVersionEvent(event, DEMO_USER_ID);
    const replay = await adapter.processNewVersionEvent(event, DEMO_USER_ID);

    expect(replay).toEqual(first);
    expect(first).toEqual({
      eventType: "APPIUS_NEW_VERSION",
      specificationId: SPECIFICATION_ID,
      previousVersionId: `${SPECIFICATION_ID}-v3`,
      currentVersionId: `${SPECIFICATION_ID}-v4`,
      usedVersionId: `${SPECIFICATION_ID}-v4`,
      rejectedVersionId: `${SPECIFICATION_ID}-v3`,
      auditCode: "NEW_VERSION_PROMOTED",
    });
    await expect(
      repository.listSpecificationVersions(DEMO_USER_ID, SPECIFICATION_ID),
    ).resolves.toHaveLength(4);
    await expect(repository.listAuditLogs(DEMO_USER_ID, {
      action: "appius.new_version.promoted",
    })).resolves.toHaveLength(1);
  });

  it("resolves two concurrent deliveries of one event to the same durable promotion", async () => {
    const repository = await getRepository();
    const adapter = new AppiusMockAdapter(repository);
    const promote = repository.promoteNextSpecificationVersion.bind(repository);
    let releaseFirstPromotion!: () => void;
    const peerCommitted = new Promise<void>((resolve) => {
      releaseFirstPromotion = resolve;
    });
    let promotionCalls = 0;
    const promotionSpy = vi
      .spyOn(repository, "promoteNextSpecificationVersion")
      .mockImplementation(async (userId, input) => {
        const call = ++promotionCalls;
        if (call === 1) {
          await peerCommitted;
          throw new OptimisticLockError(input.specificationId);
        }
        if (call === 2) {
          try {
            return await promote(userId, input);
          } finally {
            releaseFirstPromotion();
          }
        }
        return promote(userId, input);
      });
    const event = {
      eventId: EVENT_ID,
      specificationId: SPECIFICATION_ID,
      previousVersionId: `${SPECIFICATION_ID}-v2`,
      currentVersionId: `${SPECIFICATION_ID}-v3`,
    };

    const results = await Promise.all([
      adapter.processNewVersionEvent(event, DEMO_USER_ID),
      adapter.processNewVersionEvent(event, DEMO_USER_ID),
    ]);

    expect(results).toEqual([
      expect.objectContaining({
        previousVersionId: `${SPECIFICATION_ID}-v3`,
        currentVersionId: `${SPECIFICATION_ID}-v4`,
        usedVersionId: `${SPECIFICATION_ID}-v4`,
      }),
      expect.objectContaining({
        previousVersionId: `${SPECIFICATION_ID}-v3`,
        currentVersionId: `${SPECIFICATION_ID}-v4`,
        usedVersionId: `${SPECIFICATION_ID}-v4`,
      }),
    ]);
    expect(promotionSpy).toHaveBeenCalledTimes(3);
    await expect(
      repository.listSpecificationVersions(DEMO_USER_ID, SPECIFICATION_ID),
    ).resolves.toHaveLength(4);
    await expect(repository.listAuditLogs(DEMO_USER_ID, {
      action: "appius.new_version.promoted",
    })).resolves.toHaveLength(1);
  });

  it("retries an event conflict only once when no durable receipt appears", async () => {
    const repository = await getRepository();
    const adapter = new AppiusMockAdapter(repository);
    const promotionSpy = vi
      .spyOn(repository, "promoteNextSpecificationVersion")
      .mockRejectedValue(new OptimisticLockError(SPECIFICATION_ID));

    await expect(adapter.processNewVersionEvent({
      eventId: "appius-event:unresolved-conflict",
      specificationId: SPECIFICATION_ID,
      currentVersionId: `${SPECIFICATION_ID}-v3`,
    }, DEMO_USER_ID)).rejects.toMatchObject({
      code: "APPIUS_VERSION_CONFLICT",
      status: 409,
    } satisfies Partial<AppiusMockError>);

    expect(promotionSpy).toHaveBeenCalledTimes(2);
    await expect(
      repository.listSpecificationVersions(DEMO_USER_ID, SPECIFICATION_ID),
    ).resolves.toHaveLength(3);
    await expect(repository.listAuditLogs(DEMO_USER_ID, {
      action: "appius.new_version.promoted",
    })).resolves.toHaveLength(0);
  });
});
