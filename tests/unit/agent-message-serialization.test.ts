vi.mock("server-only", () => ({}));

import {
  isUserVisibleAgentMessage,
  serializeAgentMessage,
} from "@/app/api/agent/_shared";

function bundle(role = "assistant") {
  return {
    message: {
      id: "message-1",
      threadId: "thread-1",
      userId: "demo-user-001",
      role,
      content: "Материал доступен в количестве 12 шт.",
      structuredOutput: {
        facts: ["internal"],
        recommendations: ["internal"],
        confidence: 0.91,
        requiresHumanReview: false,
        toolCalls: [{ tool: "sap.getMaterialStock", outcome: "OK", durationMs: 10 }],
      },
      promptVersion: "secret-system-prompt-v9",
      createdAt: "2026-08-12T10:00:00.000Z",
      updatedAt: "2026-08-12T10:00:00.000Z",
      createdBy: "demo-user-001",
      version: 1,
    },
    citations: [
      {
        id: "citation-1",
        messageId: "message-1",
        userId: "demo-user-001",
        sourceSystem: "SAP",
        entityId: "SAP-DEMO-0001",
        versionOrSnapshot: "2026-08-12",
        clauseId: null,
        createdAt: "2026-08-12T10:00:00.000Z",
        updatedAt: "2026-08-12T10:00:00.000Z",
        createdBy: "demo-user-001",
        version: 1,
      },
    ],
  };
}

describe("agent message serialization boundary", () => {
  it("never exposes tool calls, raw output, facts or prompt metadata to the user", () => {
    const serialized = serializeAgentMessage(bundle());
    const json = JSON.stringify(serialized);

    expect(serialized).toMatchObject({
      content: "Материал доступен в количестве 12 шт.",
      structuredOutput: { confidence: 0.91, requiresHumanReview: false },
      citations: [expect.objectContaining({ sourceSystem: "SAP", entityId: "SAP-DEMO-0001" })],
    });
    expect(json).not.toContain("toolCalls");
    expect(json).not.toContain("sap.getMaterialStock");
    expect(json).not.toContain("secret-system-prompt-v9");
    expect(json).not.toContain("facts");
    expect(json).not.toContain("recommendations");
  });

  it("filters service messages before they reach chat", () => {
    expect(isUserVisibleAgentMessage(bundle("assistant"))).toBe(true);
    expect(isUserVisibleAgentMessage(bundle("user"))).toBe(true);
    expect(isUserVisibleAgentMessage(bundle("system"))).toBe(false);
    expect(isUserVisibleAgentMessage(bundle("tool"))).toBe(false);
  });
});
