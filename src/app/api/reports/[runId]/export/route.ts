import { getRepository } from "@/adapters/persistence/repository";
import {
  exportReportJson,
  exportReportPdf,
  exportReportXlsx,
  getReport,
  ReportError,
  type ReportView,
} from "@/application/report-service";
import { ScenarioServiceError } from "@/application/scenario-service";
import { createAuditCorrelationId } from "@/lib/audit-request";
import { ApiError, toErrorResponse } from "@/lib/api";
import { requireDemoRole } from "@/lib/session";

export async function GET(request: Request, { params }: RouteContext<"/api/reports/[runId]/export">) {
  const correlationId = createAuditCorrelationId();
  let auditContext: ExportAuditContext | null = null;
  let auditAttempted = false;
  try {
    const [{ runId }, { user }] = await Promise.all([params, requireDemoRole("USER")]);
    const requestedFormat = new URL(request.url).searchParams.get("format") ?? "json";
    const format = exportFormat(requestedFormat);
    auditContext = {
      userId: user.id,
      actorDisplayName: user.displayName,
      runId: safeAuditRunId(runId),
      format,
      correlationId,
      report: null,
    };
    const { report } = await getReport(user.id, runId);
    auditContext.report = report;
    const safeId = runId.replace(/[^a-zA-Z0-9_-]/g, "").slice(-48);
    let response: Response;
    if (format === "json") response = fileResponse(await exportReportJson(report), "application/json; charset=utf-8", `mtr-report-${safeId}.json`);
    else if (format === "xlsx") response = fileResponse(await exportReportXlsx(report), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `mtr-report-${safeId}.xlsx`);
    else if (format === "pdf") response = fileResponse(await exportReportPdf(report), "application/pdf", `mtr-report-${safeId}.pdf`);
    else throw new ApiError(400, "UNSUPPORTED_EXPORT_FORMAT", "Доступны форматы json, xlsx и pdf");

    auditAttempted = true;
    await writeExportAudit(auditContext, "SUCCESS");
    return response;
  } catch (error) {
    if (auditContext && !auditAttempted) {
      auditAttempted = true;
      try {
        await writeExportAudit(auditContext, "FAILURE", exportErrorCode(error));
      } catch (auditError) {
        return toErrorResponse(auditError);
      }
    }
    return exportErrorResponse(error);
  }
}

function fileResponse(bytes: Uint8Array, contentType: string, name: string): Response {
  return new Response(bytes as BodyInit, { headers: { "content-type": contentType, "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}

type ExportFormat = "json" | "xlsx" | "pdf" | "UNSUPPORTED";

interface ExportAuditContext {
  userId: string;
  actorDisplayName: string;
  runId: string;
  format: ExportFormat;
  correlationId: string;
  report: ReportView | null;
}

async function writeExportAudit(
  context: ExportAuditContext,
  outcome: "SUCCESS" | "FAILURE",
  errorCode?: string,
): Promise<void> {
  const sourceVersions = context.report ? reportSourceVersions(context.report) : null;
  await (await getRepository()).writeAudit(context.userId, {
    actorDisplayName: context.actorDisplayName,
    action: outcome === "SUCCESS" ? "REPORT_EXPORT_SUCCEEDED" : "REPORT_EXPORT_FAILED",
    entityType: "REPORT_EXPORT",
    entityId: context.runId,
    outcome,
    requestId: context.correlationId,
    details: {
      correlationId: context.correlationId,
      runId: context.runId,
      format: context.format,
      reportSchemaVersion: context.report?.schemaVersion ?? null,
      reportGeneratedAt: context.report?.generatedAt ?? null,
      sourceVersions,
      ...(errorCode ? { errorCode } : {}),
    },
  });
}

function reportSourceVersions(report: ReportView): Record<string, unknown> {
  const prompt = asRecord(report.provenance.prompt);
  return {
    appius: safeScalar(report.provenance.appius),
    appiusVersions: safeVersionList(report.provenance.appiusVersions),
    sap: safeScalar(report.provenance.sap),
    normative: safeScalar(report.provenance.normative),
    promptVersion: safeScalar(prompt?.version),
    responsibilityRules: safeVersionList(report.provenance.responsibilityRules),
    analogueRules: safeVersionList(report.provenance.analogueRules),
  };
}

function safeVersionList(value: unknown): Array<Record<string, string | number>> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) return [];
    const safe = Object.fromEntries(
      ["specificationId", "versionId", "versionNumber", "documentId", "version", "clauseId"]
        .flatMap((key) => {
          const current = record[key];
          return typeof current === "string" || typeof current === "number" ? [[key, current]] : [];
        }),
    );
    return Object.keys(safe).length > 0 ? [safe] : [];
  });
}

function safeScalar(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exportFormat(value: string): ExportFormat {
  return value === "json" || value === "xlsx" || value === "pdf" ? value : "UNSUPPORTED";
}

function safeAuditRunId(value: string): string {
  return /^[A-Za-z0-9_-]{1,96}$/u.test(value) ? value : "INVALID_RUN_ID";
}

function exportErrorCode(error: unknown): string {
  if (error instanceof ApiError || error instanceof ReportError || error instanceof ScenarioServiceError) {
    return error.code;
  }
  return "INTERNAL_ERROR";
}

function exportErrorResponse(error: unknown): Response {
  if (error instanceof ReportError || error instanceof ScenarioServiceError) {
    return toErrorResponse(new ApiError(error.status, error.code, error.message));
  }
  return toErrorResponse(error);
}
