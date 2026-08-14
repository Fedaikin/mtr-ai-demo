import { resolve } from "node:path";

import {
  loadMultiTurnAgentEvalCases,
  runMultiTurnAgentEvals,
} from "@/evals/multi-turn-agent-evaluator";

async function main(): Promise<void> {
  const cases = await loadMultiTurnAgentEvalCases(
    resolve(process.cwd(), "evals/mtr-agent-multi-turn-cases.jsonl"),
  );
  const result = await runMultiTurnAgentEvals(cases);
  for (const item of result.cases) {
    const duration = `${item.durationMs.toFixed(2)}ms`;
    if (item.passed) process.stdout.write(`PASS ${item.id} ${duration}\n`);
    else process.stderr.write(`FAIL ${item.id} ${duration}: ${item.failures.join("; ")}\n`);
  }
  process.stdout.write(
    `Multi-turn agent evals: ${result.passed}/${result.total} passed; legacyCalls=${result.legacyCalls}.\n`,
  );
  if (result.failed > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  const label = error instanceof Error ? error.message : "неизвестная ошибка";
  process.stderr.write(`Multi-turn agent eval runner failed: ${label}\n`);
  process.exitCode = 1;
});
