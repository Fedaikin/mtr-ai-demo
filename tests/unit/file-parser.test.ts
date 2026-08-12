import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  parseUploadedFile,
  UploadParseError,
  validateUploadMime,
} from "@/application/file-parser";

describe("safe upload parsing", () => {
  it("parses CSV and neutralizes spreadsheet formulas", async () => {
    const parsed = await parseUploadedFile(
      "остатки.csv",
      new TextEncoder().encode("code;name\nSAP-1;=HYPERLINK(\"https://invalid.example\")\n"),
    );

    expect(parsed).toMatchObject({ extension: ".csv", parseStatus: "PARSED" });
    expect(parsed.normalizedData.rows).toEqual([
      { code: "SAP-1", name: expect.stringMatching(/^'=HYPERLINK/u) },
    ]);
  });

  it("rejects an extension and MIME mismatch", () => {
    expect(() => validateUploadMime("остатки.csv", "application/pdf")).toThrowError(
      expect.objectContaining<Partial<UploadParseError>>({ code: "FILE_MIME_MISMATCH" }),
    );
  });

  it("rejects spoofed PDF content before invoking the parser", async () => {
    await expect(
      parseUploadedFile("подмена.pdf", new TextEncoder().encode("not a pdf")),
    ).rejects.toMatchObject({ code: "FILE_SIGNATURE_MISMATCH" });
  });

  it("accepts TIFF signatures and sends unknown scans to review", async () => {
    const parsed = await parseUploadedFile(
      "скан.tiff",
      new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]),
    );

    expect(parsed).toMatchObject({ extension: ".tiff", parseStatus: "REVIEW_REQUIRED" });
    expect(parsed.normalizedData.warnings).toEqual([
      expect.stringMatching(/ручная проверка|OCR/u),
    ]);
  });

  it("returns deterministic OCR text only for the included demo hash", async () => {
    const parsed = await parseUploadedFile(
      "demo-ocr.png",
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

    expect(parsed).toMatchObject({ extension: ".png", parseStatus: "PARSED" });
    expect(parsed.normalizedData).toMatchObject({
      kind: "OCR_DEMO",
      text: expect.stringContaining("Синтетическая позиция МТР"),
      isSyntheticDemo: true,
    });
  });
});
