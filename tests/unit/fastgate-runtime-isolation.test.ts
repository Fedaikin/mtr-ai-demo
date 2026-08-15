import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("FastGate production-runtime isolation", () => {
  it("does not let production runtime import the manifest or reference oracle", () => {
    const productionFiles = [
      "src/application/agent-service.ts",
      "src/application/agent-orchestrator/orchestrator.ts",
      "src/application/agent-orchestrator/universal-chat/universal-chat-service.ts",
      "src/app/api/agent/_shared.ts",
      "src/app/api/agent/threads/[id]/messages/route.ts",
    ];
    for (const file of productionFiles) {
      const content = readFileSync(resolve(file), "utf8");
      expect(content, file).not.toMatch(/mtr-agent-fastgate|evals\/fastgate|reference-oracle/iu);
    }
  });
});
