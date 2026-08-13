import { afterAll, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase } from "@/adapters/persistence/db";
import { getRepository, type MtrRepository } from "@/adapters/persistence/repository";
import { createAgentRuntime } from "@/app/api/agent/_shared";
import { DEMO_USER_ID } from "@/domain/models";

describe.sequential("audit persistence redaction boundary", () => {
  let repository: MtrRepository;

  beforeEach(async () => {
    await resetDemoDatabase(DEMO_USER_ID);
    repository = await getRepository();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("does not persist credentials or full document/model payloads", async () => {
    await repository.writeAudit(DEMO_USER_ID, {
      action: "agent.tool.result",
      entityType: "agent_tool_call",
      outcome: "SUCCESS",
      requestId: "agent-redaction-proof",
      details: {
        tool: "sap.getState",
        arguments: { password: "MtrLocalTestOnly!", cookie: "session=unsafe" },
        result: { count: 1 },
        documentContent: "full confidential document",
      },
    });

    const [saved] = await repository.listAuditLogs(DEMO_USER_ID, {
      action: "agent.tool.result",
      limit: 1,
    });
    const serialized = JSON.stringify(saved?.details);

    expect(saved?.requestId).toBe("agent-redaction-proof");
    expect(serialized).toContain("[СКРЫТО]");
    expect(serialized).not.toContain("MtrLocalTestOnly!");
    expect(serialized).not.toContain("session=unsafe");
    expect(serialized).not.toContain("full confidential document");
  });

  it("stores correlated technical tool evidence for the admin dashboard", async () => {
    await createAgentRuntime(repository).respond({
      userId: DEMO_USER_ID,
      threadId: "thread-observability-proof",
      correlationId: "agent-observability-proof",
      promptVersion: "mtr-agent-proof-v2",
      message: "Какой остаток материала SAP-DEMO-0001?",
    });

    const toolEntries = await repository.listAuditLogs(DEMO_USER_ID, {
      action: "agent.tool.result",
      limit: 20,
    });
    const responseEntries = await repository.listAuditLogs(DEMO_USER_ID, {
      action: "agent.response.completed",
      limit: 5,
    });

    expect(toolEntries.length).toBeGreaterThanOrEqual(3);
    expect(toolEntries.every((entry) => entry.requestId === "agent-observability-proof")).toBe(true);
    expect(toolEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          details: expect.objectContaining({
            tool: "sap.getMaterialStock",
            attempts: 1,
            promptVersion: "mtr-agent-proof-v2",
            model: "Mock LLM",
            correlationId: "agent-observability-proof",
            conversationId: "thread-observability-proof",
            durationMs: expect.any(Number),
            arguments: expect.any(Object),
            result: expect.any(Object),
          }),
        }),
      ]),
    );
    expect(responseEntries[0]).toMatchObject({
      requestId: "agent-observability-proof",
      details: {
        correlationId: "agent-observability-proof",
        promptVersion: "mtr-agent-proof-v2",
        model: "Mock LLM",
        requiresHumanReview: false,
        citations: expect.any(Array),
      },
    });
  });
});
