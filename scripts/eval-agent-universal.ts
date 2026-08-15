import { resolve } from "node:path";

async function main(): Promise<void> {
  process.env.DATABASE_URL = "";
  process.env.PGLITE_DATA_DIR = `memory://mtr-agent-universal-eval-${process.pid}`;
  process.env.APP_MODE = "demo";
  process.env.MTR_AGENT_UNIVERSAL_CHAT_ENABLED = "true";
  process.env.MTR_AGENT_LIVE_LLM_ENABLED = "false";
  // Public local-test hash for MtrLocalTestOnly!; never used by Preview/Production.
  process.env.DEMO_PASSWORD_HASH = "scrypt$16384$8$1$5Qr53Li_UbDOnhJzIumUzw$OnJc6NYv7o1rF5xkdJKUCPb_QbSc9Yeuc-GaCB_KVuABn4SxmUKk2qYt0S3tNsUtAOQPHhIIkyVKn3l-leakrg";

  const {
    loadUniversalAgentEvalManifest,
    runUniversalAgentEvals,
  } = await import("@/evals/universal-agent-evaluator");
  const manifest = await loadUniversalAgentEvalManifest(
    resolve(process.cwd(), "evals/mtr-agent-universal-curriculum.json"),
  );
  const result = await runUniversalAgentEvals(manifest);
  for (const item of result.cases.filter((candidate) => !candidate.passed)) {
    process.stderr.write(`FAIL ${item.id}: ${item.failures.join("; ")}\n`);
  }
  process.stdout.write(
    `Universal agent evals: ${result.passed}/${result.total} passed; p95=${result.p95DurationMs.toFixed(2)}ms; maxPublic=${result.maxPublicBytes}B.\n`,
  );
  if (result.failed > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  const label = error instanceof Error ? error.message : "неизвестная ошибка";
  process.stderr.write(`Universal agent eval runner failed: ${label}\n`);
  process.exitCode = 1;
});
