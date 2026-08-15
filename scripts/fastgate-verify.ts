import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  verifyOfficialFastGateAggregate,
  type OfficialFastGateAggregate,
} from "@/evals/fastgate/official/verifier";

const aggregatePath = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
if (!aggregatePath) throw new Error("AGGREGATE_PATH_REQUIRED");
const resolved = resolve(aggregatePath);
const aggregate = JSON.parse(readFileSync(resolved, "utf8")) as OfficialFastGateAggregate;
const verification = verifyOfficialFastGateAggregate(aggregate);
const outputArg = process.argv.find((argument) => argument.startsWith("--output="));
if (outputArg) writeFileSync(resolve(outputArg.slice("--output=".length)), `${JSON.stringify(verification, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
if (!verification.valid) process.exitCode = 1;
