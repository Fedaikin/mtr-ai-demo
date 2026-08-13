import { resolve } from "node:path";

import {
  loadScaleAgentEvalCases,
  runScaleAgentEvals,
} from "@/evals/scale-agent-evaluator";

async function main(): Promise<void> {
  const cases = await loadScaleAgentEvalCases(
    resolve(process.cwd(), "evals/mtr-agent-scale-cases.jsonl"),
  );
  const result = await runScaleAgentEvals(cases);
  for (const item of result.cases) {
    const evidence = `${item.durationMs.toFixed(2)}ms/${item.publicBytes}B`;
    if (item.passed) process.stdout.write(`PASS ${item.id} ${evidence}\n`);
    else process.stderr.write(`FAIL ${item.id} ${evidence}: ${item.failures.join("; ")}\n`);
  }
  process.stdout.write(
    `Scale agent evals: ${result.passed}/${result.total} passed; p95=${result.p95DurationMs.toFixed(2)}ms; concurrency=${result.maxConcurrent}; datasetLoads=${result.datasetLoads}; legacyCalls=${result.legacyCalls}.\n`,
  );
  if (result.failed > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  const label = error instanceof Error ? error.message : "неизвестная ошибка";
  process.stderr.write(`Scale agent eval runner failed: ${label}\n`);
  process.exitCode = 1;
});
