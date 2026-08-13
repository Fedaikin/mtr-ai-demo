import type { SpecificationImportPositionInput } from "@/adapters/persistence/repository";

const FIELD_ALIASES: Record<string, keyof RawPosition> = {
  code: "internalCode", internalcode: "internalCode", код: "internalCode", кодпозиции: "internalCode", кодappius: "internalCode",
  name: "nameRu", nameru: "nameRu", наименование: "nameRu", название: "nameRu", позиция: "nameRu",
  quantity: "requiredQuantity", requiredquantity: "requiredQuantity", количество: "requiredQuantity", потребность: "requiredQuantity",
  unit: "unit", uom: "unit", единица: "unit", единицаизмерения: "unit", едизм: "unit",
  equipmenttype: "equipmentType", типоборудования: "equipmentType", тип: "equipmentType",
  standard: "standard", стандарт: "standard", норматив: "standard",
  materialgrade: "materialGrade", маркаматериала: "materialGrade",
};

interface RawPosition {
  internalCode?: unknown;
  nameRu?: unknown;
  requiredQuantity?: unknown;
  unit?: unknown;
  equipmentType?: unknown;
  standard?: unknown;
  materialGrade?: unknown;
}

export interface SpecificationImportValidation {
  positions: SpecificationImportPositionInput[];
  errors: Array<{ row: number; message: string }>;
  warnings: string[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
}

export function validateSpecificationImport(normalizedData: Record<string, unknown>): SpecificationImportValidation {
  const sourceRows = Array.isArray(normalizedData.rows) ? normalizedData.rows : [];
  const warnings = Array.isArray(normalizedData.warnings)
    ? normalizedData.warnings.filter((value): value is string => typeof value === "string")
    : [];
  const positions: SpecificationImportPositionInput[] = [];
  const errors: SpecificationImportValidation["errors"] = [];

  sourceRows.forEach((source, index) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      errors.push({ row: index + 1, message: "Строка имеет неподдерживаемую структуру." });
      return;
    }
    const raw: RawPosition = {};
    for (const [key, value] of Object.entries(source)) {
      const field = FIELD_ALIASES[canonical(key)];
      if (field && raw[field] === undefined) raw[field] = value;
    }
    const internalCode = clean(raw.internalCode, 160);
    const nameRu = clean(raw.nameRu, 500);
    const unit = clean(raw.unit, 30);
    const requiredQuantity = quantity(raw.requiredQuantity);
    const rowErrors: string[] = [];
    if (!internalCode || !/^[\p{L}\p{N}][\p{L}\p{N}._/-]*$/u.test(internalCode)) rowErrors.push("некорректный код");
    if (!nameRu) rowErrors.push("не указано наименование");
    if (!unit || !/^[\p{L}\p{N}][\p{L}\p{N}\s./%°²³^*-]*$/u.test(unit)) rowErrors.push("некорректная единица");
    if (requiredQuantity === null) rowErrors.push("количество должно быть больше нуля");
    if (rowErrors.length > 0) {
      errors.push({ row: index + 1, message: rowErrors.join(", ") });
      return;
    }
    positions.push({
      internalCode,
      nameRu,
      requiredQuantity: requiredQuantity!,
      unit,
      ...(clean(raw.equipmentType, 100) ? { equipmentType: clean(raw.equipmentType, 100) } : {}),
      ...(clean(raw.standard, 160) ? { standard: clean(raw.standard, 160) } : {}),
      ...(clean(raw.materialGrade, 160) ? { materialGrade: clean(raw.materialGrade, 160) } : {}),
    });
  });

  const duplicateCodes = positions.map((position) => position.internalCode)
    .filter((code, index, all) => all.indexOf(code) !== index);
  for (const code of new Set(duplicateCodes)) errors.push({ row: 0, message: `Код ${code} встречается несколько раз.` });
  return { positions, errors, warnings, totalRows: sourceRows.length, validRows: positions.length, invalidRows: sourceRows.length - positions.length };
}

function canonical(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/[^\p{L}\p{N}]+/gu, "");
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).normalize("NFKC").replace(/[\u0000-\u001F\u007F]/gu, " ").trim().slice(0, max)
    : "";
}

function quantity(value: unknown): number | null {
  const normalized = clean(value, 60).replace(/[\s\u00a0]/gu, "").replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/u.test(normalized)) return null;
  const result = Number(normalized);
  return Number.isFinite(result) && result > 0 && result <= 1_000_000_000_000 ? result : null;
}
