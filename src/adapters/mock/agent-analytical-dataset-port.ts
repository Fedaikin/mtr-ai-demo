import { generateAgentAnalyticalDataset } from "@/adapters/mock/fixtures/agent-analytical-dataset";
import type { AnalyticalDatasetPort } from "@/application/agent-orchestrator/analytics/analytical-intelligence-service";

const ANALYTICAL_PROJECT_ID = "demo-project-001";

export function createModelAnalyticalDatasetPort(): AnalyticalDatasetPort {
  return {
    async load(projectId) {
      if (projectId !== ANALYTICAL_PROJECT_ID) throw new Error("ANALYTICAL_PROJECT_SCOPE_DENIED");
      return generateAgentAnalyticalDataset();
    },
  };
}
