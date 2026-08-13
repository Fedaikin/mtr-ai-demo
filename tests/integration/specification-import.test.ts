import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase } from "@/adapters/persistence/db";
import { getRepository } from "@/adapters/persistence/repository";
import { DEMO_USER_ID } from "@/domain/models";

describe.sequential("публикация импортированной спецификации", () => {
  beforeEach(async () => resetDemoDatabase(DEMO_USER_ID));
  afterAll(async () => closeDatabase());

  it("создаёт спецификацию, новую версию и сохраняет старые позиции", async () => {
    const repository = await getRepository();
    const upload1 = await repository.saveUploadedFile(DEMO_USER_ID, upload("upload-spec-1", "spec-v1.xlsx"));
    const first = await repository.publishSpecificationImport(DEMO_USER_ID, {
      fileId: upload1.id, mode: "NEW", projectCode: "PROJECT-USER", name: "Пользовательская спецификация",
      positions: [position("USR-001", 10), position("USR-002", 20)], validationSummary: { validRows: 2, invalidRows: 0 },
    });
    const upload2 = await repository.saveUploadedFile(DEMO_USER_ID, upload("upload-spec-2", "spec-v2.csv"));
    const second = await repository.publishSpecificationImport(DEMO_USER_ID, {
      fileId: upload2.id, mode: "NEW_VERSION", specificationId: first.specification.id,
      positions: [position("USR-001", 15), position("USR-003", 5)], validationSummary: { validRows: 2, invalidRows: 0 },
    });

    expect(second.version.versionNumber).toBe(2);
    expect(second.version.sourceFileName).toBe("spec-v2.csv");
    await expect(repository.listPositions(DEMO_USER_ID, { specificationId: first.specification.id, versionId: first.version.id, currentOnly: false })).resolves.toHaveLength(2);
    await expect(repository.listPositions(DEMO_USER_ID, { specificationId: first.specification.id, versionId: second.version.id, currentOnly: false })).resolves.toHaveLength(2);
    const audit = await repository.listAuditLogs(DEMO_USER_ID, { entityType: "specification" });
    expect(audit.some((event) => event.action === "specification.import.version_created")).toBe(true);
  });

  it("отказывает в публикации файла, требующего проверки", async () => {
    const repository = await getRepository();
    const file = await repository.saveUploadedFile(DEMO_USER_ID, { ...upload("upload-review", "scan.png"), parseStatus: "REVIEW_REQUIRED" });
    await expect(repository.publishSpecificationImport(DEMO_USER_ID, { fileId: file.id, mode: "NEW", projectCode: "P", name: "Скан", positions: [position("USR-001", 1)], validationSummary: {} })).rejects.toThrow(/ручной проверки/);
  });
});

function position(internalCode: string, requiredQuantity: number) { return { internalCode, nameRu: `Позиция ${internalCode}`, requiredQuantity, unit: "шт." }; }
function upload(id: string, originalName: string) { return { id, originalName, safeName: originalName, extension: originalName.endsWith("csv") ? ".csv" : ".xlsx", mimeType: "application/octet-stream", sizeBytes: 128, checksumSha256: "a".repeat(64), storageUrl: `local://${id}`, parseStatus: "PARSED", normalizedData: { rows: [] } }; }
