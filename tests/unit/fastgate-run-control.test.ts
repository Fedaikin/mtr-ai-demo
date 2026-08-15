import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checksumDecision, resolveFastGateSeed, runtimeExceeded } from "@/evals/fastgate/run-control";

describe("FastGate run control", () => {
  it("allows an explicit reproduction seed but marks it non-official", () => {
    const result = resolveFastGateSeed(["--seed", "reproduction-seed-0001"], "a".repeat(40), join(tmpdir(), "unused"));
    expect(result).toEqual({ seed: "reproduction-seed-0001", official: false });
  });

  it("does not reuse the previous official seed for one deployment", () => {
    const dir = mkdtempSync(join(tmpdir(), "fastgate-seed-"));
    const file = join(dir, "history.json");
    const values = ["a".repeat(64), "a".repeat(64), "b".repeat(64)];
    const first = resolveFastGateSeed([], "c".repeat(40), file, () => values.shift()!);
    const second = resolveFastGateSeed([], "c".repeat(40), file, () => values.shift()!);
    expect(first.seed).toBe("a".repeat(64));
    expect(second.seed).toBe("b".repeat(64));
  });

  it("retries one checksum change and invalidates the second", () => {
    expect(checksumDecision("a", "b", 0)).toBe("RETRY_ONCE");
    expect(checksumDecision("a", "b", 1)).toBe("INVALID_ENVIRONMENT");
    expect(checksumDecision("a", "a", 0)).toBe("PASS");
  });

  it("enforces the local and Preview runtime budget", () => {
    expect(runtimeExceeded(0, 600_001, 600_000)).toBe(true);
    expect(runtimeExceeded(0, 599_999, 600_000)).toBe(false);
  });
});
