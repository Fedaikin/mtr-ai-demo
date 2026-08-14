import { resolve } from "node:path";

import {
  EXPECTED_ANALYTICAL_AGENT_EVAL_CASES,
  loadAnalyticalAgentEvalCases,
  runAnalyticalAgentEvals,
} from "@/evals/analytical-agent-evaluator";

vi.mock("server-only", () => ({}));

describe("production-shaped analytical agent evals", () => {
  it("passes the checked-in calibration, validation and adversarial cases", async () => {
    const cases = await loadAnalyticalAgentEvalCases(
      resolve(process.cwd(), "evals/mtr-agent-analytical-cases.jsonl"),
    );
    const result = await runAnalyticalAgentEvals(cases);

    expect(result.total).toBe(EXPECTED_ANALYTICAL_AGENT_EVAL_CASES);
    expect(result.cases.filter((item) => !item.passed)).toEqual([]);
    expect(result).toMatchObject({
      passed: EXPECTED_ANALYTICAL_AGENT_EVAL_CASES,
      failed: 0,
    });
  });
});
