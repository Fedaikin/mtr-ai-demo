import { z } from "zod";

import { getRepository } from "@/adapters/persistence/repository";
import { canonicalizeManualAppiusImport, ManualImportError } from "@/application/manual-import";
import { ApiError, ok, parseJson, toErrorResponse } from "@/lib/api";
import { requireDemoRole } from "@/lib/session";

const schema = z.object({ uploadedFileId: z.string().min(1).max(160) });

export async function POST(request: Request) {
  try {
    const [{ user }, body] = await Promise.all([requireDemoRole("USER"), parseJson(request)]);
    const { uploadedFileId } = schema.parse(body);
    const repository = await getRepository();
    const file = await repository.getUploadedFile(user.id, uploadedFileId);
    if (!file) throw new ApiError(404, "UPLOAD_NOT_FOUND", "Файл не найден");
    if (file.parseStatus !== "PARSED") throw new ApiError(409, "UPLOAD_REVIEW_REQUIRED", "Файл требует ручной проверки перед импортом");
    const [specification] = await repository.listSpecifications(user.id);
    if (!specification) throw new ApiError(409, "SPECIFICATION_NOT_FOUND", "Нет доступной спецификации для проверки импорта");
    const canonical = canonicalizeManualAppiusImport(file.normalizedData, {
      userId: user.id,
      checksumSha256: file.checksumSha256,
      acceptedAt: new Date().toISOString(),
      specificationId: specification.id,
      specificationName: `${specification.name} · ручной импорт`,
    });
    await repository.writeAudit(user.id, { action: "MANUAL_SPECIFICATION_IMPORT_VALIDATED", entityType: "UPLOADED_FILE", entityId: file.id, outcome: "SUCCESS", details: { positionCount: canonical.positions.length, versionId: canonical.versionId, checksumSha256: file.checksumSha256 } });
    return ok({ uploadedFileId: file.id, draftId: canonical.versionId, positionCount: canonical.positions.length, warnings: canonical.warnings, sourceKind: "UPLOADED_FILE" });
  } catch (error) {
    if (error instanceof ManualImportError) return toErrorResponse(new ApiError(400, error.code, error.message));
    return toErrorResponse(error);
  }
}
