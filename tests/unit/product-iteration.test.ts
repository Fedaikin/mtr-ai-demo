import { describe, expect, it } from "vitest";
import { deterministicInventoryForecast } from "@/domain/inventory-forecast";
import { validateSpecificationImport } from "@/application/specification-import";

describe("итерация продукта МТР", () => {
  it("распознаёт русские и английские поля спецификации", () => {
    const validation = validateSpecificationImport({ rows: [
      { "Код позиции": "MTR-001", "Наименование": "Клапан", "Количество": "12,5", "Единица": "шт.", "Стандарт": "ГОСТ DEMO" },
      { internalCode: "MTR-002", nameRu: "Труба", requiredQuantity: 20, unit: "м" },
    ] });
    expect(validation.errors).toEqual([]);
    expect(validation.positions).toEqual([
      expect.objectContaining({ internalCode: "MTR-001", requiredQuantity: 12.5, standard: "ГОСТ DEMO" }),
      expect.objectContaining({ internalCode: "MTR-002", requiredQuantity: 20 }),
    ]);
  });

  it("не разрешает публикацию невалидных и повторяющихся строк", () => {
    const validation = validateSpecificationImport({ rows: [
      { code: "MTR-001", name: "Клапан", quantity: 1, unit: "шт." },
      { code: "MTR-001", name: "Повтор", quantity: 0, unit: "шт." },
      { code: "MTR-003", quantity: 3, unit: "шт." },
    ] });
    expect(validation.positions).toHaveLength(1);
    expect(validation.errors).toHaveLength(2);
  });

  it("строит воспроизводимый целочисленный прогноз с объяснимой формулой", () => {
    const first = deterministicInventoryForecast("CAT-DEMO-PIP-0005", 41.7);
    const second = deterministicInventoryForecast("CAT-DEMO-PIP-0005", 41.7);
    expect(first).toEqual(second);
    expect(first.stock).toBe(42);
    expect(Number.isInteger(first.shortage)).toBe(true);
    expect(first.explanation).toContain("синтетическое потребление");
  });
});
