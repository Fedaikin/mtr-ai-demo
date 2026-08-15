import { AgentCaseServiceError } from "@/application/agent-orchestrator/case-service";
import { ApiError, toErrorResponse } from "@/lib/api";

export function caseErrorResponse(error: unknown) {
  if (error instanceof AgentCaseServiceError) {
    const status = error.code === "AGENT_CASE_NOT_FOUND"
      ? 404
      : error.code.endsWith("DENIED")
        ? 403
        : 400;
    return toErrorResponse(new ApiError(status, error.code, error.message));
  }
  return toErrorResponse(error);
}
