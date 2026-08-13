import { createHash } from "node:crypto";

import appiusFixture from "@/adapters/mock/fixtures/appius.json";
import {
  generateIndustrialCatalogue,
  INDUSTRIAL_CATALOGUE_MANIFEST,
} from "@/adapters/mock/fixtures/industrial-catalogue";
import {
  generateSpecificationPortfolio,
  SPECIFICATION_PORTFOLIO_MANIFEST,
} from "@/adapters/mock/fixtures/specification-portfolio";
import sapFixture from "@/adapters/mock/fixtures/sap.json";
import {
  calculateProjectMaterialBalance,
  calculateQuantityCoveragePercent,
  PROJECT_MATERIAL_BALANCE_FORMULA_VERSION,
} from "@/application/agent-orchestrator/universal-chat/project-stock-formulas";
import type {
  BusinessProject,
  BusinessProjectDeadline,
  OperationalMaterialView,
  ProjectAllocation,
  ProjectMaterialOracle,
  SpecificationIntakeItem,
  SpecificationIntakeStatus,
  UniversalChatDataset,
  UniversalChatReferenceProjects,
  UniversalPositionLink,
  UniversalSpecificationLink,
} from "@/domain/agent/universal-chat/dataset";
import {
  scenarioInstantAtLocalHour,
  scenarioWeekStart,
  type ScenarioClock,
} from "@/domain/agent/universal-chat/scenario-clock";
import type { CatalogueItem } from "@/domain/catalogue";

const DATASET_VERSION = "1.0.0-DEMO" as const;
const DATASET_SEED = 0x55_43_48_31;
const ACCESS_PROJECT_ID = "demo-project-001" as const;
const PURPOSES = ["CONSTRUCTION", "MAINTENANCE", "REPAIR", "SPARES"] as const;
const PHASES = ["DESIGN", "PROCUREMENT", "CONSTRUCTION", "COMMISSIONING", "OPERATIONS"] as const;
const INTAKE_STATUSES: readonly SpecificationIntakeStatus[] = [
  "RECEIVED",
  "VALIDATING",
  "QUEUED",
  "PROCESSING",
  "NEEDS_REVIEW",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
];
const cache = new Map<string, UniversalChatDataset>();

interface CurrentSpecification {
  readonly id: string;
  readonly projectCode: string;
  readonly name: string;
  readonly currentVersionId: string;
  readonly currentVersionNumber: number;
}

interface CurrentPosition {
  readonly id: string;
  readonly specificationId: string;
  readonly internalCode: string;
  readonly equipmentType: string;
  readonly requiredQuantity: number;
  readonly unit: string;
}

interface ProjectGroup {
  readonly key: string;
  readonly externalProjectCodes: readonly string[];
  readonly specifications: readonly CurrentSpecification[];
}

export function generateUniversalChatDataset(clock: ScenarioClock): UniversalChatDataset {
  const now = clock.now();
  if (!Number.isFinite(now.getTime())) throw new Error("UNIVERSAL_CHAT_INVALID_CLOCK");
  const cacheKey = `${clock.timeZone}:${now.toISOString()}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const portfolio = generateSpecificationPortfolio();
  const catalogue = generateIndustrialCatalogue();
  const specifications = currentSpecifications(portfolio);
  const positions = currentPositions(portfolio);
  const positionBySpecification = groupBy(positions, (position) => position.specificationId);
  const projectGroups = businessProjectGroups(specifications, positions);
  const businessProjects = projectGroups.map((group, index) =>
    businessProject(group, index, clock),
  );
  const projectBySourceCode = new Map<string, BusinessProject>();
  for (const [index, group] of projectGroups.entries()) {
    const project = businessProjects[index];
    for (const code of group.externalProjectCodes) projectBySourceCode.set(code, project);
  }

  const specificationLinks: UniversalSpecificationLink[] = projectGroups.flatMap((group) => {
    const project = projectBySourceCode.get(group.externalProjectCodes[0]);
    if (!project) throw new Error("UNIVERSAL_CHAT_PROJECT_LINK_MISSING");
    return group.specifications.map((specification, specificationIndex) => ({
      specificationId: specification.id,
      currentVersionId: specification.currentVersionId,
      currentVersionNumber: specification.currentVersionNumber,
      accessProjectId: ACCESS_PROJECT_ID,
      businessProjectId: project.id,
      sourceProjectCode: specification.projectCode,
      purpose: PURPOSES[specificationIndex % PURPOSES.length],
      name: specification.name,
    }));
  });
  const specificationLinkById = new Map(
    specificationLinks.map((link) => [link.specificationId, link]),
  );

  const catalogueByCode = new Map(catalogue.items.map((item) => [item.itemCode, item]));
  const goldenCatalogMapping = mapGoldenPositionsToCatalogue(catalogue.items);
  const sapByGoldenPosition = new Map(
    sapFixture.materials.flatMap((material) => {
      const targetPositionId = material.expectedMatch?.targetPositionId;
      return targetPositionId ? [[targetPositionId, material] as const] : [];
    }),
  );
  const operationalCodeOverride = new Map<string, string>();
  for (const [positionId, item] of goldenCatalogMapping) {
    const sapMaterial = sapByGoldenPosition.get(positionId);
    if (!sapMaterial) throw new Error(`UNIVERSAL_CHAT_SAP_LINK_MISSING:${positionId}`);
    operationalCodeOverride.set(item.itemCode, sapMaterial.materialCode);
  }
  const operationalCodeByCatalogItem = new Map(
    catalogue.items.map((item) => [
      item.itemCode,
      operationalCodeOverride.get(item.itemCode) ?? normalizedOperationalCode(item.itemCode),
    ]),
  );

  const positionLinks: UniversalPositionLink[] = positions.map((position) => {
    const specification = specificationLinkById.get(position.specificationId);
    if (!specification) throw new Error(`UNIVERSAL_CHAT_SPEC_LINK_MISSING:${position.id}`);
    const direct = catalogueByCode.get(position.internalCode);
    const item = direct ?? goldenCatalogMapping.get(position.id);
    if (!item) throw new Error(`UNIVERSAL_CHAT_CATALOG_LINK_MISSING:${position.id}`);
    const operationalMaterialCode = operationalCodeByCatalogItem.get(item.itemCode);
    if (!operationalMaterialCode) {
      throw new Error(`UNIVERSAL_CHAT_OPERATIONAL_LINK_MISSING:${position.id}`);
    }
    return {
      positionId: position.id,
      specificationId: position.specificationId,
      businessProjectId: specification.businessProjectId,
      sourceInternalCode: position.internalCode,
      catalogItemCode: item.itemCode,
      operationalMaterialCode,
      mappingKind: direct ? "DIRECT_CATALOG_CODE" : "NORMALIZED_LEGACY",
      projectAssociationConfidencePercent: 100,
      equipmentType: position.equipmentType,
      sourceRequiredQuantity: whole(position.requiredQuantity),
      sourceUnit: position.unit,
      requiredQuantity: whole(position.requiredQuantity),
      unit: item.unit,
    };
  });

  const weekStarts = Array.from({ length: 52 }, (_, index) =>
    scenarioWeekStart(clock, index - 51),
  );
  const operationalMaterials = catalogue.items.map((item, index) =>
    operationalMaterial(
      item,
      index,
      catalogue.stockBalances.filter((balance) => balance.itemId === item.id),
      operationalCodeByCatalogItem.get(item.itemCode) ?? normalizedOperationalCode(item.itemCode),
      operationalCodeOverride.has(item.itemCode),
      weekStarts,
      clock,
    ),
  );
  const operationalByCode = new Map(
    operationalMaterials.map((material) => [material.materialCode, material]),
  );
  const requirements = aggregateRequirements(positionLinks);
  const projectAllocations = allocateProjectStock(requirements, operationalByCode);
  const projectMaterialOracles = buildProjectMaterialOracles(
    requirements,
    projectAllocations,
    operationalByCode,
    new Map(businessProjects.map((project) => [project.id, project])),
    clock,
  );
  const references = referenceProjects(
    businessProjects,
    specificationLinks,
    positionLinks,
    projectMaterialOracles,
    operationalByCode,
  );
  const specificationIntakes = buildSpecificationIntakes(
    specificationLinks,
    positionBySpecification,
    clock,
  );

  validateCoverage({
    specifications,
    positions,
    catalogueItemCount: catalogue.items.length,
    businessProjects,
    specificationLinks,
    positionLinks,
    operationalMaterials,
    specificationIntakes,
  });

  const manifestCore = {
    datasetId: "universal-chat-v1" as const,
    schemaVersion: "1.0.0" as const,
    datasetVersion: DATASET_VERSION,
    generatedAt: now.toISOString(),
    asOf: now.toISOString(),
    timeZone: clock.timeZone,
    deterministicSeed: DATASET_SEED,
    sourceVersions: {
      appiusBase: appiusFixture.fixtureManifest.fixtureId,
      appiusPortfolio: SPECIFICATION_PORTFOLIO_MANIFEST.fixtureId,
      catalog: INDUSTRIAL_CATALOGUE_MANIFEST.datasetVersion,
      sapBase: sapFixture.fixtureManifest.fixtureId,
      movements: "universal-chat-movements-v1",
      intake: "specification-intake-v1",
      reliability: "reliability-profile-v1",
    },
    expectedCounts: {
      accessProjects: 1 as const,
      businessProjects: businessProjects.length,
      specifications: 83 as const,
      currentPositions: 3_584 as const,
      catalogItems: 4_800 as const,
      operationalMaterials: 4_800 as const,
      specificationIntakes: 83 as const,
      movementWeeksPerUsedMaterial: 52 as const,
    },
    referenceProjectIds: references,
    isSyntheticDemo: true as const,
  };
  const checksum = datasetChecksum([
    JSON.stringify(manifestCore),
    ...specificationLinks.map((item) =>
      `${item.specificationId}:${item.businessProjectId}:${item.purpose}`,
    ),
    ...positionLinks.map((item) =>
      `${item.positionId}:${item.catalogItemCode}:${item.operationalMaterialCode}`,
    ),
    ...projectMaterialOracles.map((item) => `${item.id}:${JSON.stringify(item.expected)}`),
    ...specificationIntakes.map((item) => `${item.specificationId}:${item.status}`),
  ]);
  const dataset: UniversalChatDataset = {
    manifest: { ...manifestCore, checksum },
    businessProjects,
    specificationLinks,
    positionLinks,
    operationalMaterials,
    specificationIntakes,
    projectAllocations,
    projectMaterialOracles,
  };
  cache.set(cacheKey, dataset);
  return dataset;
}

function currentSpecifications(
  portfolio: ReturnType<typeof generateSpecificationPortfolio>,
): CurrentSpecification[] {
  return [
    ...appiusFixture.specifications.map((specification) => ({
      id: specification.id,
      projectCode: specification.projectCode,
      name: specification.name,
      currentVersionId: specification.latestVersionId,
      currentVersionNumber: specification.latestVersionNumber,
    })),
    ...portfolio.specifications.map((specification) => ({
      id: specification.id,
      projectCode: specification.projectCode,
      name: specification.name,
      currentVersionId: specification.latestVersionId,
      currentVersionNumber: specification.latestVersionNumber,
    })),
  ];
}

function currentPositions(
  portfolio: ReturnType<typeof generateSpecificationPortfolio>,
): CurrentPosition[] {
  return [
    ...appiusFixture.positions.map((position) => ({
      id: position.id,
      specificationId: position.specificationId,
      internalCode: position.internalCode,
      equipmentType: position.equipmentType,
      requiredQuantity: position.requiredQuantity,
      unit: position.unit,
    })),
    ...portfolio.positions.map((position) => ({
      id: position.id,
      specificationId: position.specificationId,
      internalCode: position.internalCode,
      equipmentType: position.equipmentType,
      requiredQuantity: position.requiredQuantity,
      unit: position.unit,
    })),
  ];
}

function businessProjectGroups(
  specifications: readonly CurrentSpecification[],
  positions: readonly CurrentPosition[],
): ProjectGroup[] {
  const specificationById = new Map(specifications.map((item) => [item.id, item]));
  const pipeCountByCode = new Map<string, number>();
  for (const position of positions) {
    if (position.equipmentType !== "PIPE") continue;
    const specification = specificationById.get(position.specificationId);
    if (!specification) continue;
    pipeCountByCode.set(
      specification.projectCode,
      (pipeCountByCode.get(specification.projectCode) ?? 0) + 1,
    );
  }
  const pipeSources = [...pipeCountByCode]
    .filter(([, count]) => count > 0)
    .sort(([codeA, countA], [codeB, countB]) => countB - countA || codeA.localeCompare(codeB));
  const mergedPipeCodes: string[] = [];
  let mergedPipeCount = 0;
  for (const [code, count] of pipeSources) {
    mergedPipeCodes.push(code);
    mergedPipeCount += count;
    if (mergedPipeCount >= 24) break;
  }
  if (mergedPipeCount < 24) throw new Error("UNIVERSAL_CHAT_PIPE_REFERENCE_INSUFFICIENT");
  const mergedKey = `pipe-rich:${[...mergedPipeCodes].sort().join("+")}`;
  const mergedSet = new Set(mergedPipeCodes);
  const byKey = new Map<string, CurrentSpecification[]>();
  for (const specification of specifications) {
    const key = mergedSet.has(specification.projectCode)
      ? mergedKey
      : `project:${specification.projectCode}`;
    const values = byKey.get(key) ?? [];
    values.push(specification);
    byKey.set(key, values);
  }
  return [...byKey]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, values]) => ({
      key,
      externalProjectCodes: [...new Set(values.map((item) => item.projectCode))].sort(),
      specifications: [...values].sort((left, right) => left.id.localeCompare(right.id)),
    }));
}

function businessProject(
  group: ProjectGroup,
  index: number,
  clock: ScenarioClock,
): BusinessProject {
  const needDays = index === 0 ? 2 : 7 + ((index * 7) % 45);
  const firstName = group.specifications[0]?.name ?? group.externalProjectCodes[0];
  const baseName = firstName.split(" — ")[0]?.trim() || firstName;
  const code = group.externalProjectCodes.join(" + ");
  const name = group.externalProjectCodes.length > 1
    ? `Программа МТР ${group.externalProjectCodes.join(" / ")}`
    : `${baseName} · ${group.externalProjectCodes[0]}`;
  const deadlines: BusinessProjectDeadline[] = [
    deadline("DESIGN_FREEZE", Math.max(1, needDays - 14), index, clock),
    deadline("MATERIAL_NEED", needDays, index, clock),
    deadline("START_UP", needDays + 10, index, clock),
  ];
  return {
    id: `business-project-${slug(group.key)}`,
    accessProjectId: ACCESS_PROJECT_ID,
    code,
    name,
    aliases: [...new Set([code, name, ...group.externalProjectCodes, ...group.specifications.map((item) => item.name)])],
    externalProjectCodes: group.externalProjectCodes,
    status: "ACTIVE",
    phase: PHASES[index % PHASES.length],
    needDate: scenarioInstantAtLocalHour(clock, needDays, 9),
    deadlines,
    isSyntheticDemo: true,
  };
}

function deadline(
  kind: BusinessProjectDeadline["kind"],
  daysFromToday: number,
  projectIndex: number,
  clock: ScenarioClock,
): BusinessProjectDeadline {
  return {
    id: `deadline-${projectIndex + 1}-${kind.toLocaleLowerCase("en-US")}`,
    kind,
    dueAt: scenarioInstantAtLocalHour(clock, daysFromToday, kind === "START_UP" ? 12 : 9),
    daysFromScenarioToday: daysFromToday,
    status: daysFromToday <= 3 ? "AT_RISK" : "UPCOMING",
  };
}

function mapGoldenPositionsToCatalogue(
  items: readonly CatalogueItem[],
): Map<string, CatalogueItem> {
  const mapping = new Map<string, CatalogueItem>();
  const used = new Set<string>();
  const aliases: Record<string, string> = {
    CABLE: "POWER_CABLE",
  };
  for (const position of appiusFixture.positions) {
    const equipmentType = aliases[position.equipmentType] ?? position.equipmentType;
    const candidates = items.filter(
      (item) =>
        item.itemKind === "COMPONENT" &&
        item.equipmentType === equipmentType &&
        !used.has(item.itemCode),
    );
    const unitCandidate = candidates.find((item) => item.unit === position.unit);
    const item = unitCandidate ?? candidates[0];
    if (!item) throw new Error(`UNIVERSAL_CHAT_GOLDEN_MAPPING_MISSING:${position.id}`);
    mapping.set(position.id, item);
    used.add(item.itemCode);
  }
  return mapping;
}

function operationalMaterial(
  item: CatalogueItem,
  index: number,
  balances: readonly { availableQuantity: number; snapshotAt: string }[],
  materialCode: string,
  sapBase: boolean,
  weekStarts: readonly string[],
  clock: ScenarioClock,
): OperationalMaterialView {
  const onHandQuantity = whole(
    balances.reduce((total, balance) => total + balance.availableQuantity, 0),
  );
  const reservedQuantity = Math.min(onHandQuantity, Math.floor(onHandQuantity * ((index % 5) + 2) / 100));
  const afterReserved = onHandQuantity - reservedQuantity;
  const quarantinedQuantity = Math.min(
    afterReserved,
    index % 9 === 0 ? Math.floor(onHandQuantity * 0.03) : 0,
  );
  const averageConsumption = 1 + (index % 9);
  const leadTimeDays = 5 + (index % 28);
  return {
    materialCode,
    catalogItemCode: item.itemCode,
    sourceKind: sapBase ? "SAP_BASE" : "CATALOG_NORMALIZED",
    equipmentType: item.equipmentType,
    itemKind: item.itemKind,
    familyId: item.familyId,
    unit: item.unit,
    packSize: packSize(item.unit),
    leadTimeDays,
    safetyStock: averageConsumption * 2,
    stock: {
      snapshotId: `universal-stock-${item.id}`,
      snapshotAt: clock.now().toISOString(),
      onHandQuantity,
      reservedQuantity,
      quarantinedQuantity,
      committedToOtherNeeds: 0,
      unit: item.unit,
    },
    inboundSupplies: [
      {
        id: `universal-inbound-${item.id}-1`,
        confirmedQuantity: 2 + (index % 23),
        promisedAt: scenarioInstantAtLocalHour(clock, 2 + (index % 21), 10),
        leadTimeDays,
        status: "CONFIRMED",
      },
      {
        id: `universal-inbound-${item.id}-2`,
        confirmedQuantity: 4 + (index % 31),
        promisedAt: scenarioInstantAtLocalHour(clock, 35 + (index % 21), 10),
        leadTimeDays: leadTimeDays + 7,
        status: "CONFIRMED",
      },
    ],
    weeklyMovements: weekStarts.map((weekStart, weekIndex) => ({
      weekStart,
      consumptionQuantity: averageConsumption + (weekIndex % 4),
      receiptQuantity: weekIndex % 4 === 0 ? averageConsumption * 3 : 0,
      transferInQuantity: weekIndex % 13 === 0 ? 1 + (index % 4) : 0,
      transferOutQuantity: weekIndex % 17 === 0 ? index % 3 : 0,
      adjustmentQuantity: weekIndex % 19 === 0 ? (index % 3) - 1 : 0,
      unit: item.unit,
      sourceVersion: "universal-chat-movements-v1",
    })),
    reliability: {
      profileVersion: "reliability-profile-v1",
      operatingHours: 8_000 + (index % 12) * 500,
      mtbfHours: 12_000 + (index % 20) * 750,
      failureCount: index % 5,
      qualityRejectionCount: index % 7 === 0 ? 1 : 0,
      supplyRiskPercent: 5 + (index % 36),
      observedAt: clock.now().toISOString(),
      sourceEvidenceIds: [`reliability-${item.id}-history`, `quality-${item.id}-history`],
    },
  };
}

function aggregateRequirements(
  links: readonly UniversalPositionLink[],
): Map<string, { projectId: string; materialCode: string; quantity: number; unit: string }> {
  const values = new Map<string, { projectId: string; materialCode: string; quantity: number; unit: string }>();
  for (const link of links) {
    const key = `${link.businessProjectId}:${link.operationalMaterialCode}`;
    const current = values.get(key);
    if (current && current.unit !== link.unit) {
      throw new Error(`UNIVERSAL_CHAT_UNIT_CONFLICT:${key}`);
    }
    values.set(key, {
      projectId: link.businessProjectId,
      materialCode: link.operationalMaterialCode,
      quantity: (current?.quantity ?? 0) + link.requiredQuantity,
      unit: link.unit,
    });
  }
  return values;
}

function allocateProjectStock(
  requirements: ReadonlyMap<string, { projectId: string; materialCode: string; quantity: number; unit: string }>,
  materialByCode: ReadonlyMap<string, OperationalMaterialView>,
): ProjectAllocation[] {
  const byMaterial = groupBy([...requirements.values()], (item) => item.materialCode);
  const allocations: ProjectAllocation[] = [];
  for (const [materialCode, materialRequirements] of byMaterial) {
    const material = materialByCode.get(materialCode);
    if (!material) throw new Error(`UNIVERSAL_CHAT_ALLOCATION_MATERIAL_MISSING:${materialCode}`);
    let remaining = Math.max(
      0,
      material.stock.onHandQuantity -
        material.stock.reservedQuantity -
        material.stock.quarantinedQuantity,
    );
    for (const requirement of [...materialRequirements].sort((a, b) => a.projectId.localeCompare(b.projectId))) {
      const quantity = Math.min(requirement.quantity, remaining);
      if (quantity > 0) {
        allocations.push({
          id: `allocation-${slug(material.stock.snapshotId)}-${slug(requirement.projectId)}`,
          snapshotId: material.stock.snapshotId,
          businessProjectId: requirement.projectId,
          materialCode,
          quantity,
          unit: requirement.unit,
          allocationVersion: "project-allocation-v1",
        });
      }
      remaining -= quantity;
    }
  }
  return allocations;
}

function buildProjectMaterialOracles(
  requirements: ReadonlyMap<string, { projectId: string; materialCode: string; quantity: number; unit: string }>,
  allocations: readonly ProjectAllocation[],
  materialByCode: ReadonlyMap<string, OperationalMaterialView>,
  projectById: ReadonlyMap<string, BusinessProject>,
  clock: ScenarioClock,
): ProjectMaterialOracle[] {
  const now = clock.now().getTime();
  return [...requirements.values()]
    .sort((left, right) =>
      left.projectId.localeCompare(right.projectId) || left.materialCode.localeCompare(right.materialCode),
    )
    .map((requirement) => {
      const material = materialByCode.get(requirement.materialCode);
      const project = projectById.get(requirement.projectId);
      if (!material || !project) throw new Error("UNIVERSAL_CHAT_ORACLE_INPUT_MISSING");
      const otherAllocations = allocations
        .filter(
          (allocation) =>
            allocation.materialCode === requirement.materialCode &&
            allocation.businessProjectId !== requirement.projectId,
        )
        .reduce((total, allocation) => total + allocation.quantity, 0);
      const confirmedInboundArrivingByNeedDate = material.inboundSupplies
        .filter((inbound) => Date.parse(inbound.promisedAt) <= Date.parse(project.needDate))
        .reduce((total, inbound) => total + inbound.confirmedQuantity, 0);
      const openPurchaseQuantityAfterNeedDateAdjustment = material.inboundSupplies
        .filter((inbound) => Date.parse(inbound.promisedAt) > Date.parse(project.needDate))
        .reduce((total, inbound) => total + inbound.confirmedQuantity, 0);
      const needWeeks = Math.max(0, Math.ceil((Date.parse(project.needDate) - now) / (7 * 24 * 60 * 60 * 1_000)));
      const averageConsumption = Math.ceil(
        material.weeklyMovements.reduce(
          (total, movement) => total + movement.consumptionQuantity,
          0,
        ) / material.weeklyMovements.length,
      );
      const inputs = {
        onHandQuantity: material.stock.onHandQuantity,
        reservedQuantity: material.stock.reservedQuantity,
        quarantinedQuantity: material.stock.quarantinedQuantity,
        committedToOtherNeeds: material.stock.committedToOtherNeeds + otherAllocations,
        confirmedInboundArrivingByNeedDate,
        remainingProjectRequirement: requirement.quantity,
        forecastDemandUntilNeedDate: averageConsumption * needWeeks,
        safetyStock: material.safetyStock,
        openPurchaseQuantityAfterNeedDateAdjustment,
        packSize: material.packSize,
      };
      const expected = calculateProjectMaterialBalance(inputs);
      return {
        id: `oracle-${slug(requirement.projectId)}-${slug(requirement.materialCode)}`,
        businessProjectId: requirement.projectId,
        materialCode: requirement.materialCode,
        needDate: project.needDate,
        formulaVersion: PROJECT_MATERIAL_BALANCE_FORMULA_VERSION,
        inputs,
        expected,
        indicators: {
          projectAssociationConfidencePercent: 100,
          technicalCompatibilityPercent: 100,
          quantityCoveragePercent: calculateQuantityCoveragePercent(
            expected.netAvailableAtNeedDate,
            expected.requiredAtNeedDate,
          ),
          dataConfidencePercent: 96,
        },
      } satisfies ProjectMaterialOracle;
    });
}

function buildSpecificationIntakes(
  specifications: readonly UniversalSpecificationLink[],
  positionsBySpecification: ReadonlyMap<string, CurrentPosition[]>,
  clock: ScenarioClock,
): SpecificationIntakeItem[] {
  return [...specifications]
    .sort((left, right) => left.specificationId.localeCompare(right.specificationId))
    .map((specification, index) => {
      const status = INTAKE_STATUSES[index % INTAKE_STATUSES.length];
      const receivedDaysAgo = index % 7;
      const receivedAt = scenarioInstantAtLocalHour(clock, -receivedDaysAgo, 8);
      const validationStartedAt = status === "RECEIVED"
        ? null
        : scenarioInstantAtLocalHour(clock, -receivedDaysAgo, 9);
      const validationFinishedAt = ["RECEIVED", "VALIDATING"].includes(status)
        ? null
        : scenarioInstantAtLocalHour(clock, -receivedDaysAgo, 10);
      const queuedAt = ["QUEUED", "PROCESSING", "NEEDS_REVIEW", "COMPLETED", "FAILED", "CANCELLED"].includes(status)
        ? scenarioInstantAtLocalHour(clock, -receivedDaysAgo, 10)
        : null;
      const hasRun = ["PROCESSING", "NEEDS_REVIEW", "COMPLETED", "FAILED", "CANCELLED"].includes(status);
      const finished = ["NEEDS_REVIEW", "COMPLETED", "FAILED", "CANCELLED"].includes(status);
      const itemCount = positionsBySpecification.get(specification.specificationId)?.length ?? 0;
      const eventIds = [
        `intake-event-${specification.specificationId}-received`,
        ...(validationStartedAt ? [`intake-event-${specification.specificationId}-validation`] : []),
        ...(hasRun ? [`intake-event-${specification.specificationId}-processing`] : []),
        ...(finished ? [`intake-event-${specification.specificationId}-finished`] : []),
      ];
      return {
        id: `intake-${specification.specificationId}`,
        specificationId: specification.specificationId,
        versionId: specification.currentVersionId,
        fileId: `file-${specification.specificationId}-${itemCount}`,
        businessProjectId: specification.businessProjectId,
        receivedAt,
        validationStartedAt,
        validationFinishedAt,
        queuedAt,
        processingStartedAt: hasRun
          ? scenarioInstantAtLocalHour(clock, -receivedDaysAgo, 11)
          : null,
        processingFinishedAt: finished
          ? scenarioInstantAtLocalHour(clock, -receivedDaysAgo, 12)
          : null,
        status,
        currentStep: intakeStep(status),
        assignedActorId: status === "NEEDS_REVIEW" ? "demo-expert-001" : null,
        taskId: status === "NEEDS_REVIEW" ? `task-intake-${specification.specificationId}` : null,
        runId: hasRun ? `run-intake-${specification.specificationId}` : null,
        eventIds,
        safeErrorCategory: status === "FAILED"
          ? "SOURCE_UNAVAILABLE"
          : status === "NEEDS_REVIEW"
            ? "VALIDATION_REQUIRED"
            : null,
        slaDeadline: scenarioInstantAtLocalHour(clock, 1 - receivedDaysAgo, 18),
        version: 1,
        idempotencyKey: `intake:${specification.specificationId}:${specification.currentVersionId}`,
        auditCorrelationId: `correlation-intake-${specification.specificationId}`,
      };
    });
}

function referenceProjects(
  projects: readonly BusinessProject[],
  specifications: readonly UniversalSpecificationLink[],
  positions: readonly UniversalPositionLink[],
  oracles: readonly ProjectMaterialOracle[],
  materialByCode: ReadonlyMap<string, OperationalMaterialView>,
): UniversalChatReferenceProjects {
  const pipeCount = countBy(
    positions.filter((position) => position.equipmentType === "PIPE"),
    (position) => position.businessProjectId,
  );
  const specificationCount = countBy(specifications, (item) => item.businessProjectId);
  const pipeRichProjectId = projects
    .filter(
      (project) =>
        (pipeCount.get(project.id) ?? 0) >= 24 &&
        (specificationCount.get(project.id) ?? 0) >= 3,
    )
    .sort((left, right) =>
      (pipeCount.get(right.id) ?? 0) - (pipeCount.get(left.id) ?? 0) || left.id.localeCompare(right.id),
    )[0]?.id;
  const maintenanceProjectId = specifications.find(
    (item) => item.purpose === "MAINTENANCE",
  )?.businessProjectId;
  const nearestDeadlineProjectId = [...projects]
    .sort(
      (left, right) =>
        Math.min(...left.deadlines.map((item) => item.daysFromScenarioToday)) -
          Math.min(...right.deadlines.map((item) => item.daysFromScenarioToday)) ||
        left.id.localeCompare(right.id),
    )[0]?.id;
  const multiSpecificationProjectId = [...projects]
    .sort(
      (left, right) =>
        (specificationCount.get(right.id) ?? 0) - (specificationCount.get(left.id) ?? 0) ||
        left.id.localeCompare(right.id),
    )[0]?.id;
  const shortageAnalogueProjectId = oracles.find((oracle) => {
    const material = materialByCode.get(oracle.materialCode);
    return oracle.expected.shortageAtNeedDate > 0 && material?.familyId;
  })?.businessProjectId;
  const noPipeProjectId = projects.find((project) => (pipeCount.get(project.id) ?? 0) === 0)?.id;
  if (
    !pipeRichProjectId ||
    !maintenanceProjectId ||
    !nearestDeadlineProjectId ||
    !multiSpecificationProjectId ||
    !shortageAnalogueProjectId ||
    !noPipeProjectId
  ) {
    throw new Error("UNIVERSAL_CHAT_REFERENCE_PROJECT_MISSING");
  }
  return {
    pipeRichProjectId,
    maintenanceProjectId,
    nearestDeadlineProjectId,
    multiSpecificationProjectId,
    shortageAnalogueProjectId,
    noPipeProjectId,
  };
}

function validateCoverage(input: {
  readonly specifications: readonly CurrentSpecification[];
  readonly positions: readonly CurrentPosition[];
  readonly catalogueItemCount: number;
  readonly businessProjects: readonly BusinessProject[];
  readonly specificationLinks: readonly UniversalSpecificationLink[];
  readonly positionLinks: readonly UniversalPositionLink[];
  readonly operationalMaterials: readonly OperationalMaterialView[];
  readonly specificationIntakes: readonly SpecificationIntakeItem[];
}): void {
  const checks = [
    [input.specifications.length, 83, "SPECIFICATIONS"],
    [input.positions.length, 3_584, "POSITIONS"],
    [input.catalogueItemCount, 4_800, "CATALOG"],
    [input.specificationLinks.length, 83, "SPECIFICATION_LINKS"],
    [input.positionLinks.length, 3_584, "POSITION_LINKS"],
    [input.operationalMaterials.length, 4_800, "OPERATIONAL_MATERIALS"],
    [input.specificationIntakes.length, 83, "INTAKE"],
  ] as const;
  for (const [actual, expected, label] of checks) {
    if (actual !== expected) throw new Error(`UNIVERSAL_CHAT_${label}_COUNT:${actual}`);
  }
  if (input.businessProjects.length < 1) throw new Error("UNIVERSAL_CHAT_PROJECTS_EMPTY");
  if (input.operationalMaterials.some((material) => material.weeklyMovements.length !== 52)) {
    throw new Error("UNIVERSAL_CHAT_MOVEMENT_COVERAGE");
  }
}

function intakeStep(status: SpecificationIntakeStatus): string {
  return {
    RECEIVED: "Получено",
    VALIDATING: "Проверка файла",
    QUEUED: "Ожидает обработки",
    PROCESSING: "Обработка позиций",
    NEEDS_REVIEW: "Экспертная проверка",
    COMPLETED: "Завершено",
    FAILED: "Ошибка источника",
    CANCELLED: "Отменено",
  }[status];
}

function normalizedOperationalCode(itemCode: string): string {
  return `SAP-CATALOG-${itemCode.replace(/^CAT-DEMO-/, "")}`;
}

function packSize(unit: string): number {
  if (unit === "M" || unit === "KG") return 5;
  return 1;
}

function whole(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("UNIVERSAL_CHAT_INVALID_QUANTITY");
  return Math.round(value);
}

function slug(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 160);
}

function groupBy<T>(
  values: readonly T[],
  keyFor: (value: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

function countBy<T>(
  values: readonly T[],
  keyFor: (value: T) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = keyFor(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function datasetChecksum(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\n"), "utf8").digest("hex");
}
