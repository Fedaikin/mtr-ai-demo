import { resolve } from "node:path";

import {
  loadProviderAgentEvalCases,
  runProviderAgentEvals,
} from "@/evals/provider-agent-evaluator";

async function main(): Promise<void> {
  const cases = await loadProviderAgentEvalCases(
    resolve(process.cwd(), "evals/mtr-agent-provider-cases.jsonl"),
  );
  const result = await runProviderAgentEvals(cases);
  for (const item of result.cases) {
    const duration = `${item.durationMs.toFixed(2)}ms`;
    if (item.passed) process.stdout.write(`PASS ${item.id} ${duration}\n`);
    else process.stderr.write(`FAIL ${item.id} ${duration}: ${item.failures.join("; ")}\n`);
  }
  process.stdout.write(
    `Provider agent evals: ${result.passed}/${result.total} passed, ${result.failed} failed.\n`,
  );
  if (result.failed > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  const label = error instanceof Error ? error.message : "неизвестная ошибка";
  process.stderr.write(`Provider agent eval runner failed: ${label}\n`);
  process.exitCode = 1;
});
