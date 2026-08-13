import { randomUUID } from "node:crypto";

import { getRepository } from "@/adapters/persistence/repository";
import { storeUploadedBytes } from "@/adapters/storage/upload-storage";
import { parseUploadedFile, UploadParseError, validateUploadMime } from "@/application/file-parser";
import { ApiError, created, toErrorResponse } from "@/lib/api";
import { requirePermission } from "@/lib/session";

const MAX_SIZE_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const purpose = String(form.get("purpose") ?? "GENERAL").slice(0, 80);
    const { user } = await requirePermission(
      purpose.startsWith("SAP_") ? "stock.import" : "specification.upload",
    );
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "FILE_REQUIRED", "Выберите файл для загрузки");
    if (file.size <= 0 || file.size > MAX_SIZE_BYTES) throw new ApiError(413, "FILE_SIZE_LIMIT", "Размер файла должен быть от 1 байта до 10 МБ");
    validateUploadMime(file.name, file.type);
    const data = new Uint8Array(await file.arrayBuffer());
    const parsed = await parseUploadedFileSafely(file.name, data);
    const safeBase = file.name.normalize("NFKC").replace(/[^a-zA-Zа-яА-Я0-9._-]+/g, "-").replace(/^[-.]+/, "").slice(-120) || "upload.bin";
    const safeName = `${randomUUID()}-${safeBase}`;
    const storage = await storeUploadedBytes({ safeName, data, contentType: file.type || "application/octet-stream" });
    const repository = await getRepository();
    const saved = await repository.saveUploadedFile(user.id, {
      originalName: safeBase,
      safeName,
      extension: parsed.extension,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      checksumSha256: parsed.checksumSha256,
      storageUrl: storage.url,
      parseStatus: parsed.parseStatus,
      normalizedData: parsed.normalizedData,
    });
    await repository.writeAudit(user.id, {
      action: "FILE_UPLOADED_AND_PARSED",
      entityType: "UPLOADED_FILE",
      entityId: saved.id,
      outcome: "SUCCESS",
      details: { purpose, extension: parsed.extension, sizeBytes: file.size, provider: storage.provider, parseStatus: parsed.parseStatus },
    });
    return created({ id: saved.id, parseStatus: saved.parseStatus, normalizedData: saved.normalizedData, warnings: (saved.normalizedData as Record<string, unknown> | null)?.warnings ?? [] });
  } catch (error) {
    if (error instanceof UploadParseError) return toErrorResponse(new ApiError(400, error.code, error.message));
    return toErrorResponse(error);
  }
}

async function parseUploadedFileSafely(name: string, data: Uint8Array) {
  try {
    return await parseUploadedFile(name, data);
  } catch (error) {
    if (error instanceof UploadParseError) throw error;
    throw new UploadParseError(
      "UPLOAD_CORRUPT",
      "Файл повреждён или имеет неподдерживаемую внутреннюю структуру",
    );
  }
}
