import "server-only";

import type { SeedCounts } from "@/adapters/persistence/bootstrap";
import {
  getRepository,
  type IntegrationStateRecord,
  type MtrRepository,
} from "@/adapters/persistence/repository";
import type { IntegrationState, IntegrationStatus, SapMaterial } from "@/domain/models";
import { normalizeText } from "@/domain/normalize";
import type { SapStockPort, StockQuery, StockSearchResult } from "@/ports";

const SAP_STATES = new Set<IntegrationStatus>([
  "AVAILABLE",
  "UNAVAILABLE",
  "SLOW",
  "STALE",
  "RATE_LIMITED",
  "MALFORMED_RESPONSE",
]);

const SAFE_MESSAGES: Record<string, string> = {
  AVAILABLE: "SAP доступен; показан текущий демонстрационный снимок остатков.",
  UNAVAILABLE:
    "SAP временно недоступен. Повторите запрос позднее или загрузите остатки вручную из CSV/Excel.",
  SLOW: "SAP доступен с управляемой демонстрационной задержкой.",
  STALE: "Снимок SAP устарел; проверьте дату актуальности перед использованием.",
  RATE_LIMITED:
    "SAP временно ограничил частоту запросов. Повторите попытку или используйте ручной импорт.",
  MALFORMED_RESPONSE:
    "Ответ SAP не прошёл проверку контракта. Используйте ручной импорт CSV/Excel.",
};

const ODATA_FIELDS = [
  "Material",
  "MaterialName",
  "MaterialNameEn",
  "LegacyMaterial",
  "EquipmentType",
  "Standard",
  "MaterialGrade",
  "Dimensions",
  "Plant",
  "StorageLocation",
  "Batch",
  "MatlWrhsStkQtyInMatlBaseUnit",
  "MaterialBaseUnit",
  "SnapshotDate",
  "MaterialCardUrl",
] as const;

type ODataField = (typeof ODATA_FIELDS)[number];

type SapRepository = Pick<
  MtrRepository,
  | "getIntegrationState"
  | "getIntegrationStateInSourceScopes"
  | "getSapMaterialStock"
  | "resetDemoData"
  | "searchSapMaterials"
  | "searchSapMaterialsInSourceScopes"
  | "setIntegrationState"
  | "writeAuditLog"
>;

export interface SapStateUpdate {
  state: IntegrationStatus;
  delayMs?: number;
  snapshotAt?: string | null;
  safeMessage?: string | null;
}

export interface SapODataQuery {
  filter?: string;
  top?: number;
  skip?: number;
  select?: string[];
}

export interface SapODataResult {
  d: {
    results: Array<Partial<Record<ODataField, unknown>>>;
    __count: string;
    nextSkip?: number;
    snapshotAt: string;
  };
}

export interface SapOperationalSnapshot extends StockSearchResult {
  integrationState: IntegrationStatus;
  freshness: "CURRENT" | "STALE";
  warning?: string;
  fallbackPolicy?: "LAST_KNOWN_SNAPSHOT";
  lastSynchronizedAt?: string;
}

interface ParsedODataFilter {
  materialCode?: string;
  plant?: string;
  storageLocation?: string;
  batch?: string;
  equipmentType?: string;
  unit?: string;
  text?: string;
}

export class SapMockError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly safeMessage: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(safeMessage);
    this.name = "SapMockError";
  }
}

export class SapMockAdapter implements SapStockPort {
  constructor(private readonly repository: SapRepository) {}

  async searchMaterialStock(query: StockQuery, userId: string): Promise<SapOperationalSnapshot> {
    const state = await this.assertReadable(userId);
    const result = await this.repository.searchSapMaterials(userId, {
      text: query.text,
      equipmentType: query.equipmentType,
      top: normalizeTop(query.top),
      skip: normalizeSkip(query.skip),
    });
    return applySnapshotState(result, state);
  }

  async searchMaterialStockInScope(
    query: StockQuery,
    sourceScopeIds: readonly string[],
    warehouseIds: readonly string[],
  ): Promise<SapOperationalSnapshot> {
    const state = await this.assertReadableInScope(sourceScopeIds);
    const result = await this.repository.searchSapMaterialsInSourceScopes(sourceScopeIds, {
      text: query.text,
      equipmentType: query.equipmentType,
      warehouseIds,
      top: normalizeTop(query.top),
      skip: normalizeSkip(query.skip),
    });
    return applySnapshotState(result, state);
  }

  async getMaterialStock(materialCode: string, userId: string): Promise<SapMaterial[]> {
    const state = await this.assertReadable(userId);
    const items = await this.repository.getSapMaterialStock(userId, materialCode);
    return state.state === "STALE" && state.snapshotAt
      ? items.map((item) => ({ ...item, snapshotAt: canonicalTimestamp(state.snapshotAt!) }))
      : items;
  }

  async getState(userId: string): Promise<IntegrationState> {
    return this.requireState(userId);
  }

  async searchOData(query: SapODataQuery, userId: string): Promise<SapODataResult> {
    const state = await this.assertReadable(userId);
    const filter = parseODataFilter(query.filter);
    const select = parseODataSelect(query.select);
    const all = await this.repository.searchSapMaterials(userId, { limit: 500, offset: 0 });
    const filtered = all.items.filter((item) => matchesODataFilter(item, filter));
    const skip = normalizeSkip(query.skip);
    const top = normalizeTop(query.top);
    const paged = filtered.slice(skip, skip + top);
    const snapshotAt = canonicalTimestamp(state.snapshotAt || all.snapshotAt);
    const materials =
      state.state === "STALE" && snapshotAt
        ? paged.map((item) => ({ ...item, snapshotAt }))
        : paged;
    const nextSkip = skip + materials.length < filtered.length ? skip + materials.length : undefined;

    return {
      d: {
        results: materials.map((item) => toODataRecord(item, select)),
        __count: String(filtered.length),
        ...(nextSkip === undefined ? {} : { nextSkip }),
        snapshotAt,
      },
    };
  }

  async setState(update: SapStateUpdate, userId: string): Promise<IntegrationStateRecord> {
    if (!SAP_STATES.has(update.state)) {
      throw new SapMockError(
        400,
        "SAP_STATE_INVALID",
        "Передано неподдерживаемое состояние SAP.",
      );
    }
    if (update.state === "STALE" && !update.snapshotAt) {
      throw new SapMockError(
        400,
        "SAP_STALE_SNAPSHOT_REQUIRED",
        "Для состояния STALE укажите дату устаревшего снимка SAP.",
      );
    }
    const delayMs = normalizeDelay(update.state === "SLOW" ? update.delayMs ?? 800 : 0);
    const state = await this.repository.setIntegrationState(userId, "SAP", {
      state: update.state,
      delayMs,
      safeMessage: update.safeMessage ?? SAFE_MESSAGES[update.state],
      ...(update.snapshotAt === undefined ? {} : { snapshotAt: update.snapshotAt }),
      ...(update.state === "AVAILABLE" || update.state === "SLOW"
        ? { lastSynchronizedAt: new Date().toISOString() }
        : {}),
    });
    await this.repository.writeAuditLog(userId, {
      action: "integration.sap.state.updated",
      entityType: "integration_state",
      entityId: "SAP",
      outcome: "SUCCESS",
      details: {
        state: state.state,
        delayMs: state.delayMs,
        snapshotAt: state.snapshotAt ?? null,
        version: state.version,
      },
    });
    return state;
  }

  async reset(userId: string): Promise<{ counts: SeedCounts; state: IntegrationState }> {
    const counts = await this.repository.resetDemoData(userId);
    const state = await this.requireState(userId);
    await this.repository.writeAuditLog(userId, {
      action: "integration.sap.seed.reset",
      entityType: "integration_state",
      entityId: "SAP",
      outcome: "SUCCESS",
      details: { sapMaterials: counts.sapMaterials, sapBalances: counts.sapBalances },
    });
    return { counts, state };
  }

  private async assertReadable(userId: string): Promise<IntegrationStateRecord> {
    const state = await this.requireState(userId);
    if (state.state === "SLOW") await controlledDelay(state.delayMs);
    if (["AVAILABLE", "SLOW", "STALE"].includes(state.state)) return state;

    const status = state.state === "RATE_LIMITED" ? 429 : 503;
    throw new SapMockError(
      status,
      `SAP_${state.state}`,
      state.safeMessage ?? SAFE_MESSAGES[state.state] ?? SAFE_MESSAGES.UNAVAILABLE,
      { state: state.state },
    );
  }

  private async assertReadableInScope(
    sourceScopeIds: readonly string[],
  ): Promise<IntegrationStateRecord> {
    const state = await this.repository.getIntegrationStateInSourceScopes(sourceScopeIds, "SAP");
    if (!state) {
      throw new SapMockError(503, "SAP_STATE_NOT_CONFIGURED", "Состояние SAP не настроено.");
    }
    if (state.state === "SLOW") await controlledDelay(state.delayMs);
    if (state.state === "AVAILABLE" || state.state === "SLOW" || state.state === "STALE") {
      return state;
    }
    throw new SapMockError(
      state.state === "RATE_LIMITED" ? 429 : 503,
      `SAP_${state.state}`,
      state.safeMessage ?? SAFE_MESSAGES[state.state] ?? "SAP временно недоступен.",
    );
  }

  private async requireState(userId: string): Promise<IntegrationStateRecord> {
    const state = await this.repository.getIntegrationState(userId, "SAP");
    if (!state) {
      throw new SapMockError(
        503,
        "SAP_STATE_NOT_CONFIGURED",
        "Состояние интеграции SAP не настроено.",
      );
    }
    return state;
  }
}

export async function createSapMockAdapter(): Promise<SapMockAdapter> {
  return new SapMockAdapter(await getRepository());
}

export function parseODataFilter(filter?: string): ParsedODataFilter {
  if (!filter?.trim()) return {};
  const parsed: ParsedODataFilter = {};
  const clauses = filter.trim().split(/\s+and\s+/iu);
  for (const clause of clauses) {
    const equality = clause.match(
      /^(Material|Plant|StorageLocation|Batch|EquipmentType|MaterialBaseUnit)\s+eq\s+'((?:''|[^'])*)'$/iu,
    );
    if (equality) {
      const property = equality[1].toLocaleLowerCase("en-US");
      const value = equality[2].replace(/''/gu, "'");
      if (property === "material") parsed.materialCode = value;
      if (property === "plant") parsed.plant = value;
      if (property === "storagelocation") parsed.storageLocation = value;
      if (property === "batch") parsed.batch = value;
      if (property === "equipmenttype") parsed.equipmentType = value;
      if (property === "materialbaseunit") parsed.unit = value;
      continue;
    }

    const substring = clause.match(
      /^substringof\('((?:''|[^'])*)',\s*(?:MaterialName|MaterialNameEn|LegacyMaterial)\)$/iu,
    );
    if (substring) {
      parsed.text = substring[1].replace(/''/gu, "'");
      continue;
    }

    throw new SapMockError(
      400,
      "SAP_ODATA_FILTER_UNSUPPORTED",
      "Фильтр SAP OData содержит неподдерживаемое выражение.",
    );
  }
  return parsed;
}

export function parseODataSelect(select?: string[]): ODataField[] {
  if (!select || select.length === 0) return [...ODATA_FIELDS];
  const normalized = [...new Set(select.map((field) => field.trim()).filter(Boolean))];
  const unsupported = normalized.filter(
    (field): field is string => !ODATA_FIELDS.includes(field as ODataField),
  );
  if (unsupported.length > 0) {
    throw new SapMockError(
      400,
      "SAP_ODATA_SELECT_UNSUPPORTED",
      "Параметр $select содержит неподдерживаемые поля SAP OData.",
      { unsupportedFieldCount: unsupported.length },
    );
  }
  return normalized as ODataField[];
}

function matchesODataFilter(item: SapMaterial, filter: ParsedODataFilter): boolean {
  if (filter.materialCode && !same(item.materialCode, filter.materialCode)) return false;
  if (filter.plant && !same(item.plant, filter.plant)) return false;
  if (filter.storageLocation && !same(item.storageLocation, filter.storageLocation)) return false;
  if (filter.batch && !same(item.batch ?? "", filter.batch)) return false;
  if (filter.equipmentType && !same(item.equipmentType, filter.equipmentType)) return false;
  if (filter.unit && !same(item.unit, filter.unit)) return false;
  if (filter.text) {
    const haystack = normalizeText(
      [item.materialCode, item.nameRu, item.nameEn, item.legacyCode, ...item.synonyms]
        .filter(Boolean)
        .join(" "),
    );
    if (!haystack.includes(normalizeText(filter.text))) return false;
  }
  return true;
}

function toODataRecord(
  item: SapMaterial,
  select: ODataField[],
): Partial<Record<ODataField, unknown>> {
  const complete: Record<ODataField, unknown> = {
    Material: item.materialCode,
    MaterialName: item.nameRu,
    MaterialNameEn: item.nameEn ?? null,
    LegacyMaterial: item.legacyCode ?? null,
    EquipmentType: item.equipmentType,
    Standard: item.standard ?? null,
    MaterialGrade: item.materialGrade ?? null,
    Dimensions: item.dimensions,
    Plant: item.plant,
    StorageLocation: item.storageLocation,
    Batch: item.batch ?? null,
    MatlWrhsStkQtyInMatlBaseUnit: item.availableQuantity,
    MaterialBaseUnit: item.unit,
    SnapshotDate: item.snapshotAt,
    MaterialCardUrl: item.cardUrl,
  };
  return Object.fromEntries(select.map((field) => [field, complete[field]]));
}

function applySnapshotState(
  result: Awaited<ReturnType<SapRepository["searchSapMaterials"]>>,
  state: IntegrationStateRecord,
): SapOperationalSnapshot {
  const snapshotAt = canonicalTimestamp(
    state.state === "STALE" && state.snapshotAt ? state.snapshotAt : result.snapshotAt,
  );
  return {
    items:
      state.state === "STALE" && snapshotAt
        ? result.items.map((item) => ({ ...item, snapshotAt }))
        : result.items,
    total: result.total,
    snapshotAt,
    integrationState: state.state,
    freshness: state.state === "STALE" ? "STALE" : "CURRENT",
    ...(state.state === "STALE"
      ? {
          warning: state.safeMessage ?? SAFE_MESSAGES.STALE,
          fallbackPolicy: "LAST_KNOWN_SNAPSHOT" as const,
        }
      : {}),
    ...(state.lastSynchronizedAt ? { lastSynchronizedAt: state.lastSynchronizedAt } : {}),
    ...(result.nextSkip === undefined ? {} : { nextSkip: result.nextSkip }),
  };
}

function canonicalTimestamp(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
}

function same(left: string, right: string): boolean {
  return left.toLocaleUpperCase("ru-RU") === right.toLocaleUpperCase("ru-RU");
}

function normalizeTop(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) return 20;
  return Math.max(1, Math.min(100, Math.trunc(value)));
}

function normalizeSkip(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
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
