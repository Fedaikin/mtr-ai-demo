import { getRepository } from "@/adapters/persistence/repository";
import { readUploadedBytes } from "@/adapters/storage/upload-storage";
import { ApiError, toErrorResponse } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { requireDemoRole } from "@/lib/session";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ user }, { id }] = await Promise.all([requireDemoRole("USER"), context.params]);
    const repository = await getRepository();
    const file = await repository.getUploadedFile(user.id, id);
    if (!file) throw new ApiError(404, "FILE_NOT_FOUND", "Файл не найден");

    const body = await readUploadedBytes(file.storageUrl);
    if (!body) throw new ApiError(404, "FILE_CONTENT_NOT_FOUND", "Содержимое файла недоступно");

    const responseBody = body instanceof Uint8Array
      ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer
      : body;

    return new Response(responseBody, {
      headers: {
        "content-type": file.mimeType || "application/octet-stream",
        "content-length": String(file.sizeBytes),
        "content-disposition": contentDisposition(file.originalName),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const [{ user }, { id }] = await Promise.all([requireDemoRole("USER"), context.params]);
    const repository = await getRepository();
    const file = await repository.getUploadedFile(user.id, id);
    if (!file) throw new ApiError(404, "FILE_NOT_FOUND", "Файл не найден");
    await repository.updateUploadedFile(user.id, id, { parseStatus: "CANCELLED" });
    await repository.writeAudit(user.id, {
      action: "specification.import.cancelled",
      entityType: "UPLOADED_FILE",
      entityId: id,
      outcome: "SUCCESS",
      details: { fileName: file.originalName, previousStatus: file.parseStatus },
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^a-zA-Z0-9._-]/g, "_") || "source-file";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
