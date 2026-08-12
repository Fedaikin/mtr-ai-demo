import "server-only";

import { getRepository, type MtrRepository } from "./repository";
import type { CatalogPort } from "@/ports";

/** Adapts repository argument order to the application-facing CatalogPort. */
export function createCatalogRepositoryPort(repository: MtrRepository): CatalogPort {
  return {
    searchItems: (query, userId) => repository.searchCatalogItems(userId, query),
    getItemByCode: (itemCode, userId) => repository.getCatalogItemByCode(userId, itemCode),
    listSubstitutes: (itemCode, userId) =>
      repository.listCatalogFamilySubstitutes(userId, itemCode),
    getAssemblyBom: (itemCode, userId) =>
      repository.getCatalogAssemblyBom(userId, itemCode),
  };
}

export async function createCatalogPort(): Promise<CatalogPort> {
  return createCatalogRepositoryPort(await getRepository());
}
