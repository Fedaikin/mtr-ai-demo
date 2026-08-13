import { resolve } from "node:path";

import {
  loadSecurityAgentEvalCases,
  runSecurityAgentEvals,
} from "@/evals/security-agent-evaluator";

async function main(): Promise<void> {
  const cases = await loadSecurityAgentEvalCases(
    resolve(process.cwd(), "evals/mtr-agent-security-cases.jsonl"),
  );
  const result = await runSecurityAgentEvals(cases);
  for (const item of result.cases) {
    const duration = `${item.durationMs.toFixed(2)}ms`;
    if (item.passed) process.stdout.write(`PASS ${item.id} ${duration}\n`);
    else process.stderr.write(`FAIL ${item.id} ${duration}: ${item.failures.join("; ")}\n`);
  }
  process.stdout.write(
    `Security agent evals: ${result.passed}/${result.total} passed, ${result.failed} failed.\n`,
  );
  if (result.failed > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  const label = error instanceof Error ? error.message : "неизвестная ошибка";
  process.stderr.write(`Security agent eval runner failed: ${label}\n`);
  process.exitCode = 1;
});
