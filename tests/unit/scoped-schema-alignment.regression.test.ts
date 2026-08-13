import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  catalogBomComponents,
  catalogInterchangeabilityFamilies,
  catalogItems,
  catalogStockBalances,
  integrationStates,
  normativeChunks,
  normativeDocuments,
  positionAnalysisResults,
  sapMaterials,
  sapStockBalances,
  scenarioRunSteps,
  scenarioRuns,
  specificationPositions,
  specifications,
  specificationVersions,
  uploadedFiles,
} from "@/adapters/persistence/schema";

const SNAPSHOT_TABLE_COLUMNS = {
  "public.specifications": "project_id",
  "public.specification_versions": "project_id",
  "public.specification_positions": "project_id",
  "public.scenario_runs": "project_id",
  "public.scenario_run_steps": "project_id",
  "public.position_analysis_results": "project_id",
  "public.uploaded_files": "project_id",
  "public.catalog_interchangeability_families": "catalog_scope_id",
  "public.catalog_items": "catalog_scope_id",
  "public.catalog_stock_balances": "catalog_scope_id",
  "public.catalog_bom_components": "catalog_scope_id",
  "public.sap_materials": "source_scope_id",
  "public.sap_stock_balances": "source_scope_id",
  "public.normative_documents": "source_scope_id",
  "public.normative_chunks": "source_scope_id",
  "public.integration_states": "source_scope_id",
} as const;

describe("typed scope columns from immutable migration 0005", () => {
  it("exposes every project, catalogue and source scope in the Drizzle schema", () => {
    expect([
      specifications.projectId,
      specificationVersions.projectId,
      specificationPositions.projectId,
      scenarioRuns.projectId,
      scenarioRunSteps.projectId,
      positionAnalysisResults.projectId,
      uploadedFiles.projectId,
    ].map((column) => column.name)).toEqual(Array(7).fill("project_id"));

    expect([
      catalogInterchangeabilityFamilies.catalogScopeId,
      catalogItems.catalogScopeId,
      catalogStockBalances.catalogScopeId,
      catalogBomComponents.catalogScopeId,
    ].map((column) => column.name)).toEqual(Array(4).fill("catalog_scope_id"));

    expect([
      sapMaterials.sourceScopeId,
      sapStockBalances.sourceScopeId,
      normativeDocuments.sourceScopeId,
      normativeChunks.sourceScopeId,
      integrationStates.sourceScopeId,
    ].map((column) => column.name)).toEqual(Array(5).fill("source_scope_id"));
  });

  it("keeps the latest checked-in snapshot aligned without a duplicate migration", async () => {
    const snapshot = JSON.parse(
      await readFile(resolve(process.cwd(), "drizzle/meta/0006_snapshot.json"), "utf8"),
    ) as { tables: Record<string, { columns: Record<string, unknown> }> };

    for (const [table, column] of Object.entries(SNAPSHOT_TABLE_COLUMNS)) {
      expect(snapshot.tables[table]?.columns).toHaveProperty(column);
    }
  });
});
