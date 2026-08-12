export const CATALOGUE_CATEGORIES = [
  "PIPING",
  "VALVES",
  "INSTRUMENTATION",
  "ELECTRICAL",
  "ROTATING",
  "MRO",
] as const;

export type CatalogueCategory = (typeof CATALOGUE_CATEGORIES)[number];
export type CatalogueItemKind = "COMPONENT" | "ASSEMBLY";
export type CatalogueCompatibilityStatus =
  | "VALID_MEMBER"
  | "INCOMPATIBLE_DECOY"
  | "NOT_APPLICABLE";
export type CatalogueCharacteristicValue = string | number | boolean | null;
export type CatalogueScalarRecord = Record<string, CatalogueCharacteristicValue>;

export interface CatalogueCharacteristics extends CatalogueScalarRecord {
  category: CatalogueCategory;
  compatibilityStatus: CatalogueCompatibilityStatus;
}

export interface CatalogueInterchangeabilityFamily {
  id: string;
  userId: string;
  code: string;
  nameRu: string;
  nameEn: string;
  equipmentType: string;
  itemKind: "COMPONENT";
  unit: string;
  compatibilitySignature: CatalogueScalarRecord;
  active: true;
  isSyntheticDemo: true;
  createdBy: string;
}

export interface CatalogueItem {
  id: string;
  userId: string;
  itemCode: string;
  legacyCode: string;
  manufacturerPartNumber: string;
  nameRu: string;
  nameEn: string;
  synonyms: string[];
  equipmentType: string;
  itemKind: CatalogueItemKind;
  familyId: string | null;
  manufacturer: string;
  standard: string;
  materialGrade: string;
  characteristics: CatalogueCharacteristics;
  unit: string;
  cardUrl: string;
  fixtureTags: string[];
  isSyntheticDemo: true;
  createdBy: string;
}

export interface CatalogueStockBalance {
  id: string;
  userId: string;
  itemId: string;
  plant: string;
  storageLocation: string;
  batch: string | null;
  availableQuantity: number;
  unit: string;
  snapshotAt: string;
  createdBy: string;
}

export interface CatalogueBomComponent {
  id: string;
  userId: string;
  assemblyItemId: string;
  componentItemId: string;
  positionNumber: string;
  quantity: number;
  unit: string;
  isCritical: boolean;
  alternativeFamilyId: string;
  createdBy: string;
}

export interface CatalogueRepresentativeSample {
  familyCode: string;
  itemCode: string;
  compatibleItemCodes: readonly [string, string, string];
  incompatibleDecoyCode: string;
  assemblyCode: string;
}

export interface IndustrialCatalogueManifest {
  fixtureId: string;
  datasetVersion: string;
  ownerUserId: string;
  seed: number;
  snapshotAt: string;
  expectedItemCount: 4_800;
  expectedComponentCount: 4_320;
  expectedAssemblyCount: 480;
  expectedFamilyCount: 960;
  expectedCompatibleMembersPerFamily: 4;
  expectedDecoyCount: 480;
  expectedStockBalanceCount: 7_200;
  expectedMultiWarehouseItemCount: 2_400;
  expectedBomLinkCount: 2_880;
  expectedComponentsPerAssembly: 6;
  representative: CatalogueRepresentativeSample;
}

export interface IndustrialCatalogue {
  manifest: IndustrialCatalogueManifest;
  families: CatalogueInterchangeabilityFamily[];
  items: CatalogueItem[];
  stockBalances: CatalogueStockBalance[];
  bomLinks: CatalogueBomComponent[];
}

export function catalogueItemCategory(item: CatalogueItem): CatalogueCategory {
  return item.characteristics.category;
}

export function isCatalogueDecoy(item: CatalogueItem): boolean {
  return item.characteristics.compatibilityStatus === "INCOMPATIBLE_DECOY";
}
