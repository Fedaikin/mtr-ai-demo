import type { CoverageResult } from "@/domain/agent/analytics/artifacts";

export interface CoverageStockInput {
  readonly materialCode: string;
  readonly physicalQuantity: number;
  readonly reservedQuantity: number;
  readonly quarantinedQuantity: number;
  readonly unit: string;
  readonly evidenceNodeId: string;
}

export interface CoverageRequest {
  readonly requiredQuantity: number;
  readonly unit: string;
  readonly directMaterialCode: string;
  readonly stock: readonly CoverageStockInput[];
  readonly confirmedInboundQuantity: number;
  readonly averageDailyConsumption: number | null;
  readonly analogueMaterialCodes: readonly string[];
}

export function calculateCoverage(request: CoverageRequest): CoverageResult {
  assertFiniteNonNegative(request.requiredQuantity, "requiredQuantity");
  assertFiniteNonNegative(request.confirmedInboundQuantity, "confirmedInboundQuantity");
  const ledger = new Map<string, number>();
  let physicalQuantity = 0;
  let reservedQuantity = 0;
  let quarantinedQuantity = 0;
  const evidenceNodeIds: string[] = [];

  for (const row of request.stock) {
    if (row.unit !== request.unit) throw new Error("COVERAGE_UNIT_CONFLICT");
    assertFiniteNonNegative(row.physicalQuantity, "physicalQuantity");
    assertFiniteNonNegative(row.reservedQuantity, "reservedQuantity");
    assertFiniteNonNegative(row.quarantinedQuantity, "quarantinedQuantity");
    const available = Math.max(
      0,
      row.physicalQuantity - row.reservedQuantity - row.quarantinedQuantity,
    );
    ledger.set(row.materialCode, (ledger.get(row.materialCode) ?? 0) + available);
    physicalQuantity += row.physicalQuantity;
    reservedQuantity += row.reservedQuantity;
    quarantinedQuantity += row.quarantinedQuantity;
    evidenceNodeIds.push(row.evidenceNodeId);
  }

  const allocations: CoverageResult["allocations"][number][] = [];
  let remaining = request.requiredQuantity;
  const directAvailable = ledger.get(request.directMaterialCode) ?? 0;
  const directCoverageQuantity = Math.min(remaining, directAvailable);
  if (directCoverageQuantity > 0) {
    allocations.push({
      materialCode: request.directMaterialCode,
      quantity: directCoverageQuantity,
      source: "DIRECT",
    });
    ledger.set(request.directMaterialCode, directAvailable - directCoverageQuantity);
    remaining -= directCoverageQuantity;
  }

  let analogueCoverageQuantity = 0;
  for (const materialCode of [...new Set(request.analogueMaterialCodes)]) {
    if (remaining <= 0) break;
    const available = ledger.get(materialCode) ?? 0;
    const allocated = Math.min(remaining, available);
    if (allocated <= 0) continue;
    allocations.push({ materialCode, quantity: allocated, source: "ANALOGUE" });
    ledger.set(materialCode, available - allocated);
    analogueCoverageQuantity += allocated;
    remaining -= allocated;
  }

  const availableQuantity = Math.max(0, physicalQuantity - reservedQuantity - quarantinedQuantity);
  return {
    requiredQuantity: round(request.requiredQuantity),
    unit: request.unit,
    physicalQuantity: round(physicalQuantity),
    reservedQuantity: round(reservedQuantity),
    quarantinedQuantity: round(quarantinedQuantity),
    availableQuantity: round(availableQuantity),
    confirmedInboundQuantity: round(request.confirmedInboundQuantity),
    directCoverageQuantity: round(directCoverageQuantity),
    analogueCoverageQuantity: round(analogueCoverageQuantity),
    residualDeficitQuantity: round(Math.max(0, remaining - request.confirmedInboundQuantity)),
    coverageHorizonDays:
      request.averageDailyConsumption !== null && request.averageDailyConsumption > 0
        ? round((directCoverageQuantity + analogueCoverageQuantity) / request.averageDailyConsumption)
        : null,
    allocations,
    evidenceNodeIds: [...new Set(evidenceNodeIds)],
    serviceVersion: "coverage-engine-1.0.0",
  };
}

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`COVERAGE_INVALID_${field}`);
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
