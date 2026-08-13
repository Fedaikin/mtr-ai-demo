import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({
  requirePermission: vi.fn(async () => ({
    user: {
      id: "demo-user-001",
      displayName: "Демо-пользователь 1",
      roles: ["USER", "ADMIN"],
      locale: "ru-RU",
    },
    authorization: {
      subjectId: "demo-user-001",
      displayName: "Демо-пользователь 1",
      activeRoleAssignmentIds: ["assignment-demo-project-manager"],
      globalRoleKeys: [],
      activeProjectId: "demo-project-001",
      projectRoleKeys: ["PROJECT_MANAGER"],
      permissionKeys: new Set(["agent.chat", "specification.upload", "specification.publish"]),
      catalogScopeIds: ["demo-catalog-001"],
      sourceScopeIds: ["demo-appius-001"],
      accessClaims: {},
      authorizationVersion: 1,
      requestId: "request-attachment-route",
    },
  })),
  SessionError: class SessionError extends Error {
    constructor(message: string, readonly status: 401 | 403) {
      super(message);
    }
  },
}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase } from "@/adapters/persistence/db";
import { getRepository } from "@/adapters/persistence/repository";
import { POST as postMessage } from "@/app/api/agent/threads/[id]/messages/route";
import { DEMO_USER_ID } from "@/domain/models";

describe.sequential("chat attachment HTTP lifecycle", () => {
  beforeEach(async () => {
    await resetDemoDatabase(DEMO_USER_ID);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("shows preview without command and publishes an explicit version exactly once", async () => {
    const repository = await getRepository();
    const thread = await repository.createAgentThread(DEMO_USER_ID, "Импорт");
    const previewFile = await repository.saveUploadedFile(DEMO_USER_ID, upload("upload-chat-preview"));

    const previewResponse = await postMessage(
      jsonRequest(thread.id, {
        message: "",
        threadId: thread.id,
        attachments: [{ uploadId: previewFile.id, purpose: "SPECIFICATION" }],
      }),
      routeContext(thread.id),
    );
    expect(previewResponse.status).toBe(201);
    const preview = await previewResponse.json() as { items: Array<{ structuredOutput?: Record<string, unknown> }> };
    expect(preview.items.at(-1)?.structuredOutput).toMatchObject({
      attachmentImport: { status: "PREVIEW", validRows: 2, invalidRows: 0 },
    });

    const publishFile = await repository.saveUploadedFile(DEMO_USER_ID, upload("upload-chat-publish"));
    const body = {
      message: "Опубликуй эту спецификацию как новую версию",
      threadId: thread.id,
      selection: { projectId: "demo-project-001", specificationId: "spec-demo-piping-001" },
      attachments: [{ uploadId: publishFile.id, purpose: "SPECIFICATION" }],
    };
    const first = await postMessage(jsonRequest(thread.id, body), routeContext(thread.id));
    const replay = await postMessage(jsonRequest(thread.id, body), routeContext(thread.id));
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    const firstBody = await first.json() as { items: Array<{ structuredOutput?: Record<string, unknown> }> };
    const replayBody = await replay.json() as { items: Array<{ structuredOutput?: Record<string, unknown> }> };
    expect(firstBody.items.at(-1)?.structuredOutput).toMatchObject({
      attachmentImport: { status: "PUBLISHED", published: { versionNumber: 4, positionCount: 2 } },
    });
    expect(replayBody.items.at(-1)?.structuredOutput).toMatchObject({
      attachmentImport: { status: "PUBLISHED", published: { versionNumber: 4, positionCount: 2 } },
    });

    const versions = await repository.listSpecificationVersions(DEMO_USER_ID, "spec-demo-piping-001");
    expect(versions.filter((version) => version.sourceFileId === publishFile.id)).toHaveLength(1);
    const audits = await repository.listAuditLogs(DEMO_USER_ID, { entityType: "specification", limit: 50 });
    expect(audits.filter((event) => event.details.fileId === publishFile.id)).toHaveLength(1);
  });
});

function upload(id: string) {
  return {
    id,
    originalName: `${id}.xlsx`,
    safeName: `${id}.xlsx`,
    extension: ".xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: 256,
    checksumSha256: id.padEnd(64, "a").slice(0, 64),
    storageUrl: `memory://${id}`,
    parseStatus: "PARSED",
    normalizedData: {
      rows: [
        { internalCode: `${id}-001`, nameRu: "Труба", requiredQuantity: 2, unit: "EA" },
        { internalCode: `${id}-002`, nameRu: "Фланец", requiredQuantity: 4, unit: "EA" },
      ],
      warnings: [],
    },
  };
}

function jsonRequest(threadId: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/agent/threads/${threadId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}
