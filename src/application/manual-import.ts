import "server-only";

import type { Position, SapMaterial } from "@/domain/models";

const MAX_IMPORT_ROWS = 500;
const DEFAULT_PLANT = "MANUAL-NOT-PROVIDED";
const DEFAULT_STORAGE = "MANUAL-NOT-PROVIDED";

export interface ManualImportContext {
  userId: string;
  checksumSha256: string;
  acceptedAt: string;
}

export interface ManualAppiusImportContext extends ManualImportContext {
  specificationId: string;
  specificationName: string;
}

export interface CanonicalManualSapImport {
  snapshotId: string;
  snapshotAt: string;
  materials: SapMaterial[];
  warnings: string[];
}

export interface CanonicalManualAppiusImport {
  versionId: string;
  capturedAt: string;
  positions: Position[];
  warnings: string[];
}

/**
 * Converts parsed tabular upload rows into the same domain contract used by the
 * SAP adapter. Identity and provenance always come from the trusted request
 * context, never from columns supplied by the file.
 */
export function canonicalizeManualSapImport(
  normalizedData: unknown,
  context: ManualImportContext,
): CanonicalManualSapImport {
  assertContext(context);
  const rows = importRows(normalizedData, "SAP");
  const digest = safeDigest(context.checksumSha256);
  const warnings = new Set<string>();
  const materials = rows.map((row, index): SapMaterial => {
    const line = index + 2;
    const lookup = new RowLookup(row);
    const materialCode = requiredText(
      lookup.get("materialCode", "material_code", "код материала", "код sap", "sap code", "код"),
      line,
      "код материала SAP",
      160,
    );
    const nameRu = requiredText(
      lookup.get("nameRu", "name_ru", "наименование", "название", "материал"),
      line,
      "наименование",
      500,
    );
    const equipmentType = optionalText(
      lookup.get("equipmentType", "equipment_type", "тип оборудования", "тип", "класс"),
      100,
    ) ?? inferEquipmentType(nameRu);
    if (equipmentType === "UNKNOWN") warnings.add("Для части строк тип оборудования не распознан; такие строки могут не дать совпадений.");
    const availableQuantity = requiredNumber(
      lookup.get("availableQuantity", "available_quantity", "свободный остаток", "доступный остаток", "остаток", "количество"),
      line,
      "свободный остаток",
      0,
    );
    const unit = requiredText(
      lookup.get("unit", "единица", "ед изм", "ед. изм.", "uom"),
      line,
      "единица измерения",
      30,
    );
    const plant = optionalText(lookup.get("plant", "завод", "площадка"), 120) ?? DEFAULT_PLANT;
    const storageLocation = optionalText(
      lookup.get("storageLocation", "storage_location", "warehouse", "склад", "место хранения"),
      120,
    ) ?? DEFAULT_STORAGE;
    if (plant === DEFAULT_PLANT) warnings.add("В части строк не указан завод; сохранено явное значение MANUAL-NOT-PROVIDED.");
    if (storageLocation === DEFAULT_STORAGE) warnings.add("В части строк не указан склад; сохранено явное значение MANUAL-NOT-PROVIDED.");
    const snapshotAt = optionalDate(
      lookup.get("snapshotAt", "snapshotDate", "snapshot_date", "дата снимка", "дата актуальности"),
      line,
    ) ?? context.acceptedAt;

    return {
      id: `manual-sap-${digest}-${index + 1}`,
      userId: context.userId,
      materialCode,
      nameRu,
      ...(optionalText(lookup.get("nameEn", "name_en", "name english", "английское наименование"), 500)
        ? { nameEn: optionalText(lookup.get("nameEn", "name_en", "name english", "английское наименование"), 500) }
        : {}),
      synonyms: textList(lookup.get("synonyms", "синонимы", "сокращения")),
      ...(optionalText(lookup.get("legacyCode", "legacy_code", "legacy код", "старый код"), 160)
        ? { legacyCode: optionalText(lookup.get("legacyCode", "legacy_code", "legacy код", "старый код"), 160) }
        : {}),
      equipmentType,
      ...(optionalText(lookup.get("standard", "стандарт", "норматив"), 200)
        ? { standard: optionalText(lookup.get("standard", "стандарт", "норматив"), 200) }
        : {}),
      ...(optionalText(lookup.get("materialGrade", "material_grade", "марка материала", "материал"), 200)
        ? { materialGrade: optionalText(lookup.get("materialGrade", "material_grade", "марка материала"), 200) }
        : {}),
      dimensions: dimensionsFrom(lookup),
      tolerances: recordValue(lookup.get("tolerances", "допуски")),
      plant,
      storageLocation,
      ...(optionalText(lookup.get("batch", "партия"), 120)
        ? { batch: optionalText(lookup.get("batch", "партия"), 120) }
        : {}),
      availableQuantity,
      unit,
      snapshotAt,
      cardUrl: `/materials/${encodeURIComponent(materialCode)}`,
      fixtureTags: ["source:manual-import"],
    };
  });

  return {
    snapshotId: `manual-sap-${digest}`,
    snapshotAt: context.acceptedAt,
    materials,
    warnings: [...warnings],
  };
}

/** Converts parsed tabular rows into run-scoped Appius positions. */
export function canonicalizeManualAppiusImport(
  normalizedData: unknown,
  context: ManualAppiusImportContext,
): CanonicalManualAppiusImport {
  assertContext(context);
  if (!context.specificationId.trim()) throw new ManualImportError("MANUAL_IMPORT_CONTEXT_INVALID", "Не задана спецификация запуска");
  const rows = importRows(normalizedData, "Appius");
  const digest = safeDigest(context.checksumSha256);
  const versionId = `manual-appius-${digest}`;
  const warnings = new Set<string>();
  const seenCodes = new Set<string>();
  const positions = rows.map((row, index): Position => {
    const line = index + 2;
    const lookup = new RowLookup(row);
    const internalCode = requiredText(
      lookup.get("internalCode", "internal_code", "код позиции", "код appius", "код"),
      line,
      "код позиции Appius",
      160,
    );
    const normalizedCode = internalCode.toLocaleUpperCase("ru-RU");
    if (seenCodes.has(normalizedCode)) {
      throw new ManualImportError("APPIUS_IMPORT_DUPLICATE_CODE", `Строка ${line}: код позиции ${internalCode} повторяется`);
    }
    seenCodes.add(normalizedCode);
    const nameRu = requiredText(
      lookup.get("nameRu", "name_ru", "наименование", "название", "позиция"),
      line,
      "наименование",
      500,
    );
    const equipmentType = optionalText(
      lookup.get("equipmentType", "equipment_type", "тип оборудования", "тип", "класс"),
      100,
    ) ?? inferEquipmentType(nameRu);
    if (equipmentType === "UNKNOWN") warnings.add("Для части строк тип оборудования не распознан; потребуется экспертная проверка.");
    const requiredQuantity = requiredNumber(
      lookup.get("requiredQuantity", "required_quantity", "требуемое количество", "количество", "потребность"),
      line,
      "требуемое количество",
      Number.EPSILON,
    );
    const unit = requiredText(
      lookup.get("unit", "единица", "ед изм", "ед. изм.", "uom"),
      line,
      "единица измерения",
      30,
    );
    const suppliedClassification = recordValue(lookup.get("classification", "классификация"));

    return {
      id: `manual-position-${digest}-${index + 1}`,
      userId: context.userId,
      internalCode,
      nameRu,
      ...(optionalText(lookup.get("nameEn", "name_en", "name english", "английское наименование"), 500)
        ? { nameEn: optionalText(lookup.get("nameEn", "name_en", "name english", "английское наименование"), 500) }
        : {}),
      synonyms: textList(lookup.get("synonyms", "синонимы", "сокращения")),
      equipmentType,
      ...(optionalText(lookup.get("standard", "стандарт", "норматив"), 200)
        ? { standard: optionalText(lookup.get("standard", "стандарт", "норматив"), 200) }
        : {}),
      ...(optionalText(lookup.get("materialGrade", "material_grade", "марка материала"), 200)
        ? { materialGrade: optionalText(lookup.get("materialGrade", "material_grade", "марка материала"), 200) }
        : {}),
      dimensions: dimensionsFrom(lookup),
      requiredQuantity,
      unit,
      specificationId: context.specificationId,
      specificationName: context.specificationName,
      versionId,
      versionNumber: 1,
      isCurrentVersion: true,
      classification: {
        classCode: optionalText(suppliedClassification.classCode, 120) ?? `MANUAL.${equipmentType}`,
        className: optionalText(suppliedClassification.className, 200) ?? "Ручной импорт",
        procurementGroup: optionalText(suppliedClassification.procurementGroup, 120) ?? "MANUAL_IMPORT",
        criticality: optionalText(
          lookup.get("criticality", "критичность") ?? suppliedClassification.criticality,
          40,
        ) ?? "MEDIUM",
      },
      access: { level: "DEMO_USER", allowedUserIds: [context.userId], source: "MANUAL_IMPORT" },
      fixtureTags: ["source:manual-import"],
    };
  });

  return { versionId, capturedAt: context.acceptedAt, positions, warnings: [...warnings] };
}

export class ManualImportError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ManualImportError";
  }
}

class RowLookup {
  private readonly values = new Map<string, unknown>();

  constructor(row: Record<string, unknown>) {
    for (const [key, value] of Object.entries(row)) this.values.set(canonicalKey(key), value);
  }

  get(...aliases: string[]): unknown {
    for (const alias of aliases) {
      const value = this.values.get(canonicalKey(alias));
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
    return undefined;
  }
}

function importRows(normalizedData: unknown, source: string): Record<string, unknown>[] {
  const normalized = asRecord(normalizedData);
  const rows = normalized.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ManualImportError("MANUAL_IMPORT_EMPTY", `В файле ручного импорта ${source} нет табличных строк`);
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new ManualImportError("MANUAL_IMPORT_ROW_LIMIT", `В файле более ${MAX_IMPORT_ROWS} строк`);
  }
  return rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new ManualImportError("MANUAL_IMPORT_ROW_INVALID", `Строка ${index + 2} имеет неверный формат`);
    }
    return row as Record<string, unknown>;
  });
}

function assertContext(context: ManualImportContext): void {
  if (!context.userId.trim() || !context.checksumSha256.trim() || !Number.isFinite(Date.parse(context.acceptedAt))) {
    throw new ManualImportError("MANUAL_IMPORT_CONTEXT_INVALID", "Контекст ручного импорта некорректен");
  }
}

function requiredText(value: unknown, line: number, field: string, maxLength: number): string {
  const result = optionalText(value, maxLength);
  if (!result) throw new ManualImportError("MANUAL_IMPORT_REQUIRED_FIELD", `Строка ${line}: не заполнено поле «${field}»`);
  return result;
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null || typeof value === "object") return undefined;
  const result = String(value).replaceAll("\u0000", "").normalize("NFKC").trim();
  if (!result) return undefined;
  return result.slice(0, maxLength);
}

function requiredNumber(value: unknown, line: number, field: string, minimum: number): number {
  const parsed = numericValue(value);
  if (parsed === undefined || parsed < minimum || parsed > 1_000_000_000_000) {
    throw new ManualImportError("MANUAL_IMPORT_NUMBER_INVALID", `Строка ${line}: поле «${field}» должно быть числом не меньше ${minimum}`);
  }
  return parsed;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[\s\u00a0]/g, "").replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/u.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalDate(value: unknown, line: number): string | undefined {
  const text = optionalText(value, 80);
  if (!text) return undefined;
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) {
    throw new ManualImportError("MANUAL_IMPORT_DATE_INVALID", `Строка ${line}: дата снимка имеет неверный формат`);
  }
  return new Date(timestamp).toISOString();
}

function textList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : optionalText(value, 2_000)?.split(/[;,|]/u) ?? [];
  return [...new Set(values.flatMap((item) => optionalText(item, 200) ?? []).filter(Boolean))].slice(0, 50);
}

function dimensionsFrom(lookup: RowLookup): Record<string, number | string | boolean | null> {
  const dimensions = recordValue(lookup.get("dimensions", "размеры", "характеристики"));
  const aliases: Array<[string, string[]]> = [
    ["nominalDiameterMm", ["nominalDiameterMm", "diameterMm", "dn", "ду", "диаметр мм"]],
    ["outerDiameterMm", ["outerDiameterMm", "наружный диаметр мм"]],
    ["wallThicknessMm", ["wallThicknessMm", "толщина стенки мм"]],
    ["pressureClassBar", ["pressureClassBar", "pn", "ру", "давление бар"]],
    ["angleDeg", ["angleDeg", "угол"]],
    ["voltageV", ["voltageV", "напряжение в"]],
    ["powerKw", ["powerKw", "мощность квт"]],
    ["crossSectionMm2", ["crossSectionMm2", "сечение мм2"]],
    ["widthMm", ["widthMm", "ширина мм"]],
    ["lengthMm", ["lengthMm", "длина мм"]],
  ];
  for (const [key, names] of aliases) {
    const value = lookup.get(...names);
    if (value === undefined) continue;
    dimensions[key] = numericValue(value) ?? optionalText(value, 200) ?? null;
  }
  return dimensions;
}

function recordValue(value: unknown): Record<string, number | string | boolean | null> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .flatMap(([key, item]) =>
          item === null || ["string", "number", "boolean"].includes(typeof item)
            ? [[key.slice(0, 100), item as number | string | boolean | null]]
            : [],
        ),
    );
  }
  if (typeof value === "string") {
    try {
      return recordValue(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return {};
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function inferEquipmentType(name: string): string {
  const normalized = name.toLocaleLowerCase("ru-RU");
  const patterns: Array<[RegExp, string]> = [
    [/кабельн.*лот|cable\s*tray/u, "CABLE_TRAY"],
    [/электродвиг|electric\s*motor|motor/u, "ELECTRIC_MOTOR"],
    [/манометр|pressure\s*gauge/u, "PRESSURE_GAUGE"],
    [/задвиж|gate\s*valve/u, "GATE_VALVE"],
    [/переход|reducer/u, "REDUCER"],
    [/труб|pipe/u, "PIPE"],
    [/отвод|elbow/u, "ELBOW"],
    [/флан|flange/u, "FLANGE"],
    [/клапан|valve/u, "VALVE"],
    [/проклад|gasket/u, "GASKET"],
    [/болт|гайк|креп[её]ж|fastener/u, "FASTENER"],
    [/кабель|cable/u, "CABLE"],
    [/насос|pump/u, "PUMP"],
    [/фитинг|fitting/u, "FITTING"],
  ];
  return patterns.find(([pattern]) => pattern.test(normalized))?.[1] ?? "UNKNOWN";
}

function canonicalKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replace(/[^a-zа-я0-9]+/gu, "");
}

function safeDigest(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^a-f0-9]/g, "").slice(0, 16) || "uploaded";
}
