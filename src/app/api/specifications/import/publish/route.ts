import { getRepository } from "@/adapters/persistence/repository";
import { validateSpecificationImport } from "@/application/specification-import";
import { ApiError, created, toErrorResponse } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { requireDemoRole } from "@/lib/session";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { user, authorization } = await requireDemoRole("USER");
    const body = await request.json() as Record<string, unknown>;
    const fileId = text(body.fileId, 200);
    const mode = body.mode === "NEW_VERSION" ? "NEW_VERSION" : body.mode === "NEW" ? "NEW" : null;
    if (!fileId || !mode) throw new ApiError(400, "INVALID_IMPORT_REQUEST", "Не указан файл или режим публикации");
    const repository = await getRepository();
    const file = await repository.getUploadedFile(user.id, fileId);
    if (!file) throw new ApiError(404, "UPLOAD_NOT_FOUND", "Загруженный файл не найден");
    if (file.parseStatus !== "PARSED" || !file.normalizedData) {
      throw new ApiError(409, "IMPORT_REVIEW_REQUIRED", "Файл требует ручной проверки и не может быть опубликован");
    }
    const validation = validateSpecificationImport(file.normalizedData);
    if (validation.totalRows === 0 || validation.positions.length === 0 || validation.errors.length > 0) {
      await repository.writeAudit(user.id, {
        action: "specification.import.validation_rejected",
        entityType: "UPLOADED_FILE",
        entityId: fileId,
        outcome: "REJECTED",
        details: {
          totalRows: validation.totalRows,
          validRows: validation.validRows,
          invalidRows: validation.invalidRows,
          errorCount: validation.errors.length,
        },
      });
      throw new ApiError(422, "IMPORT_VALIDATION_FAILED", "Исправьте ошибки распознавания перед публикацией");
    }
    const result = await repository.publishSpecificationImport(user.id, {
      fileId,
      projectId: authorization.activeProjectId ?? undefined,
      mode,
      projectCode: text(body.projectCode, 120),
      name: text(body.name, 300),
      specificationId: text(body.specificationId, 200),
      positions: validation.positions,
      validationSummary: {
        totalRows: validation.totalRows,
        validRows: validation.validRows,
        invalidRows: validation.invalidRows,
        warningCount: validation.warnings.length,
      },
    });
    return created(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}
