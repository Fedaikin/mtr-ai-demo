import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseUploadedFile } from "@/application/file-parser";
import {
  canonicalizeManualAppiusImport,
  canonicalizeManualSapImport,
  ManualImportError,
} from "@/application/manual-import";
import { DEMO_USER_ID } from "@/domain/models";

const ACCEPTED_AT = "2026-08-11T12:00:00.000Z";

describe("manual import canonicalization", () => {
  it("uses actual SAP CSV values and never trusts a user_id column", async () => {
    const parsed = await parseUploadedFile(
      "sap.csv",
      new TextEncoder().encode([
        "Код SAP;Наименование;Тип оборудования;Свободный остаток;Ед. изм.;Завод;Склад;user_id",
        "MANUAL-SAP-77;Труба из ручного файла;PIPE;7,5;M;PLANT-UPLOAD;WH-UPLOAD;another-user",
      ].join("\n")),
    );

    const result = canonicalizeManualSapImport(parsed.normalizedData, {
      userId: DEMO_USER_ID,
      checksumSha256: parsed.checksumSha256,
      acceptedAt: ACCEPTED_AT,
    });

    expect(result.materials).toEqual([
      expect.objectContaining({
        userId: DEMO_USER_ID,
        materialCode: "MANUAL-SAP-77",
        nameRu: "Труба из ручного файла",
        equipmentType: "PIPE",
        availableQuantity: 7.5,
        unit: "M",
        plant: "PLANT-UPLOAD",
        storageLocation: "WH-UPLOAD",
        snapshotAt: ACCEPTED_AT,
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("another-user");
  });

  it("creates run-scoped Appius positions from actual CSV values", async () => {
    const parsed = await parseUploadedFile(
      "appius.csv",
      new TextEncoder().encode([
        "Код позиции;Наименование;Тип оборудования;Требуемое количество;Ед. изм.;DN;user_id",
        "MANUAL-APP-1;Отвод из ручного файла;ELBOW;3;EA;50;another-user",
      ].join("\n")),
    );

    const result = canonicalizeManualAppiusImport(parsed.normalizedData, {
      userId: DEMO_USER_ID,
      checksumSha256: parsed.checksumSha256,
      acceptedAt: ACCEPTED_AT,
      specificationId: "spec-demo-piping-001",
      specificationName: "Ручная спецификация",
    });

    expect(result.positions).toEqual([
      expect.objectContaining({
        userId: DEMO_USER_ID,
        internalCode: "MANUAL-APP-1",
        nameRu: "Отвод из ручного файла",
        equipmentType: "ELBOW",
        requiredQuantity: 3,
        unit: "EA",
        dimensions: { nominalDiameterMm: 50 },
        versionId: result.versionId,
        isCurrentVersion: true,
      }),
    ]);
    expect(result.positions[0]?.access).toEqual({
      level: "DEMO_USER",
      allowedUserIds: [DEMO_USER_ID],
      source: "MANUAL_IMPORT",
    });
    expect(JSON.stringify(result)).not.toContain("another-user");
  });

  it("rejects a row without operational quantity instead of falling back to mock data", () => {
    expect(() => canonicalizeManualSapImport({ rows: [{ materialCode: "SAP-1", nameRu: "Труба", unit: "M" }] }, {
      userId: DEMO_USER_ID,
      checksumSha256: "b".repeat(64),
      acceptedAt: ACCEPTED_AT,
    })).toThrowError(expect.objectContaining<Partial<ManualImportError>>({ code: "MANUAL_IMPORT_NUMBER_INVALID" }));
  });
});
