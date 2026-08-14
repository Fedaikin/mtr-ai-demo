import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRepository: vi.fn(),
  storeUploadedBytes: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({
  requirePermission: vi.fn(async () => ({ user: { id: "demo-user-001" } })),
  SessionError: class SessionError extends Error {
    constructor(message: string, readonly status: 401 | 403) {
      super(message);
    }
  },
}));
vi.mock("@/adapters/persistence/repository", () => ({
  getRepository: mocks.getRepository,
}));
vi.mock("@/adapters/storage/upload-storage", () => ({
  storeUploadedBytes: mocks.storeUploadedBytes,
}));

import { POST as upload } from "@/app/api/uploads/route";

describe("corrupt upload HTTP contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    {
      label: "XLSX",
      name: "повреждённый.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x62, 0x72, 0x6f, 0x6b, 0x65, 0x6e]),
    },
    {
      label: "PDF",
      name: "повреждённый.pdf",
      mimeType: "application/pdf",
      bytes: new TextEncoder().encode("%PDF-1.7\ncorrupt-object-table"),
    },
  ])("returns stable safe 4xx UPLOAD_CORRUPT for signature-valid corrupt $label", async ({ name, mimeType, bytes }) => {
    const response = await upload(multipartRequest(name, mimeType, bytes));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "UPLOAD_CORRUPT",
        message: "Файл повреждён или имеет неподдерживаемую внутреннюю структуру",
        details: null,
      },
    });
    expect(mocks.storeUploadedBytes).not.toHaveBeenCalled();
    expect(mocks.getRepository).not.toHaveBeenCalled();
  });
});

function multipartRequest(name: string, mimeType: string, bytes: Uint8Array): Request {
  const form = new FormData();
  const fileBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(fileBuffer).set(bytes);
  form.set("purpose", "ACCEPTANCE_CORRUPT_PROBE");
  form.set("file", new File([fileBuffer], name, { type: mimeType }));
  return new Request("http://localhost/api/uploads", { method: "POST", body: form });
}
