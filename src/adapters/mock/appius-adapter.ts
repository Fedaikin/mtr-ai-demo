import "server-only";

import {
  getRepository,
  OptimisticLockError,
  type IntegrationStateRecord,
  type MtrRepository,
} from "@/adapters/persistence/repository";
import type {
  IntegrationState,
  IntegrationStatus,
  Position,
  Specification,
  SpecificationVersion,
} from "@/domain/models";
import type { AppiusPort } from "@/ports";

const APPIUS_STATES = new Set<IntegrationStatus>([
  "AVAILABLE",
  "UNAVAILABLE",
  "SLOW",
  "ACCESS_DENIED",
  "STALE_VERSION",
]);

const SAFE_MESSAGES: Record<string, string> = {
  AVAILABLE: "Appius доступен; используется последняя актуальная версия спецификации.",
  UNAVAILABLE:
    "Appius временно недоступен. Повторите запрос позднее или загрузите спецификацию вручную.",
  SLOW: "Appius доступен с управляемой демонстрационной задержкой.",
  ACCESS_DENIED: "Доступ к данным Appius запрещён для текущей сессии.",
  STALE_VERSION:
    "Appius сообщил об устаревшей версии. Для анализа загрузите последнюю версию спецификации.",
};

type AppiusRepository = Pick<
  MtrRepository,
  | "getIntegrationState"
  | "getLatestSpecificationVersion"
  | "getSpecification"
  | "listPositions"
  | "listSpecificationVersions"
  | "listSpecifications"
  | "promoteNextSpecificationVersion"
  | "setIntegrationState"
  | "writeAuditLog"
>;

export interface AppiusStateUpdate {
  state: IntegrationStatus;
  delayMs?: number;
  safeMessage?: string | null;
}

export interface AppiusNewVersionEvent {
  eventId?: string;
  specificationId?: string;
  previousVersionId?: string;
  currentVersionId?: string;
}

export interface AppiusNewVersionResult {
  eventType: "APPIUS_NEW_VERSION";
  specificationId: string;
  previousVersionId: string | null;
  currentVersionId: string;
  usedVersionId: string;
  rejectedVersionId: string | null;
  auditCode: "NEW_VERSION_PROMOTED";
}

export class AppiusMockError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly safeMessage: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(safeMessage);
    this.name = "AppiusMockError";
  }
}

export class AppiusMockAdapter implements AppiusPort {
  constructor(private readonly repository: AppiusRepository) {}

  async listSpecifications(userId: string): Promise<Specification[]> {
    const [, specifications] = await Promise.all([
      this.assertReadable(userId),
      this.repository.listSpecifications(userId),
    ]);
    return specifications;
  }

  async listVersions(specificationId: string, userId: string): Promise<SpecificationVersion[]> {
    await this.assertReadable(userId);
    await this.requireSpecification(userId, specificationId);
    return this.repository.listSpecificationVersions(userId, specificationId);
  }

  async getLatestVersion(
    specificationId: string,
    userId: string,
  ): Promise<SpecificationVersion> {
    await this.assertReadable(userId);
    await this.requireSpecification(userId, specificationId);
    const version = await this.repository.getLatestSpecificationVersion(userId, specificationId);
    if (!version) {
      throw new AppiusMockError(
        404,
        "APPIUS_CURRENT_VERSION_NOT_FOUND",
        "Актуальная версия спецификации Appius не найдена.",
        { specificationId },
      );
    }
    return version;
  }

  async getPositions(
    specificationId: string,
    versionId: string,
    userId: string,
    options: { history?: boolean } = {},
  ): Promise<Position[]> {
    await this.assertReadable(userId);
    await this.requireSpecification(userId, specificationId);
    const versions = await this.repository.listSpecificationVersions(userId, specificationId);
    const requestedVersion = versions.find((version) => version.id === versionId);
    if (!requestedVersion) {
      throw new AppiusMockError(
        404,
        "APPIUS_VERSION_NOT_FOUND",
        "Версия спецификации Appius не найдена.",
        { specificationId, versionId },
      );
    }

    if (!requestedVersion.isCurrent && !options.history) {
      await this.repository.writeAuditLog(userId, {
        action: "appius.stale_version.rejected",
        entityType: "specification_version",
        entityId: requestedVersion.id,
        outcome: "FAILURE",
        details: {
          auditCode: "STALE_VERSION_REJECTED",
          specificationId,
          requestedVersionId: requestedVersion.id,
          currentVersionId: versions.find((version) => version.isCurrent)?.id ?? null,
        },
      });
      throw new AppiusMockError(
        409,
        "APPIUS_STALE_VERSION",
        "Устаревшая версия доступна только в режиме просмотра истории.",
        {
          specificationId,
          requestedVersionId: requestedVersion.id,
          currentVersionId: versions.find((version) => version.isCurrent)?.id,
        },
      );
    }

    return this.repository.listPositions(userId, {
      specificationId,
      versionId,
      currentOnly: !options.history,
      limit: 500,
    });
  }

  async getState(userId: string): Promise<IntegrationState> {
    return this.requireState(userId);
  }

  async setState(update: AppiusStateUpdate, userId: string): Promise<IntegrationStateRecord> {
    if (!APPIUS_STATES.has(update.state)) {
      throw new AppiusMockError(
        400,
        "APPIUS_STATE_INVALID",
        "Передано неподдерживаемое состояние Appius.",
      );
    }
    const delayMs = normalizeDelay(update.state === "SLOW" ? update.delayMs ?? 800 : 0);
    const state = await this.repository.setIntegrationState(userId, "APPIUS", {
      state: update.state,
      delayMs,
      safeMessage: update.safeMessage ?? SAFE_MESSAGES[update.state],
      ...(update.state === "AVAILABLE"
        ? { lastSynchronizedAt: new Date().toISOString() }
        : {}),
    });
    await this.repository.writeAuditLog(userId, {
      action: "integration.appius.state.updated",
      entityType: "integration_state",
      entityId: "APPIUS",
      outcome: "SUCCESS",
      details: { state: state.state, delayMs: state.delayMs, version: state.version },
    });
    return state;
  }

  async processNewVersionEvent(
    event: AppiusNewVersionEvent,
    userId: string,
  ): Promise<AppiusNewVersionResult> {
    await this.assertReadable(userId, { allowStaleState: true });
    const specifications = await this.repository.listSpecifications(userId);
    const specificationId = event.specificationId ?? specifications[0]?.id;
    if (!specificationId) {
      throw new AppiusMockError(
        404,
        "APPIUS_SPECIFICATION_NOT_FOUND",
        "Спецификация Appius не найдена.",
      );
    }
    await this.requireSpecification(userId, specificationId);
    const versions = await this.repository.listSpecificationVersions(userId, specificationId);
    const current = versions.find((version) => version.isCurrent);
    if (!current) {
      throw new AppiusMockError(
        409,
        "APPIUS_CURRENT_VERSION_NOT_FOUND",
        "Невозможно обработать событие: актуальная версия Appius не найдена.",
        { specificationId },
      );
    }
    if (event.currentVersionId && event.currentVersionId !== current.id && !event.eventId) {
      throw new AppiusMockError(
        409,
        "APPIUS_STALE_VERSION",
        "Событие ссылается не на актуальную версию Appius.",
        { specificationId, requestedVersionId: event.currentVersionId, currentVersionId: current.id },
      );
    }
    const previous = event.previousVersionId
      ? versions.find((version) => version.id === event.previousVersionId)
      : versions.find((version) => !version.isCurrent);
    if (event.previousVersionId && !previous) {
      throw new AppiusMockError(
        404,
        "APPIUS_VERSION_NOT_FOUND",
        "Предыдущая версия из события Appius не найдена.",
        { specificationId, previousVersionId: event.previousVersionId },
      );
    }

    const promotionInput = {
      specificationId,
      expectedCurrentVersionId: event.currentVersionId ?? current.id,
      ...(event.eventId ? { eventId: event.eventId } : {}),
    };
    const promote = () => this.repository.promoteNextSpecificationVersion(
      userId,
      promotionInput,
    );
    let promoted;
    try {
      promoted = await promote();
    } catch (error) {
      if (!(error instanceof OptimisticLockError)) throw error;
      if (event.eventId) {
        try {
          // A concurrent delivery may have committed the same durable event
          // after our first receipt lookup. Replaying the exact CAS-bound input
          // can only resolve that audit receipt or conflict again; it cannot
          // advance an already-promoted specification to another version.
          promoted = await promote();
        } catch (retryError) {
          if (!(retryError instanceof OptimisticLockError)) throw retryError;
          throw versionConflict(specificationId, current.id);
        }
      } else {
        throw versionConflict(specificationId, current.id);
      }
    }
    const rejectedVersionId = event.previousVersionId
      ? previous && !previous.isCurrent ? previous.id : null
      : promoted.previousVersion.id;
    const result: AppiusNewVersionResult = {
      eventType: "APPIUS_NEW_VERSION",
      specificationId,
      previousVersionId: promoted.previousVersion.id,
      currentVersionId: promoted.currentVersion.id,
      usedVersionId: promoted.currentVersion.id,
      rejectedVersionId,
      auditCode: "NEW_VERSION_PROMOTED",
    };
    return result;
  }

  private async requireSpecification(userId: string, specificationId: string): Promise<Specification> {
    const specification = await this.repository.getSpecification(userId, specificationId);
    if (!specification) {
      throw new AppiusMockError(
        404,
        "APPIUS_SPECIFICATION_NOT_FOUND",
        "Спецификация Appius не найдена или недоступна текущему пользователю.",
        { specificationId },
      );
    }
    return specification;
  }

  private async assertReadable(
    userId: string,
    options: { allowStaleState?: boolean } = {},
  ): Promise<IntegrationStateRecord> {
    const state = await this.requireState(userId);
    if (state.state === "SLOW") await controlledDelay(state.delayMs);
    if (state.state === "AVAILABLE" || state.state === "SLOW") return state;
    if (state.state === "STALE_VERSION" && options.allowStaleState) return state;

    const status = state.state === "ACCESS_DENIED" ? 403 : state.state === "STALE_VERSION" ? 409 : 503;
    throw new AppiusMockError(
      status,
      `APPIUS_${state.state}`,
      state.safeMessage ?? SAFE_MESSAGES[state.state] ?? SAFE_MESSAGES.UNAVAILABLE,
      { state: state.state },
    );
  }

  private async requireState(userId: string): Promise<IntegrationStateRecord> {
    const state = await this.repository.getIntegrationState(userId, "APPIUS");
    if (!state) {
      throw new AppiusMockError(
        503,
        "APPIUS_STATE_NOT_CONFIGURED",
        "Состояние интеграции Appius не настроено.",
      );
    }
    return state;
  }
}

function versionConflict(specificationId: string, expectedCurrentVersionId: string): AppiusMockError {
  return new AppiusMockError(
    409,
    "APPIUS_VERSION_CONFLICT",
    "Актуальная версия Appius изменилась во время обработки события.",
    { specificationId, expectedCurrentVersionId },
  );
}

export async function createAppiusMockAdapter(): Promise<AppiusMockAdapter> {
  return new AppiusMockAdapter(await getRepository());
}

function normalizeDelay(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10_000, Math.trunc(value)));
}

async function controlledDelay(delayMs: number): Promise<void> {
  const safeDelay = normalizeDelay(delayMs);
  if (safeDelay === 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, safeDelay));
}
