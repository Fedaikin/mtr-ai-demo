import type { AgentExecutionContext } from "@/domain/agent/context";
import {
  evaluateTechnicalCompatibility,
  type CompatibilityItem,
} from "@/domain/agent/universal-chat/compatibility-engine";
import { resolveEntity } from "@/domain/agent/universal-chat/entity-resolution";
import { compareReliability } from "@/domain/agent/universal-chat/reliability-engine";
import {
  createSystemScenarioClock,
  type ScenarioClock,
} from "@/domain/agent/universal-chat/scenario-clock";
import type { UniversalAgentReadPort, UniversalMaterialRecord } from "@/ports/universal-agent";
import { universalAccessScope } from "@/ports/universal-agent";

import {
  UniversalCapabilityRegistry,
  type UniversalCapabilityDefinition,
  type UniversalCapabilityAuditPort,
  type UniversalReadCapabilityKey,
} from "./capability-registry";

const TIMEOUT_MS = 5_000;
const MAX_PAGE = 200;

export function createUniversalReadCapabilityRegistry(
  port: UniversalAgentReadPort,
  clock: ScenarioClock = createSystemScenarioClock(),
  audit?: UniversalCapabilityAuditPort,
): UniversalCapabilityRegistry {
  const registry = new UniversalCapabilityRegistry(audit);
  const register = <K extends UniversalReadCapabilityKey>(
    definition: Omit<
      UniversalCapabilityDefinition<K>,
      "timeoutMs" | "maxPagination" | "resourceScope" | "completeness" | "freshness" | "citations" | "safeErrorCodes"
    >,
  ) => registry.register({
    ...definition,
    timeoutMs: TIMEOUT_MS,
    maxPagination: definition.key === "analysis.forecast" ? 5_000 : MAX_PAGE,
    resourceScope: capabilityScope(definition.key),
    completeness: "PORT_ENFORCED",
    freshness: definition.key.startsWith("material.") || definition.key.startsWith("analysis.")
      ? "SOURCE_SNAPSHOT"
      : "REQUEST_TIME",
    citations: "REQUIRED_FOR_FACTS",
    safeErrorCodes: [
      "UNIVERSAL_CAPABILITY_FORBIDDEN",
      "UNIVERSAL_CAPABILITY_TIMEOUT",
      "UNIVERSAL_CAPABILITY_VALIDATION_FAILED",
      "UNIVERSAL_CAPABILITY_EXECUTION_FAILED",
    ],
  });

  register({
    key: "project.search",
    requiredPermissions: ["project.read"],
    execute: async (context, input) => {
      const projects = await port.listProjects(context, universalAccessScope(context), { limit: input.limit });
      return resolveEntity(input.query, projects);
    },
  });
  register({
    key: "project.get",
    requiredPermissions: ["project.read"],
    execute: async (context, input) => {
      const projects = await port.listProjects(context, universalAccessScope(context), { limit: MAX_PAGE });
      return projects.find((project) => project.id === input.projectId) ?? null;
    },
  });
  register({
    key: "project.list",
    requiredPermissions: ["project.read"],
    execute: (context, input) => port.listProjects(context, universalAccessScope(context), {
      statuses: input.status,
      limit: input.limit,
    }),
  });
  register({
    key: "project.getState",
    requiredPermissions: ["project.read"],
    execute: async (context, input) => {
      const projects = await port.listProjects(context, universalAccessScope(context), { limit: MAX_PAGE });
      return projects.find((project) => project.id === input.projectId) ?? null;
    },
  });
  register({
    key: "project.listDeadlines",
    requiredPermissions: ["project.read"],
    execute: async (context, input) => {
      const projects = await port.listProjects(context, universalAccessScope(context), {
        dueBefore: input.dueBefore,
        limit: input.limit,
      });
      return projects
        .filter((project) => !input.projectId || project.id === input.projectId)
        .flatMap((project) => project.deadlines.map((deadline) => ({ project, deadline })));
    },
  });
  register({
    key: "project.listSpecifications",
    requiredPermissions: ["specification.read"],
    execute: (context, input) => port.listSpecifications(context, universalAccessScope(context), {
      businessProjectId: input.projectId,
      purpose: input.purpose,
      limit: input.limit,
    }),
  });
  register({
    key: "project.listMaterials",
    requiredPermissions: ["specification.read", "catalog.read", "stock.search"],
    execute: async (context, input) => {
      const scope = universalAccessScope(context);
      const positions = await port.listPositions(context, scope, {
        businessProjectId: input.projectId,
        equipmentType: input.equipmentType,
        limit: input.limit,
      });
      return port.searchMaterials(context, scope, {
        materialCodes: [...new Set(positions.map((position) => position.materialCode))],
        limit: input.limit,
      });
    },
  });
  register({
    key: "project.getMaterialCoverage",
    requiredPermissions: ["specification.read", "catalog.read", "stock.search"],
    execute: async (context, input) => projectMaterialInputs(port, context, input.projectId, {
      materialCode: input.materialCode,
      equipmentType: input.equipmentType,
      limit: input.limit,
    }),
  });
  register({
    key: "project.getRisks",
    requiredPermissions: ["project.read", "specification.read", "catalog.read", "stock.search", "analysis.read"],
    execute: (context, input) => projectMaterialInputs(port, context, input.projectId),
  });
  register({
    key: "project.getKpiSla",
    requiredPermissions: ["project.read", "specification.read", "analysis.read"],
    execute: async (context, input) => {
      const rows = await port.listIntakes(context, universalAccessScope(context), {
        businessProjectId: input.projectId,
        limit: MAX_PAGE,
      });
      return {
        total: rows.length,
        completed: rows.filter((item) => item.status === "COMPLETED").length,
        failed: rows.filter((item) => item.status === "FAILED").length,
        needsReview: rows.filter((item) => item.status === "NEEDS_REVIEW").length,
        slaBreaches: rows.filter((item) => Date.parse(item.slaDeadline) < Date.parse(input.asOf)).length,
        items: rows,
      };
    },
  });

  register({
    key: "specification.search",
    requiredPermissions: ["specification.read"],
    execute: (context, input) => port.listSpecifications(context, universalAccessScope(context), {
      businessProjectId: input.projectId,
      text: input.query,
      limit: input.limit,
    }),
  });
  register({
    key: "specification.getCurrentVersion",
    requiredPermissions: ["specification.read", "specification.history.read"],
    execute: async (context, input) => {
      const scope = universalAccessScope(context);
      const specifications = await port.listSpecifications(context, scope, {
        text: input.specificationId,
        limit: MAX_PAGE,
      });
      const specification = specifications.find((item) => item.specificationId === input.specificationId) ?? null;
      if (!specification) return null;
      const versions = await port.listSpecificationVersions(context, scope, specification.specificationId);
      return {
        specification,
        currentVersion: versions.find((version) => version.isCurrent) ?? null,
        previousVersion: input.includePrevious
          ? versions.find((version) => !version.isCurrent) ?? null
          : null,
      };
    },
  });
  register({
    key: "specification.getPositions",
    requiredPermissions: ["specification.read"],
    execute: (context, input) => port.listPositions(context, universalAccessScope(context), {
      specificationId: input.specificationId,
      equipmentType: input.equipmentType,
      limit: input.limit,
    }),
  });
  register({
    key: "specification.getWhereUsed",
    requiredPermissions: ["specification.read"],
    execute: async (context, input) => {
      const scope = universalAccessScope(context);
      const specifications = await port.listSpecifications(context, scope, {
        text: input.specificationId,
        limit: MAX_PAGE,
      });
      const specification = specifications.find((item) => item.specificationId === input.specificationId) ?? null;
      if (!specification) return null;
      const projects = await port.listProjects(context, scope, { limit: MAX_PAGE });
      return {
        specification,
        project: projects.find((project) => project.id === specification.businessProjectId) ?? null,
      };
    },
  });
  register({
    key: "specification.countReceived",
    requiredPermissions: ["specification.read"],
    execute: (context, input) => port.listIntakes(context, universalAccessScope(context), {
      businessProjectId: input.projectId,
      receivedFrom: input.from,
      receivedTo: input.to,
      limit: MAX_PAGE,
    }),
  });
  register({
    key: "specification.getProcessingQueue",
    requiredPermissions: ["specification.read"],
    execute: (context, input) => port.listIntakes(context, universalAccessScope(context), {
      businessProjectId: input.projectId,
      statuses: ["RECEIVED", "VALIDATING", "QUEUED", "PROCESSING", "NEEDS_REVIEW", "FAILED"],
      limit: input.limit,
    }),
  });
  register({
    key: "specification.getStatusBreakdown",
    requiredPermissions: ["specification.read"],
    execute: (context, input) => port.listIntakes(context, universalAccessScope(context), {
      businessProjectId: input.projectId,
      receivedFrom: input.from,
      receivedTo: input.to,
      limit: MAX_PAGE,
    }),
  });
  register({
    key: "specification.getSlaBreaches",
    requiredPermissions: ["specification.read"],
    execute: async (context, input) => {
      const items = await port.listIntakes(context, universalAccessScope(context), {
        businessProjectId: input.projectId,
        statuses: ["RECEIVED", "VALIDATING", "QUEUED", "PROCESSING", "NEEDS_REVIEW", "FAILED"],
        limit: input.limit,
      });
      return items.filter((item) => Date.parse(item.slaDeadline) < Date.parse(input.asOf));
    },
  });

  register({
    key: "material.search",
    requiredPermissions: ["catalog.read", "stock.search"],
    execute: (context, input) => port.searchMaterials(context, universalAccessScope(context), {
      text: input.query,
      equipmentType: input.equipmentType,
      limit: input.limit,
    }),
  });
  register({
    key: "material.get",
    requiredPermissions: ["catalog.read", "stock.search"],
    execute: async (context, input) => (await material(port, context, input.materialCode)) ?? null,
  });
  register({
    key: "material.getStock",
    requiredPermissions: ["catalog.read", "stock.search"],
    execute: async (context, input) => (await material(port, context, input.materialCode))?.stock ?? null,
  });
  register({
    key: "material.getMovements",
    requiredPermissions: ["catalog.read", "stock.search"],
    execute: async (context, input) => (await material(port, context, input.materialCode))
      ?.weeklyMovements.slice(-input.weeks) ?? [],
  });
  register({
    key: "material.getInbound",
    requiredPermissions: ["catalog.read", "stock.search"],
    execute: async (context, input) => (await material(port, context, input.materialCode))
      ?.inboundSupplies ?? [],
  });
  register({
    key: "material.getReservations",
    requiredPermissions: ["catalog.read", "stock.search"],
    execute: async (context, input) => {
      const value = await material(port, context, input.materialCode);
      return value ? {
        reservedQuantity: value.stock.reservedQuantity,
        quarantinedQuantity: value.stock.quarantinedQuantity,
        unit: value.unit,
        snapshotId: value.stock.snapshotId,
      } : null;
    },
  });
  register({
    key: "material.getWhereUsed",
    requiredPermissions: ["specification.read", "catalog.read"],
    execute: (context, input) => port.listPositions(context, universalAccessScope(context), {
      materialCode: input.materialCode,
      limit: input.limit,
    }),
  });
  register({
    key: "material.forecastExhaustion",
    requiredPermissions: ["catalog.read", "stock.search"],
    execute: async (context, input) => {
      const value = await material(port, context, input.materialCode);
      return value ? materialForecast(value, input.horizonDays) : null;
    },
  });

  register({
    key: "catalog.getBom",
    requiredPermissions: ["catalog.read", "catalog.bom.read", "stock.search"],
    execute: (context, input) => port.listBom(context, universalAccessScope(context), input.materialCode),
  });
  register({
    key: "catalog.getSubstitutes",
    requiredPermissions: ["catalog.read", "catalog.substitutes.read", "stock.search"],
    execute: async (context, input) => {
      const source = await material(port, context, input.materialCode);
      if (!source?.familyId) return [];
      return port.searchMaterials(context, universalAccessScope(context), {
        familyId: source.familyId,
        itemKind: source.itemKind,
        limit: input.limit,
      });
    },
  });
  register({
    key: "compatibility.evaluate",
    requiredPermissions: ["catalog.read", "catalog.substitutes.read", "stock.search"],
    execute: async (context, input) => {
      const [source, candidate] = await Promise.all([
        material(port, context, input.sourceMaterialCode),
        material(port, context, input.candidateMaterialCode),
      ]);
      if (!source || !candidate) return null;
      return evaluateTechnicalCompatibility({
        source: compatibilityItem(source),
        candidate: compatibilityItem(candidate),
        candidateAvailableQuantity: netAvailable(candidate),
        requiredQuantity: input.requiredQuantity,
        normativeBasis: source.familyId && source.familyId === candidate.familyId
          ? `Квалифицированное семейство ${source.familyId} · technical-family-v1`
          : null,
      });
    },
  });
  register({
    key: "reliability.compare",
    requiredPermissions: ["catalog.read", "catalog.substitutes.read", "stock.search"],
    execute: async (context, input) => {
      const [source, candidate] = await Promise.all([
        material(port, context, input.sourceMaterialCode),
        material(port, context, input.candidateMaterialCode),
      ]);
      return compareReliability(source?.reliability ?? null, candidate?.reliability ?? null, input.operatingHours);
    },
  });
  register({
    key: "analysis.projectSummary",
    requiredPermissions: ["project.read", "specification.read", "catalog.read", "stock.search", "analysis.read"],
    execute: (context, input) => projectMaterialInputs(port, context, input.projectId),
  });
  register({
    key: "analysis.rootCause",
    requiredPermissions: ["project.read", "specification.read", "catalog.read", "stock.search", "analysis.read"],
    execute: (context, input) => projectMaterialInputs(port, context, input.projectId, {
      materialCode: input.materialCode,
    }),
  });
  register({
    key: "analysis.forecast",
    requiredPermissions: ["catalog.read", "stock.search", "analysis.read"],
    execute: async (context, input) => {
      if (input.projectId) {
        return projectMaterialInputs(port, context, input.projectId, {
          materialCode: input.materialCode,
        });
      }
      const value = input.materialCode ? await material(port, context, input.materialCode) : null;
      return value ? materialForecast(value, input.horizonDays) : null;
    },
  });
  register({
    key: "analysis.compareScenarios",
    requiredPermissions: ["project.read", "specification.read", "catalog.read", "stock.search", "analysis.read"],
    execute: async (context, input) => ({
      baseline: await projectMaterialInputs(port, context, input.projectId),
      alternative: {
        kind: "INBOUND_DELAY",
        delayedInboundDays: input.delayedInboundDays,
      },
    }),
  });
  register({
    key: "analysis.reorderRecommendations",
    requiredPermissions: ["analysis.read", "specification.read", "catalog.read", "stock.search"],
    execute: (context, input) => projectMaterialInputs(port, context, input.projectId, {
      equipmentType: input.equipmentType,
      limit: input.limit,
    }),
  });
  register({
    key: "analysis.replacementRecommendations",
    requiredPermissions: ["analysis.read", "specification.read", "catalog.read", "catalog.substitutes.read", "stock.search"],
    execute: async (context, input) => {
      const source = await projectMaterialInputs(port, context, input.projectId, {
        materialCode: input.materialCode,
        limit: input.limit,
      });
      const families = [...new Set(source.materials.flatMap((item) => item.familyId ? [item.familyId] : []))];
      const candidatePages = await Promise.all(families.map((familyId) =>
        port.searchMaterials(context, universalAccessScope(context), {
          familyId,
          limit: input.limit,
        })));
      return { ...source, candidates: candidatePages.flat() };
    },
  });
  register({
    key: "process.getQueue",
    requiredPermissions: ["specification.read"],
    execute: (context, input) => port.listIntakes(context, universalAccessScope(context), {
      businessProjectId: input.projectId,
      statuses: ["RECEIVED", "VALIDATING", "QUEUED", "PROCESSING", "NEEDS_REVIEW", "FAILED"],
      limit: input.limit,
    }),
  });
  register({
    key: "process.getRuns",
    requiredPermissions: ["analysis.read"],
    execute: async (context, input) => {
      const scope = universalAccessScope(context);
      const specificationIds = input.projectId
        ? (await port.listSpecifications(context, scope, {
            businessProjectId: input.projectId,
            limit: MAX_PAGE,
          })).map((item) => item.specificationId)
        : undefined;
      return port.listRuns(context, scope, {
        specificationIds,
        statuses: input.status,
        limit: input.limit,
      });
    },
  });
  register({
    key: "task.listMine",
    requiredPermissions: ["review.read"],
    execute: (context, input) => port.listTasks(context, universalAccessScope(context), {
      assigneeUserId: context.trusted.subjectId,
      statuses: input.status,
      limit: input.limit,
    }),
  });
  register({
    key: "task.listProject",
    requiredPermissions: ["review.queue.read"],
    execute: (context, input) => {
      if (input.projectId !== context.trusted.activeProjectId) {
        throw new Error("UNIVERSAL_BUSINESS_PROJECT_TASK_SCOPE_DENIED");
      }
      return port.listTasks(context, universalAccessScope(context), {
        statuses: input.status,
        limit: input.limit,
      });
    },
  });
  register({
    key: "deadline.listUpcoming",
    requiredPermissions: ["project.read"],
    execute: async (context, input) => {
      const now = clock.now().getTime();
      const dueBefore = new Date(now + input.withinDays * 86_400_000).toISOString();
      const projects = await port.listProjects(context, universalAccessScope(context), { dueBefore, limit: input.limit });
      return projects
        .filter((project) => !input.projectId || project.id === input.projectId)
        .flatMap((project) => project.deadlines
          .filter((deadline) => Date.parse(deadline.dueAt) <= Date.parse(dueBefore))
          .map((deadline) => ({ project, deadline })));
    },
  });

  return registry;
}

function capabilityScope(key: UniversalReadCapabilityKey): UniversalCapabilityDefinition<UniversalReadCapabilityKey>["resourceScope"] {
  if (key === "task.listMine") return "PERSONAL";
  if (key.startsWith("material.") || key.startsWith("catalog.") || key.startsWith("compatibility.") || key.startsWith("reliability.")) {
    return "CATALOG_SOURCE";
  }
  if (key === "project.list" || key === "project.search" || key === "specification.countReceived" || key === "process.getQueue" || key === "deadline.listUpcoming") {
    return "ACCESS_PROJECT";
  }
  return "BUSINESS_PROJECT";
}

function materialForecast(value: UniversalMaterialRecord, horizonDays: number) {
  const averageWeeklyConsumption = value.weeklyMovements.length
    ? value.weeklyMovements.reduce((total, movement) => total + movement.consumptionQuantity, 0) /
      value.weeklyMovements.length
    : 0;
  const availableQuantity = netAvailable(value);
  const daysToExhaustion = averageWeeklyConsumption <= 0
    ? null
    : Math.floor(availableQuantity / (averageWeeklyConsumption / 7));
  return {
    materialCode: value.materialCode,
    horizonDays,
    averageWeeklyConsumption,
    daysToExhaustion,
    atRisk: daysToExhaustion !== null && daysToExhaustion <= horizonDays,
    sourceWeeks: value.weeklyMovements.length,
    snapshotId: value.stock.snapshotId,
    observedAt: value.asOf,
  };
}

export async function projectMaterialInputs(
  port: UniversalAgentReadPort,
  context: AgentExecutionContext,
  projectId: string,
  query: Readonly<{ materialCode?: string; equipmentType?: string; limit?: number }> = {},
) {
  const scope = universalAccessScope(context);
  const positions: Awaited<ReturnType<UniversalAgentReadPort["listPositions"]>>[number][] = [];
  const pageSize = Math.min(MAX_PAGE, query.limit ?? MAX_PAGE);
  for (let offset = 0; ; offset += pageSize) {
    const page = await port.listPositions(context, scope, {
      businessProjectId: projectId,
      materialCode: query.materialCode,
      equipmentType: query.equipmentType,
      limit: pageSize,
      offset,
    });
    positions.push(...page);
    if (page.length < pageSize) break;
  }
  const materialCodes = [...new Set(positions.map((position) => position.materialCode))];
  const materialChunks = chunk(materialCodes, MAX_PAGE);
  const [materialPages, allocations, projects] = await Promise.all([
    Promise.all(materialChunks.map((codes) =>
      port.searchMaterials(context, scope, { materialCodes: codes, limit: MAX_PAGE }))),
    materialCodes.length
      ? port.listAllocations(context, scope, { materialCodes })
      : Promise.resolve([]),
    port.listProjects(context, scope, { limit: MAX_PAGE }),
  ]);
  const materials = materialPages.flat();
  const project = projects.find((candidate) => candidate.id === projectId);
  if (!project) return { project: null, positions: [], materials: [], allocations: [] };
  return { project, positions, materials, allocations };
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function material(
  port: UniversalAgentReadPort,
  context: AgentExecutionContext,
  materialCode: string,
): Promise<UniversalMaterialRecord | null> {
  return (await port.searchMaterials(context, universalAccessScope(context), {
    materialCode,
    limit: 2,
  }))[0] ?? null;
}

function compatibilityItem(materialRecord: UniversalMaterialRecord): CompatibilityItem {
  return {
    materialCode: materialRecord.materialCode,
    equipmentType: materialRecord.equipmentType,
    itemKind: materialRecord.itemKind,
    familyId: materialRecord.familyId,
    unit: materialRecord.unit,
    standard: materialRecord.standard || null,
    materialGrade: materialRecord.materialGrade || null,
    manufacturer: materialRecord.manufacturer || null,
    characteristics: materialRecord.characteristics,
    compatibilityStatus: materialRecord.compatibilityStatus,
  };
}

function netAvailable(materialRecord: UniversalMaterialRecord): number {
  return Math.max(
    0,
    materialRecord.stock.onHandQuantity -
      materialRecord.stock.reservedQuantity -
      materialRecord.stock.quarantinedQuantity -
      materialRecord.stock.committedToOtherNeeds,
  );
}
