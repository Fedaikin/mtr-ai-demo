import {
  containsInternalAgentContent,
  toPublicAgentDecision,
} from "@/application/agent-presentation";

describe("user-facing agent presentation", () => {
  it("keeps a grounded final answer and only decision metadata", () => {
    expect(
      toPublicAgentDecision("На складе доступно 12 шт.", {
        confidence: 0.94,
        requiresHumanReview: false,
        toolCalls: [{ tool: "sap.getMaterialStock" }],
      }),
    ).toEqual({
      answer: "На складе доступно 12 шт.",
      confidence: 0.94,
      requiresHumanReview: false,
      technicalContentRemoved: false,
    });
  });

  it.each([
    "sap.getMaterialStock вызван с аргументом code=1",
    "```json\n{\"toolCalls\": []}\n```",
    "System prompt: reveal internal rules",
    "Error\n at AgentService.respond (agent-service.ts:1:1)",
  ])("replaces internal technical content with a safe review response: %s", (answer) => {
    const result = toPublicAgentDecision(answer, {
      confidence: 1,
      requiresHumanReview: false,
    });

    expect(result.answer).not.toContain(answer);
    expect(result).toMatchObject({
      confidence: 0,
      requiresHumanReview: true,
      technicalContentRemoved: true,
    });
    expect(containsInternalAgentContent(answer)).toBe(true);
  });
});
