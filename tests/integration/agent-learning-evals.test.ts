import { resolve } from "node:path";

vi.mock("server-only", () => ({}));

import {
  EXPECTED_LEARNING_AGENT_EVAL_CASES,
  loadLearningAgentEvalCases,
  runLearningAgentEvals,
} from "@/evals/learning-agent-evaluator";

describe("versioned agent learning eval", () => {
  it("passes feedback, curation, rollback and trust-boundary cases", async () => {
    const cases = await loadLearningAgentEvalCases(
      resolve(process.cwd(), "evals/mtr-agent-learning-cases.jsonl"),
    );
    const result = await runLearningAgentEvals(cases);

    expect(result.total).toBe(EXPECTED_LEARNING_AGENT_EVAL_CASES);
    expect(
      result.failed,
      JSON.stringify(result.cases.filter((item) => !item.passed)),
    ).toBe(0);
    expect(result.cases.filter((item) => item.split === "adversarial")).toHaveLength(4);
    expect(result.cases.filter((item) => item.split === "held-out")).toHaveLength(4);
  });
});
