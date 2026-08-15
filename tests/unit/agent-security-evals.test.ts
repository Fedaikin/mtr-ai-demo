import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  EXPECTED_SECURITY_AGENT_EVAL_CASES,
  loadSecurityAgentEvalCases,
  runSecurityAgentEvals,
} from "@/evals/security-agent-evaluator";

describe("security curriculum МТР-агента", () => {
  it("исполняет все trust-boundary кейсы без пропусков", async () => {
    const cases = await loadSecurityAgentEvalCases(
      resolve(process.cwd(), "evals/mtr-agent-security-cases.jsonl"),
    );
    const result = await runSecurityAgentEvals(cases);

    expect(result.total).toBe(EXPECTED_SECURITY_AGENT_EVAL_CASES);
    expect(result.failed, JSON.stringify(result.cases.filter((item) => !item.passed), null, 2)).toBe(0);
    expect(result.passed).toBe(EXPECTED_SECURITY_AGENT_EVAL_CASES);
  });
});
