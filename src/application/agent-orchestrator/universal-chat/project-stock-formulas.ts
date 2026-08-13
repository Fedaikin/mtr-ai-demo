export const PROJECT_MATERIAL_BALANCE_FORMULA_VERSION = "project-material-balance-v1" as const;

export interface ProjectMaterialBalanceInputs {
  readonly onHandQuantity: number;
  readonly reservedQuantity: number;
  readonly quarantinedQuantity: number;
  readonly committedToOtherNeeds: number;
  readonly confirmedInboundArrivingByNeedDate: number;
  readonly remainingProjectRequirement: number;
  readonly forecastDemandUntilNeedDate: number;
  readonly safetyStock: number;
  readonly openPurchaseQuantityAfterNeedDateAdjustment: number;
  readonly packSize: number;
}

export interface ProjectMaterialBalance {
  readonly netAvailableNow: number;
  readonly netAvailableAtNeedDate: number;
  readonly requiredAtNeedDate: number;
  readonly shortageAtNeedDate: number;
  readonly reorderQuantity: number;
}

export function calculateProjectMaterialBalance(
  inputs: ProjectMaterialBalanceInputs,
): ProjectMaterialBalance {
  assertInputs(inputs);
  const netAvailableNow = Math.max(
    0,
    inputs.onHandQuantity -
      inputs.reservedQuantity -
      inputs.quarantinedQuantity -
      inputs.committedToOtherNeeds,
  );
  const netAvailableAtNeedDate =
    netAvailableNow + inputs.confirmedInboundArrivingByNeedDate;
  const requiredAtNeedDate =
    inputs.remainingProjectRequirement +
    inputs.forecastDemandUntilNeedDate +
    inputs.safetyStock;
  const shortageAtNeedDate = Math.max(0, requiredAtNeedDate - netAvailableAtNeedDate);
  const reorderBase = Math.max(
    0,
    shortageAtNeedDate - inputs.openPurchaseQuantityAfterNeedDateAdjustment,
  );
  return {
    netAvailableNow,
    netAvailableAtNeedDate,
    requiredAtNeedDate,
    shortageAtNeedDate,
    reorderQuantity: roundUpToPackSize(reorderBase, inputs.packSize),
  };
}

export function calculateQuantityCoveragePercent(
  coveredQuantity: number,
  requiredQuantity: number,
): number {
  assertWholeNonNegative("coveredQuantity", coveredQuantity);
  assertWholeNonNegative("requiredQuantity", requiredQuantity);
  if (requiredQuantity === 0) return 100;
  return round2(Math.min(100, (coveredQuantity / requiredQuantity) * 100));
}

export function roundUpToPackSize(quantity: number, packSize: number): number {
  assertWholeNonNegative("quantity", quantity);
  if (!Number.isInteger(packSize) || packSize <= 0) {
    throw new Error("PROJECT_BALANCE_INVALID_PACK_SIZE");
  }
  if (quantity === 0) return 0;
  return Math.ceil(quantity / packSize) * packSize;
}

function assertInputs(inputs: ProjectMaterialBalanceInputs): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (key === "packSize") continue;
    assertWholeNonNegative(key, value);
  }
  if (!Number.isInteger(inputs.packSize) || inputs.packSize <= 0) {
    throw new Error("PROJECT_BALANCE_INVALID_PACK_SIZE");
  }
  if (inputs.reservedQuantity + inputs.quarantinedQuantity > inputs.onHandQuantity) {
    throw new Error("PROJECT_BALANCE_INVALID_STOCK_COMPONENTS");
  }
}

function assertWholeNonNegative(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || !Number.isFinite(value)) {
    throw new Error(`PROJECT_BALANCE_INVALID_${name.toLocaleUpperCase("en-US")}`);
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
