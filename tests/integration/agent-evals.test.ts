import { resolve } from "node:path";

import {
  EXPECTED_AGENT_EVAL_CASES,
  loadAgentEvalCases,
  runAgentEvals,
} from "@/evals/agent-evaluator";

describe("deterministic agent evals", () => {
  it("passes every checked-in JSONL case without external services", async () => {
    const cases = await loadAgentEvalCases(
      resolve(process.cwd(), "evals/mtr-agent-cases.jsonl"),
    );
    const result = await runAgentEvals(cases);

    expect(result.total).toBe(EXPECTED_AGENT_EVAL_CASES);
    expect(result.cases.filter((item) => !item.passed)).toEqual([]);
    expect(result).toMatchObject({
      passed: EXPECTED_AGENT_EVAL_CASES,
      failed: 0,
    });
  });
});
