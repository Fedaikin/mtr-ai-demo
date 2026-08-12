import { z } from "zod";

import { getRepository } from "@/adapters/persistence/repository";
import { canonicalizeManualSapImport, ManualImportError } from "@/application/manual-import";
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
    const canonical = canonicalizeManualSapImport(file.normalizedData, {
      userId: user.id,
      checksumSha256: file.checksumSha256,
      acceptedAt: new Date().toISOString(),
    });
    await repository.writeAudit(user.id, { action: "MANUAL_SAP_IMPORT_VALIDATED", entityType: "UPLOADED_FILE", entityId: file.id, outcome: "SUCCESS", details: { rowCount: canonical.materials.length, snapshotId: canonical.snapshotId, checksumSha256: file.checksumSha256 } });
    return ok({ uploadedFileId: file.id, snapshotId: canonical.snapshotId, rowCount: canonical.materials.length, warnings: canonical.warnings, sourceKind: "UPLOADED_FILE" });
  } catch (error) {
    if (error instanceof ManualImportError) return toErrorResponse(new ApiError(400, error.code, error.message));
    return toErrorResponse(error);
  }
}
