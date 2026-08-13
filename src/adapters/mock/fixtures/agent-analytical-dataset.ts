import { generateIndustrialCatalogue } from "@/adapters/mock/fixtures/industrial-catalogue";
import { generateSpecificationPortfolio } from "@/adapters/mock/fixtures/specification-portfolio";
import type {
  AnalyticalDatasetManifest,
  AnalyticalExpertTask,
  AnalyticalInboundSupply,
  AnalyticalMovement,
  AnalyticalOutcomeOracle,
  AnalyticalPositionLink,
  AnalyticalProcessRun,
  AnalyticalResponsibilityOracle,
  AnalyticalScenarioDataset,
  AnalyticalShortageOracle,
  AnalyticalStockSnapshot,
} from "@/domain/agent/analytics/dataset";

const DATASET_VERSION = "1.0.0-DEMO";
const AS_OF = "2026-08-10T23:59:59.000Z";
const GENERATED_AT = "2026-08-11T07:30:00.000Z";
const SEED = 0x47315631;
const WAREHOUSES = ["WH-NORTH", "WH-SOUTH", "WH-EAST", "WH-WEST"] as const;
const WEEK_COUNT = 13;

const EXPECTED_COUNTS = Object.freeze({
  specifications: 12,
  positions: 240,
  assemblyPositions: 24,
  componentPositions: 216,
  mappedPositions: 228,
  intentionalUnmappedPositions: 12,
  warehouses: 4,
  stockRows: 912,
  movementRows: 11_856,
  bomLinks: 144,
  shortages: 48,
  positiveAnalogueCases: 36,
  noCandidateCases: 12,
  responsibilityResolved: 228,
  scenarioRuns: 48,
  expertTasks: 24,
  outcomeOracles: 24,
} as const);

export function generateAgentAnalyticalDataset(): AnalyticalScenarioDataset {
  const portfolio = generateSpecificationPortfolio();
  const catalogue = generateIndustrialCatalogue();
  const selectedSpecifications = portfolio.specifications.slice(-EXPECTED_COUNTS.specifications);
  const positionsBySpecification = new Map<string, typeof portfolio.positions>();
  for (const position of portfolio.positions) {
    const existing = positionsBySpecification.get(position.specificationId) ?? [];
    existing.push(position);
    positionsBySpecification.set(position.specificationId, existing);
  }
  const catalogueByCode = new Map(catalogue.items.map((item) => [item.itemCode, item]));
  const familyMembers = new Map<string, string[]>();
  for (const item of catalogue.items) {
    if (!item.familyId || item.characteristics.compatibilityStatus !== "VALID_MEMBER") continue;
    const existing = familyMembers.get(item.familyId) ?? [];
    existing.push(item.itemCode);
    familyMembers.set(item.familyId, existing);
  }

  const selectedPositions = selectedSpecifications.flatMap((specification) => {
    const all = positionsBySpecification.get(specification.id) ?? [];
    const assemblies = all.filter((position) => position.classification.itemKind === "ASSEMBLY");
    const components = all.filter((position) => position.classification.itemKind === "COMPONENT");
    return [...assemblies.slice(0, 2), ...components.slice(0, 18)];
  });
  if (selectedPositions.length !== EXPECTED_COUNTS.positions) {
    throw new Error("Сертифицированная когорта должна содержать ровно 240 позиций.");
  }

  const positionLinks: AnalyticalPositionLink[] = selectedPositions.map((position, index) => {
    const intentionalNegative = index % 20 === 19;
    const item = catalogueByCode.get(position.internalCode);
    if (!item) throw new Error(`Позиция ${position.id} не найдена в каталоге.`);
    return {
      positionId: position.id,
      specificationId: position.specificationId,
      catalogItemCode: intentionalNegative ? null : item.itemCode,
      sapMaterialCode: intentionalNegative ? null : sapMaterialCode(item.itemCode),
      itemKind: item.itemKind,
      unit: position.unit,
      requiredQuantity: position.requiredQuantity,
      intentionalNegative,
    };
  });
  const mapped = positionLinks.filter(
    (position): position is AnalyticalPositionLink & {
      catalogItemCode: string;
      sapMaterialCode: string;
    } => position.catalogItemCode !== null && position.sapMaterialCode !== null,
  );
  const shortagePositions = mapped.filter((position) => position.itemKind === "COMPONENT").slice(0, 48);
  const shortageIds = new Set(shortagePositions.map((position) => position.positionId));

  const stockSnapshots: AnalyticalStockSnapshot[] = mapped.flatMap((position, positionIndex) =>
    WAREHOUSES.map((warehouseId, warehouseIndex) => {
      const shortage = shortageIds.has(position.positionId);
      const base = shortage
        ? Math.max(1, Math.floor(position.requiredQuantity / 12))
        : position.requiredQuantity + 18 + ((positionIndex + warehouseIndex) % 9);
      return {
        id: `g1-stock-${pad(positionIndex + 1, 3)}-${warehouseIndex + 1}`,
        materialCode: position.sapMaterialCode,
        warehouseId,
        onHandQuantity: base,
        reservedQuantity: 1 + ((positionIndex + warehouseIndex) % 4),
        quarantinedQuantity: (positionIndex + warehouseIndex) % 5 === 0 ? 1 : 0,
        unit: position.unit,
        snapshotAt: warehouseSnapshotAt(warehouseIndex),
      };
    }),
  );

  const movements: AnalyticalMovement[] = mapped.flatMap((position, positionIndex) =>
    Array.from({ length: WEEK_COUNT }, (_, weekIndex) =>
      (["CONSUMPTION", "RECEIPT", "TRANSFER", "ADJUSTMENT"] as const).map(
        (type, typeIndex): AnalyticalMovement => ({
          id: `g1-movement-${pad(positionIndex + 1, 3)}-${pad(weekIndex + 1, 2)}-${typeIndex + 1}`,
          materialCode: position.sapMaterialCode,
          warehouseId: WAREHOUSES[(positionIndex + typeIndex) % WAREHOUSES.length],
          type,
          quantity: movementQuantity(type, positionIndex, weekIndex),
          unit: position.unit,
          occurredAt: movementOccurredAt(weekIndex, typeIndex),
          sourceVersion: `sap-g1-movements-w${pad(weekIndex + 1, 2)}`,
        }),
      ),
    ).flat(),
  );

  const inboundSupplies: AnalyticalInboundSupply[] = shortagePositions.map((position, index) => ({
    id: `g1-inbound-${pad(index + 1, 3)}`,
    materialCode: position.sapMaterialCode,
    warehouseId: WAREHOUSES[index % WAREHOUSES.length],
    confirmedQuantity: index % 4 === 3 ? 0 : 4 + (index % 11),
    expectedAt: offsetIso(AS_OF, 1 + (index % 14)),
    leadTimeDays: 2 + (index % 18),
    sourceVersion: "sap-g1-inbound-2026-08-10",
  }));

  const assemblyCodes = mapped
    .filter((position) => position.itemKind === "ASSEMBLY")
    .map((position) => position.catalogItemCode);
  const assemblyIds = new Set(
    catalogue.items
      .filter((item) => assemblyCodes.includes(item.itemCode))
      .map((item) => item.id),
  );
  const bomLinks = catalogue.bomLinks
    .filter((link) => assemblyIds.has(link.assemblyItemId))
    .map((link) => {
      const assembly = catalogue.items.find((item) => item.id === link.assemblyItemId);
      const component = catalogue.items.find((item) => item.id === link.componentItemId);
      if (!assembly || !component) throw new Error(`Нарушена BOM-ссылка ${link.id}.`);
      return {
        assemblyCode: assembly.itemCode,
        componentCode: component.itemCode,
        quantity: link.quantity,
        unit: link.unit,
      };
    });

  const shortages: AnalyticalShortageOracle[] = shortagePositions.map((position, index) => {
    const item = catalogueByCode.get(position.catalogItemCode);
    const candidates = item?.familyId
      ? (familyMembers.get(item.familyId) ?? []).filter((code) => code !== item.itemCode)
      : [];
    const hasCandidate = index < EXPECTED_COUNTS.positiveAnalogueCases;
    return {
      positionId: position.positionId,
      shortageQuantity: 1 + (index % 17),
      expectedAnalogueOutcome: hasCandidate ? "CANDIDATE_AVAILABLE" : "NO_CANDIDATE",
      expectedCandidateCodes: hasCandidate ? candidates.slice(0, 3) : [],
      ruleVersion: hasCandidate ? "analogue-g1-positive-v1" : "analogue-g1-negative-v1",
    };
  });

  const responsibilities: AnalyticalResponsibilityOracle[] = positionLinks.map((position, index) =>
    position.intentionalNegative
      ? {
          positionId: position.positionId,
          responsibility: "UNKNOWN",
          documentId: null,
          documentVersion: null,
          clauseId: null,
        }
      : {
          positionId: position.positionId,
          responsibility: index % 3 === 0 ? "CUSTOMER" : "CONTRACTOR",
          documentId: "doc-g1-responsibility",
          documentVersion: "1.0.0-DEMO",
          clauseId: `G1-${1 + (index % 8)}`,
        },
  );

  const runs: AnalyticalProcessRun[] = Array.from(
    { length: EXPECTED_COUNTS.scenarioRuns },
    (_, index) => {
      const startedAt = offsetIso("2026-05-18T08:00:00.000Z", index * 2);
      return {
        id: `g1-run-${pad(index + 1, 3)}`,
        specificationId: selectedSpecifications[index % selectedSpecifications.length].id,
        startedAt,
        completedAt: offsetMinutes(startedAt, 8 + (index % 9)),
        outcome: "COMPLETED",
      };
    },
  );
  const expertTasks: AnalyticalExpertTask[] = runs.slice(0, EXPECTED_COUNTS.expertTasks).map(
    (run, index) => ({
      id: `g1-task-${pad(index + 1, 3)}`,
      runId: run.id,
      positionId: positionLinks[index].positionId,
      status: index % 5 === 0 ? "REJECTED" : "APPROVED",
      decidedAt: offsetMinutes(run.completedAt, 30 + (index % 60)),
    }),
  );
  const outcomes: AnalyticalOutcomeOracle[] = shortagePositions
    .slice(0, EXPECTED_COUNTS.outcomeOracles)
    .map((position, index) => ({
      id: `g1-outcome-${pad(index + 1, 3)}`,
      positionId: position.positionId,
      originAt: offsetIso("2026-06-01T00:00:00.000Z", index),
      observedAt: offsetIso("2026-06-01T00:00:00.000Z", index + 28),
      predictedShortageQuantity: 3 + (index % 13),
      actualShortageQuantity: 2 + ((index * 3) % 15),
      causeCode:
        index % 3 === 0
          ? "DEMAND_SPIKE"
          : index % 3 === 1
            ? "SUPPLY_DELAY"
            : "RESERVATION_GROWTH",
    }));

  const checksum = datasetChecksum([
    ...positionLinks.map((item) => `${item.positionId}:${item.sapMaterialCode ?? "UNMAPPED"}`),
    ...shortages.map((item) => `${item.positionId}:${item.expectedAnalogueOutcome}`),
    ...outcomes.map((item) => `${item.positionId}:${item.actualShortageQuantity}`),
  ]);
  const manifest: AnalyticalDatasetManifest = {
    datasetId: "g1-vertical-v1",
    schemaVersion: "1.0.0",
    datasetVersion: DATASET_VERSION,
    deterministicSeed: SEED,
    generatedAt: GENERATED_AT,
    asOf: AS_OF,
    sourceVersions: {
      appius: "appius-portfolio-v1",
      catalog: catalogue.manifest.datasetVersion,
      sap: "sap-g1-vertical-v1",
      normative: "normative-g1-vertical-v1",
      process: "process-g1-vertical-v1",
    },
    expectedCounts: EXPECTED_COUNTS,
    checksum,
    isSyntheticDemo: true,
  };

  return {
    manifest,
    positions: positionLinks,
    stockSnapshots,
    movements,
    inboundSupplies,
    bomLinks,
    shortages,
    responsibilities,
    runs,
    expertTasks,
    outcomes,
  };
}

function movementQuantity(
  type: AnalyticalMovement["type"],
  positionIndex: number,
  weekIndex: number,
): number {
  const base = 1 + ((positionIndex * 7 + weekIndex * 3) % 11);
  if (type === "CONSUMPTION") return base + (weekIndex >= 9 ? 2 : 0);
  if (type === "RECEIPT") return base + 3;
  if (type === "TRANSFER") return base % 2 === 0 ? base : -base;
  return weekIndex % 4 === 0 ? 1 : -1;
}

function movementOccurredAt(weekIndex: number, typeIndex: number): string {
  const start = new Date("2026-05-11T06:00:00.000Z");
  start.setUTCDate(start.getUTCDate() + weekIndex * 7);
  start.setUTCHours(start.getUTCHours() + typeIndex * 4);
  return start.toISOString();
}

function warehouseSnapshotAt(index: number): string {
  const date = new Date("2026-08-10T23:45:00.000Z");
  date.setUTCMinutes(date.getUTCMinutes() + index * 3);
  return date.toISOString();
}

function sapMaterialCode(itemCode: string): string {
  return `SAP-G1-${itemCode}`;
}

function offsetIso(value: string, days: number): string {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function offsetMinutes(value: string, minutes: number): string {
  const date = new Date(value);
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString();
}

function datasetChecksum(values: readonly string[]): string {
  let hash = 2_166_136_261;
  for (const value of values.join("|")) {
    hash ^= value.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}
