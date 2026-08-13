import { can, type TrustedRequestContext } from "@/application/authorization-service";
import type { Position, ScenarioRun, SapMaterial, Specification } from "@/domain/models";

export interface SavedAgentCitation {
  readonly sourceSystem: string;
  readonly entityId: string;
  readonly versionOrSnapshot: string;
  readonly clauseId: string | null;
}

export interface AgentCitationReadPort {
  getSpecification(userId: string, specificationId: string): Promise<Specification | null>;
  getPosition(userId: string, positionId: string): Promise<Position | null>;
  getSapMaterialStock(userId: string, materialCode: string): Promise<SapMaterial[]>;
  getCatalogItemByCode(userId: string, itemCode: string): Promise<unknown | null>;
  getScenarioRunInProject(userId: string, projectId: string, runId: string): Promise<ScenarioRun | null>;
  listNormativeChunks(
    userId: string,
    options?: { limit?: number },
  ): Promise<readonly { documentId: string }[]>;
  listAgentMetricEvents(
    userId: string,
    query: { projectId: string; from: string; to: string },
  ): Promise<readonly { id: string }[]>;
  listMaterialMovements(
    userId: string,
    query: {
      projectId: string;
      from: string;
      to: string;
      warehouseIds: readonly string[];
    },
  ): Promise<readonly { id: string }[]>;
  listAnalysisReviewTasksInProject(
    userId: string,
    projectId: string,
  ): Promise<readonly { id: string }[]>;
}

/**
 * Re-authorizes every saved citation against the current request context.
 * Missing or revoked sources are omitted without exposing their existence.
 */
export async function reauthorizeSavedAgentCitations<T extends SavedAgentCitation>(
  context: TrustedRequestContext,
  repository: AgentCitationReadPort,
  citations: readonly T[],
): Promise<T[]> {
  const unique = new Map<string, T>();
  for (const citation of citations) unique.set(citationKey(citation), citation);
  const reads = new Map<string, Promise<unknown>>();
  const decisions = await Promise.all(
    [...unique.values()].map(async (citation) => ({
      citation,
      readable: await isReadable(context, repository, citation, reads),
    })),
  );
  const readable = new Set(
    decisions.filter((decision) => decision.readable).map((decision) => citationKey(decision.citation)),
  );
  return citations.filter((citation) => readable.has(citationKey(citation)));
}

function citationKey(citation: SavedAgentCitation): string {
  return [citation.sourceSystem, citation.entityId, citation.versionOrSnapshot, citation.clauseId ?? ""]
    .join("\u0000");
}

async function isReadable(
  context: TrustedRequestContext,
  repository: AgentCitationReadPort,
  citation: SavedAgentCitation,
  reads: Map<string, Promise<unknown>>,
): Promise<boolean> {
  const projectId = context.activeProjectId;
  if (!projectId) return false;
  switch (citation.sourceSystem) {
    case "APPIUS": {
      if (!can(context, "specification.read", { resourceType: "specification", resourceId: citation.entityId, projectId })) return false;
      if (!context.sourceScopeIds.includes("demo-system-config-001")) return false;
      if (citation.entityId === "integration-state") return true;
      const specification = await repository.getSpecification(context.subjectId, citation.entityId);
      if (specification) return specification.projectId === projectId;
      const position = await repository.getPosition(context.subjectId, citation.entityId);
      return position?.projectId === projectId;
    }
    case "SAP": {
      if (!can(context, "stock.search", { resourceType: "stock", resourceId: citation.entityId, projectId })) return false;
      if (!context.sourceScopeIds.includes("demo-sap-001")) return false;
      const warehouseIds = new Set(context.accessClaims.warehouseIds ?? []);
      if (warehouseIds.size === 0) return false;
      if (citation.entityId === "integration-state" || citation.entityId.startsWith("stock-search:")) return true;
      if (citation.entityId.startsWith("movement-")) {
        const movements = await memoizedRead(reads, "material-movements", () =>
          repository.listMaterialMovements(context.subjectId, {
            projectId,
            warehouseIds: [...warehouseIds],
            from: "1970-01-01T00:00:00.000Z",
            to: "9999-12-31T23:59:59.999Z",
          }));
        return movements.some((movement) => movement.id === citation.entityId);
      }
      const stock = await repository.getSapMaterialStock(context.subjectId, citation.entityId);
      return stock.some((item) => warehouseIds.has(item.storageLocation));
    }
    case "CATALOG": {
      if (!can(context, "catalog.read", { resourceType: "catalog", resourceId: citation.entityId, projectId })) return false;
      if (context.catalogScopeIds.length === 0) return false;
      if (!citation.entityId.startsWith("CAT-DEMO-")) return true;
      return (await repository.getCatalogItemByCode(context.subjectId, citation.entityId)) !== null;
    }
    case "NORMATIVE":
    case "RAG": {
      if (!context.sourceScopeIds.includes("demo-normative-001")) return false;
      if (!context.permissionKeys.has("specification.read") && !context.permissionKeys.has("analysis.read")) return false;
      const chunks = await memoizedRead(reads, "normative", () =>
        repository.listNormativeChunks(context.subjectId, { limit: 500 }));
      return chunks.some((chunk) => chunk.documentId === citation.entityId);
    }
    case "SCENARIO":
    case "REPORT": {
      const permission = citation.sourceSystem === "REPORT" ? "report.read" : "analysis.read";
      if (!can(context, permission, { resourceType: "scenario_run", resourceId: citation.entityId, projectId })) return false;
      return (await repository.getScenarioRunInProject(context.subjectId, projectId, citation.entityId)) !== null;
    }
    case "PROCESS_ENGINE": {
      if (!can(context, "analysis.read", { resourceType: "process_event", resourceId: citation.entityId, projectId })) return false;
      const events = await memoizedRead(reads, "process-events", () =>
        repository.listAgentMetricEvents(context.subjectId, {
          projectId,
          from: "1970-01-01T00:00:00.000Z",
          to: "9999-12-31T23:59:59.999Z",
        }));
      return events.some((event) => event.id === citation.entityId);
    }
    case "METRIC_REGISTRY":
    case "RISK_ENGINE":
      return can(context, "analysis.read", { resourceType: "agent_analytics", resourceId: citation.entityId, projectId });
    case "TASK_STORE": {
      if (!can(context, "review.read", { resourceType: "review_task", resourceId: citation.entityId, projectId, ownerUserId: context.subjectId })) return false;
      if (citation.entityId === `task-query:${context.subjectId}:${projectId}`) return true;
      const tasks = await memoizedRead(reads, "review-tasks", () =>
        repository.listAnalysisReviewTasksInProject(context.subjectId, projectId));
      return tasks.some((task) => task.id === citation.entityId);
    }
    default:
      return false;
  }
}

async function memoizedRead<T>(
  reads: Map<string, Promise<unknown>>,
  key: string,
  loader: () => Promise<T>,
): Promise<T> {
  const existing = reads.get(key);
  if (existing) return existing as Promise<T>;
  const pending = loader();
  reads.set(key, pending);
  return pending;
}
