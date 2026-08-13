import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRepository: vi.fn(),
  readUploadedBytes: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({
  requireDemoRole: vi.fn(async () => ({ user: { id: "demo-user-001" } })),
  SessionError: class SessionError extends Error {
    constructor(message: string, readonly status: 401 | 403) {
      super(message);
    }
  },
}));
vi.mock("@/adapters/persistence/repository", () => ({ getRepository: mocks.getRepository }));
vi.mock("@/adapters/storage/upload-storage", () => ({ readUploadedBytes: mocks.readUploadedBytes }));

import { DELETE, GET } from "@/app/api/uploads/[id]/route";

describe("uploaded source file download", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns only a file selected through the user-scoped repository lookup", async () => {
    const getUploadedFile = vi.fn(async () => ({
      originalName: "Спецификация №1.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 4,
      storageUrl: "https://blob.example/private",
    }));
    mocks.getRepository.mockResolvedValue({ getUploadedFile });
    mocks.readUploadedBytes.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));

    const response = await GET(new Request("http://localhost/api/uploads/upload-1"), {
      params: Promise.resolve({ id: "upload-1" }),
    });

    expect(response.status).toBe(200);
    expect(getUploadedFile).toHaveBeenCalledWith("demo-user-001", "upload-1");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("does not access storage when the user-scoped record is absent", async () => {
    mocks.getRepository.mockResolvedValue({ getUploadedFile: vi.fn(async () => null) });

    const response = await GET(new Request("http://localhost/api/uploads/missing"), {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(response.status).toBe(404);
    expect(mocks.readUploadedBytes).not.toHaveBeenCalled();
  });

  it("cancels an import without deleting its evidence and writes a safe audit event", async () => {
    const updateUploadedFile = vi.fn(async () => ({}));
    const writeAudit = vi.fn(async () => undefined);
    mocks.getRepository.mockResolvedValue({
      getUploadedFile: vi.fn(async () => ({ originalName: "demo.csv", parseStatus: "PARSED" })),
      updateUploadedFile,
      writeAudit,
    });

    const response = await DELETE(new Request("http://localhost/api/uploads/upload-1", {
      method: "DELETE",
      headers: { host: "localhost" },
    }), { params: Promise.resolve({ id: "upload-1" }) });

    expect(response.status).toBe(204);
    expect(updateUploadedFile).toHaveBeenCalledWith("demo-user-001", "upload-1", { parseStatus: "CANCELLED" });
    expect(writeAudit).toHaveBeenCalledWith("demo-user-001", expect.objectContaining({
      action: "specification.import.cancelled",
      entityId: "upload-1",
    }));
  });
});
