import { spawnSync } from "node:child_process";

import { buildScopedCleanupPlan, type FastGateContainerRuntime } from "@/evals/fastgate/official/runtime";

const runtimeArg = process.argv.find((argument) => argument.startsWith("--runtime="))?.slice("--runtime=".length) as FastGateContainerRuntime | undefined;
const projectName = process.argv.find((argument) => argument.startsWith("--project="))?.slice("--project=".length);
if (!runtimeArg || !["docker", "podman", "colima"].includes(runtimeArg)) throw new Error("FASTGATE_RUNTIME_REQUIRED");
if (!projectName) throw new Error("FASTGATE_PROJECT_REQUIRED");
const plan = buildScopedCleanupPlan({ runtime: runtimeArg, projectName });
const [command, ...args] = plan.command;
const result = spawnSync(command!, args, { stdio: "inherit", timeout: 120_000 });
if (result.status !== 0) process.exitCode = result.status ?? 1;
