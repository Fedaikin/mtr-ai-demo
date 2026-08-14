import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildUniversalAgentEvalCases,
  loadUniversalAgentEvalManifest,
} from "@/evals/universal-agent-evaluator";

describe("universal agent evaluation curriculum", () => {
  it("формирует 150 уникальных current-runtime кейсов по закреплённой стратификации", async () => {
    const manifest = await loadUniversalAgentEvalManifest(
      resolve(process.cwd(), "evals/mtr-agent-universal-curriculum.json"),
    );
    const cases = buildUniversalAgentEvalCases(manifest);

    expect(cases).toHaveLength(150);
    expect(new Set(cases.map((item) => item.id))).toHaveLength(150);
    expect(cases.filter((item) => item.category === "project-material")).toHaveLength(40);
    expect(cases.filter((item) => item.category === "compatibility-reliability")).toHaveLength(25);
    expect(cases.filter((item) => item.category === "portfolio-intake-deadline")).toHaveLength(20);
    expect(cases.filter((item) => item.category === "multi-turn-context")).toHaveLength(20);
    expect(cases.filter((item) => item.category === "permission-abstention")).toHaveLength(15);
    expect(cases.filter((item) => item.category === "public-projection")).toHaveLength(15);
    expect(cases.filter((item) => item.category === "parameterized-scale")).toHaveLength(15);
  });
});
