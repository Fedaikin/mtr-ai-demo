import { getReport, ReportError } from "@/application/report-service";
import { ApiError, ok, toErrorResponse } from "@/lib/api";
import { requirePermission } from "@/lib/session";

export async function GET(_request: Request, { params }: RouteContext<"/api/reports/[runId]">) {
  try {
    const [{ runId }, { user }] = await Promise.all([params, requirePermission("report.read")]);
    return ok((await getReport(user.id, runId)).report);
  } catch (error) {
    if (error instanceof ReportError) return toErrorResponse(new ApiError(error.status, error.code, error.message));
    return toErrorResponse(error);
  }
}
