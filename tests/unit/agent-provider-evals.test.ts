import { resolve } from "node:path";

import {
  EXPECTED_PROVIDER_AGENT_EVAL_CASES,
  loadProviderAgentEvalCases,
  runProviderAgentEvals,
} from "@/evals/provider-agent-evaluator";

describe("provider conformance eval curriculum", () => {
  it("запускает 20 versioned provider-boundary кейсов без дубликатов", async () => {
    const cases = await loadProviderAgentEvalCases(
      resolve(process.cwd(), "evals/mtr-agent-provider-cases.jsonl"),
    );

    expect(cases).toHaveLength(EXPECTED_PROVIDER_AGENT_EVAL_CASES);
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
    await expect(runProviderAgentEvals(cases)).resolves.toMatchObject({
      total: 20,
      passed: 20,
      failed: 0,
    });
  });
});
