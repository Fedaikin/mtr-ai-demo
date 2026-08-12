import "server-only";

import type {
  AppiusPort,
  AuditPort,
  FileStoragePort,
  LLMProvider,
  NormativePort,
  SapStockPort,
} from "@/ports";

export class ProductionAdapterNotConfiguredError extends Error {
  readonly code = "PRODUCTION_ADAPTER_NOT_CONFIGURED";

  constructor(readonly system: string) {
    super(`Production adapter ${system} is not configured.`);
    this.name = "ProductionAdapterNotConfiguredError";
  }
}

/**
 * Contract-only adapters make the mock-to-production seam compile-time visible.
 * They intentionally perform no network calls and accept no credentials in code.
 */
export class AppiusProductionPlaceholder implements AppiusPort {
  listSpecifications(...args: Parameters<AppiusPort["listSpecifications"]>): ReturnType<AppiusPort["listSpecifications"]> { return unavailable("APPIUS", args); }
  listVersions(...args: Parameters<AppiusPort["listVersions"]>): ReturnType<AppiusPort["listVersions"]> { return unavailable("APPIUS", args); }
  getLatestVersion(...args: Parameters<AppiusPort["getLatestVersion"]>): ReturnType<AppiusPort["getLatestVersion"]> { return unavailable("APPIUS", args); }
  getPositions(...args: Parameters<AppiusPort["getPositions"]>): ReturnType<AppiusPort["getPositions"]> { return unavailable("APPIUS", args); }
  getState(...args: Parameters<AppiusPort["getState"]>): ReturnType<AppiusPort["getState"]> { return unavailable("APPIUS", args); }
}

export class SapProductionPlaceholder implements SapStockPort {
  searchMaterialStock(...args: Parameters<SapStockPort["searchMaterialStock"]>): ReturnType<SapStockPort["searchMaterialStock"]> { return unavailable("SAP", args); }
  getMaterialStock(...args: Parameters<SapStockPort["getMaterialStock"]>): ReturnType<SapStockPort["getMaterialStock"]> { return unavailable("SAP", args); }
  getState(...args: Parameters<SapStockPort["getState"]>): ReturnType<SapStockPort["getState"]> { return unavailable("SAP", args); }
}

export class NormativeProductionPlaceholder implements NormativePort {
  searchResponsibilityRules(...args: Parameters<NormativePort["searchResponsibilityRules"]>): ReturnType<NormativePort["searchResponsibilityRules"]> { return unavailable("NORMATIVE_SEARCH", args); }
  searchAnalogueRules(...args: Parameters<NormativePort["searchAnalogueRules"]>): ReturnType<NormativePort["searchAnalogueRules"]> { return unavailable("NORMATIVE_SEARCH", args); }
}

export class LlmProductionPlaceholder implements LLMProvider {
  respond(...args: Parameters<LLMProvider["respond"]>): ReturnType<LLMProvider["respond"]> { return unavailable("LLM", args); }
}

export class FileStorageProductionPlaceholder implements FileStoragePort {
  put(...args: Parameters<FileStoragePort["put"]>): ReturnType<FileStoragePort["put"]> { return unavailable("FILE_STORAGE", args); }
}

export class AuditProductionPlaceholder implements AuditPort {
  write(...args: Parameters<AuditPort["write"]>): ReturnType<AuditPort["write"]> { return unavailable("AUDIT_SINK", args); }
}

function unavailable(system: string, context: unknown): Promise<never> {
  void context;
  return Promise.reject(new ProductionAdapterNotConfiguredError(system));
}
