import type {
  AnalogueRule,
  GroundedAgentOutput,
  IntegrationState,
  Position,
  ResponsibilityRule,
  SapMaterial,
  ScenarioRun,
  Specification,
  SpecificationVersion,
} from "@/domain/models";
import type {
  CatalogueCategory,
  CatalogueCharacteristicValue,
  CatalogueItemKind,
} from "@/domain/catalogue";

/** Compatibility name for adapters; the domain remains the source of truth. */
export type CatalogItemKind = CatalogueItemKind;

export interface AppiusPort {
  listSpecifications(userId: string): Promise<Specification[]>;
  listVersions(specificationId: string, userId: string): Promise<SpecificationVersion[]>;
  getLatestVersion(specificationId: string, userId: string): Promise<SpecificationVersion>;
  getPositions(
    specificationId: string,
    versionId: string,
    userId: string,
    options?: { history?: boolean },
  ): Promise<Position[]>;
  getState(userId: string): Promise<IntegrationState>;
}

export interface StockQuery {
  text?: string;
  equipmentType?: string;
  top?: number;
  skip?: number;
  select?: string[];
}

export interface StockSearchResult {
  items: SapMaterial[];
  total: number;
  snapshotAt: string;
  nextSkip?: number;
}

export interface SapStockPort {
  searchMaterialStock(query: StockQuery, userId: string): Promise<StockSearchResult>;
  getMaterialStock(materialCode: string, userId: string): Promise<SapMaterial[]>;
  getState(userId: string): Promise<IntegrationState>;
}

export interface CatalogSearchQuery {
  text?: string;
  code?: string;
  name?: string;
  manufacturer?: string;
  category?: CatalogueCategory;
  equipmentType?: string;
  itemKind?: CatalogueItemKind;
  limit?: number;
  offset?: number;
}

export interface CatalogStockBalance {
  id: string;
  plant: string;
  storageLocation: string;
  batch?: string;
  availableQuantity: number;
  unit: string;
  snapshotAt: string;
}

export interface CatalogStockSummary {
  totalAvailableQuantity: number;
  balanceCount: number;
  latestSnapshotAt?: string;
}

export interface CatalogFamily {
  id: string;
  code: string;
  nameRu: string;
  nameEn?: string;
  equipmentType: string;
  itemKind: CatalogueItemKind;
  unit: string;
  compatibilitySignature: Record<string, CatalogueCharacteristicValue>;
  active: boolean;
  isSyntheticDemo: boolean;
}

export interface CatalogItem {
  id: string;
  itemCode: string;
  legacyCode?: string;
  manufacturerPartNumber?: string;
  nameRu: string;
  nameEn?: string;
  synonyms: string[];
  equipmentType: string;
  itemKind: CatalogueItemKind;
  category?: CatalogueCategory;
  familyId?: string;
  manufacturer?: string;
  standard?: string;
  materialGrade?: string;
  characteristics: Record<string, CatalogueCharacteristicValue>;
  unit: string;
  cardUrl: string;
  fixtureTags: string[];
  isSyntheticDemo: boolean;
}

export interface CatalogItemWithStock extends CatalogItem, CatalogStockSummary {
  balances: CatalogStockBalance[];
}

export interface CatalogSearchItem extends CatalogItem, CatalogStockSummary {}

export interface CatalogSearchResult {
  items: CatalogSearchItem[];
  total: number;
  limit: number;
  offset: number;
  nextOffset?: number;
}

export interface CatalogSubstituteResult {
  sourceItemCode: string;
  family: CatalogFamily | null;
  items: CatalogSearchItem[];
}

export interface CatalogBomComponent {
  id: string;
  positionNumber: string;
  quantity: number;
  unit: string;
  isCritical: boolean;
  component: CatalogSearchItem;
  alternativeFamily: CatalogFamily | null;
}

export interface CatalogAssemblyBom {
  assembly: CatalogItem;
  components: CatalogBomComponent[];
}

/** Server-side access to the tenant-scoped synthetic industrial catalogue. */
export interface CatalogPort {
  searchItems(query: CatalogSearchQuery, userId: string): Promise<CatalogSearchResult>;
  getItemByCode(itemCode: string, userId: string): Promise<CatalogItemWithStock | null>;
  listSubstitutes(itemCode: string, userId: string): Promise<CatalogSubstituteResult | null>;
  getAssemblyBom(itemCode: string, userId: string): Promise<CatalogAssemblyBom | null>;
}

export interface NormativePort {
  searchResponsibilityRules(position: Position, userId: string): Promise<ResponsibilityRule[]>;
  searchAnalogueRules(position: Position, userId: string): Promise<AnalogueRule[]>;
}

export interface GroundedAgentInput {
  userId: string;
  message: string;
  threadId?: string;
  facts: Array<{ source: string; payload: unknown }>;
}

export interface LlmProviderMetadata {
  provider: string;
  model: string;
  version: string;
  trainingAllowed: false;
  retentionAllowed: false;
  reasoningPersistence: "NONE";
  maxInputTokens: number;
  maxOutputTokens: number;
  maxRequestCostUsd: number;
}

export interface LlmProviderRequestOptions {
  signal?: AbortSignal;
}

export interface LLMProvider {
  readonly metadata?: LlmProviderMetadata;
  respond(
    input: GroundedAgentInput,
    options?: LlmProviderRequestOptions,
  ): Promise<GroundedAgentOutput>;
}

export interface FileStoragePort {
  put(input: { userId: string; name: string; contentType: string; data: Uint8Array }): Promise<{ url: string }>;
}

export interface AuditPort {
  write(entry: {
    userId: string;
    action: string;
    entityType: string;
    entityId?: string;
    outcome: "SUCCESS" | "FAILURE";
    details?: Record<string, unknown>;
    requestId?: string;
  }): Promise<void>;
}

export interface ScenarioPort {
  getRun(id: string, userId: string): Promise<ScenarioRun | null>;
}
