import { resolve } from "node:path";

import { buildFastGateDoctorReport, writeDoctorReport } from "@/evals/fastgate/official/doctor";

async function main(): Promise<void> {
  const outputArg = process.argv.find((argument) => argument.startsWith("--output="));
  const probeContainer = process.argv.includes("--probe-container");
  const output = resolve(outputArg?.slice("--output=".length) || "test-results/mtr-agent-fastgate/doctor.json");
  const report = await buildFastGateDoctorReport({ probeContainer });
  writeDoctorReport(report, output);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\nDoctor artifact: ${output}\n`);
  if (!report.ready) process.exitCode = 2;
}

void main().catch((error: unknown) => {
  process.stderr.write(`FASTGATE_DOCTOR_FAILED:${error instanceof Error ? error.message : "UNKNOWN"}\n`);
  process.exitCode = 2;
});
