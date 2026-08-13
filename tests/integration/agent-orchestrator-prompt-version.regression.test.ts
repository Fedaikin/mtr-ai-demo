import { afterAll, describe, expect, it, vi } from "vitest";

import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase } from "@/adapters/persistence/db";
import { getRepository } from "@/adapters/persistence/repository";
import {
  MTR_AGENT_ORCHESTRATOR_VERSION,
  MTR_AGENT_PROMPT_NAME,
  MTR_AGENT_ROLLBACK_VERSION,
  MTR_AGENT_UNIVERSAL_PROMPT,
  MTR_AGENT_UNIVERSAL_VERSION,
  promptChecksum,
} from "@/application/agent-orchestrator/system-prompt";
import { DEMO_USER_ID } from "@/domain/models";

vi.mock("server-only", () => ({}));

describe.sequential("версионирование prompt оркестратора", () => {
  afterAll(async () => closeDatabase());

  it("seed активирует universal v4 и сохраняет v1/v3 для rollback", async () => {
    const counts = await resetDemoDatabase(DEMO_USER_ID);
    const repository = await getRepository();
    const prompts = await repository.listPrompts(DEMO_USER_ID, MTR_AGENT_PROMPT_NAME);
    const active = await repository.getActivePrompt(DEMO_USER_ID, MTR_AGENT_PROMPT_NAME);

    expect(counts.prompts).toBe(3);
    expect(prompts.map((prompt) => prompt.promptVersion).sort()).toEqual([
      MTR_AGENT_ROLLBACK_VERSION,
      MTR_AGENT_ORCHESTRATOR_VERSION,
      MTR_AGENT_UNIVERSAL_VERSION,
    ]);
    expect(active).toMatchObject({
      promptVersion: MTR_AGENT_UNIVERSAL_VERSION,
      checksum: promptChecksum(MTR_AGENT_UNIVERSAL_PROMPT),
      active: true,
    });
    expect(prompts.find((prompt) => prompt.promptVersion === MTR_AGENT_ROLLBACK_VERSION)).toMatchObject({
      active: false,
    });
    expect(prompts.find((prompt) => prompt.promptVersion === MTR_AGENT_ORCHESTRATOR_VERSION)).toMatchObject({
      active: false,
    });
  });
});
