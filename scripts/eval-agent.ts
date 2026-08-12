import { resolve } from "node:path";

import { loadAgentEvalCases, runAgentEvals } from "@/evals/agent-evaluator";

async function main(): Promise<void> {
  const cases = await loadAgentEvalCases(resolve(process.cwd(), "evals/mtr-agent-cases.jsonl"));
  const result = await runAgentEvals(cases);

  for (const item of result.cases) {
    if (item.passed) {
      process.stdout.write(`PASS ${item.id}\n`);
      continue;
    }
    process.stderr.write(`FAIL ${item.id}: ${item.failures.join("; ")}\n`);
  }
  process.stdout.write(
    `Agent evals: ${result.passed}/${result.total} passed, ${result.failed} failed.\n`,
  );
  if (result.failed > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  const label = error instanceof Error ? error.message : "неизвестная ошибка";
  process.stderr.write(`Agent eval runner failed: ${label}\n`);
  process.exitCode = 1;
});
