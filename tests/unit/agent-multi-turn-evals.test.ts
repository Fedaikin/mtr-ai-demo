import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  EXPECTED_MULTI_TURN_AGENT_EVAL_CASES,
  loadMultiTurnAgentEvalCases,
  runMultiTurnAgentEvals,
} from "@/evals/multi-turn-agent-evaluator";

describe("multi-turn curriculum МТР-агента", () => {
  it("сохраняет контекст follow-up и не обучается online на feedback", async () => {
    const cases = await loadMultiTurnAgentEvalCases(
      resolve(process.cwd(), "evals/mtr-agent-multi-turn-cases.jsonl"),
    );
    const result = await runMultiTurnAgentEvals(cases);

    expect(result.total).toBe(EXPECTED_MULTI_TURN_AGENT_EVAL_CASES);
    expect(result.failed, JSON.stringify(result.cases.filter((item) => !item.passed), null, 2)).toBe(0);
    expect(result.legacyCalls).toBe(0);
  });
});
