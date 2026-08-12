import { createCatalogPort } from "@/adapters/persistence/catalog-port";
import type {
  CatalogAssemblyBom,
  CatalogItemWithStock,
  CatalogPort,
  CatalogSearchQuery,
  CatalogSearchResult,
  CatalogSubstituteResult,
} from "@/ports";

export interface CatalogItemDetail {
  item: CatalogItemWithStock;
  substitutes: CatalogSubstituteResult;
  bom: CatalogAssemblyBom | null;
}

export class CatalogServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CatalogServiceError";
  }
}

export class CatalogService {
  constructor(private readonly catalog: CatalogPort) {}

  static async create(): Promise<CatalogService> {
    return new CatalogService(await createCatalogPort());
  }

  async search(userId: string, query: CatalogSearchQuery): Promise<CatalogSearchResult> {
    return this.catalog.searchItems(normalizeCatalogQuery(query), userId);
  }

  async getItemDetail(userId: string, itemCode: string): Promise<CatalogItemDetail> {
    const normalizedCode = normalizeItemCode(itemCode);
    const item = await this.catalog.getItemByCode(normalizedCode, userId);
    if (!item) {
      throw new CatalogServiceError(
        404,
        "CATALOG_ITEM_NOT_FOUND",
        "Позиция промышленного каталога не найдена.",
      );
    }

    const [substitutes, bom] = await Promise.all([
      this.catalog.listSubstitutes(normalizedCode, userId),
      item.itemKind === "ASSEMBLY"
        ? this.catalog.getAssemblyBom(normalizedCode, userId)
        : Promise.resolve(null),
    ]);
    return {
      item,
      substitutes: substitutes ?? {
        sourceItemCode: item.itemCode,
        family: null,
        items: [],
      },
      bom,
    };
  }
}

function normalizeCatalogQuery(query: CatalogSearchQuery): CatalogSearchQuery {
  return {
    ...(trimmed(query.text) ? { text: trimmed(query.text) } : {}),
    ...(trimmed(query.code) ? { code: trimmed(query.code) } : {}),
    ...(trimmed(query.name) ? { name: trimmed(query.name) } : {}),
    ...(trimmed(query.manufacturer) ? { manufacturer: trimmed(query.manufacturer) } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(trimmed(query.equipmentType)
      ? { equipmentType: trimmed(query.equipmentType)?.toLocaleUpperCase("ru-RU") }
      : {}),
    ...(query.itemKind ? { itemKind: query.itemKind } : {}),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    ...(query.offset === undefined ? {} : { offset: query.offset }),
  };
}

function normalizeItemCode(value: string): string {
  return value.trim().toLocaleUpperCase("ru-RU");
}

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result || undefined;
}
