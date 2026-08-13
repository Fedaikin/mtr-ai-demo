import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  EXPECTED_SCALE_AGENT_EVAL_CASES,
  loadScaleAgentEvalCases,
  runScaleAgentEvals,
} from "@/evals/scale-agent-evaluator";

describe("scale curriculum МТР-агента", () => {
  it("обрабатывает санкционированный портфель батчами по 10 без смешивания контекста", async () => {
    const cases = await loadScaleAgentEvalCases(
      resolve(process.cwd(), "evals/mtr-agent-scale-cases.jsonl"),
    );
    const result = await runScaleAgentEvals(cases);

    expect(result.total).toBe(EXPECTED_SCALE_AGENT_EVAL_CASES);
    expect(result.failed, JSON.stringify(result.cases.filter((item) => !item.passed), null, 2)).toBe(0);
    expect(result.maxConcurrent).toBe(10);
    expect(result.datasetLoads).toBe(20);
    expect(result.legacyCalls).toBe(0);
  });
});
