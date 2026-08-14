import { describe, expect, it } from "vitest";

import {
  MTR_AGENT_ORCHESTRATOR_PROMPT,
  MTR_AGENT_ORCHESTRATOR_VERSION,
  MTR_AGENT_ROLLBACK_PROMPT,
  MTR_AGENT_ROLLBACK_VERSION,
  MTR_AGENT_UNIVERSAL_BASE_VERSION,
  MTR_AGENT_UNIVERSAL_PROMPT,
  MTR_AGENT_UNIVERSAL_VERSION,
  promptChecksum,
} from "@/application/agent-orchestrator/system-prompt";

describe("system prompt оркестратора", () => {
  it("версионирует active v3 и сохраняет отдельный rollback v1", () => {
    expect(MTR_AGENT_ORCHESTRATOR_VERSION).toBe("3.0.0");
    expect(MTR_AGENT_ROLLBACK_VERSION).toBe("1.0.0");
    expect(MTR_AGENT_ORCHESTRATOR_PROMPT).not.toBe(MTR_AGENT_ROLLBACK_PROMPT);
    expect(promptChecksum(MTR_AGENT_ORCHESTRATOR_PROMPT)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("версионирует universal v4.1 после появления подтверждаемых RBAC capabilities", () => {
    expect(MTR_AGENT_UNIVERSAL_BASE_VERSION).toBe("4.0.0");
    expect(MTR_AGENT_UNIVERSAL_VERSION).toBe("4.1.0");
    expect(MTR_AGENT_UNIVERSAL_PROMPT).toContain("Универсальный разговорный контур");
    expect(MTR_AGENT_UNIVERSAL_PROMPT).toContain("четырёх planning rounds");
    expect(MTR_AGENT_UNIVERSAL_PROMPT).toContain("Не обучайся автоматически");
    expect(MTR_AGENT_UNIVERSAL_PROMPT).toContain("Подтверждаемое управление доступом");
    expect(MTR_AGENT_UNIVERSAL_PROMPT).toContain("отдельную кнопку подтверждения");
    expect(MTR_AGENT_UNIVERSAL_PROMPT).toContain("Самоизменение доступа");
    expect(promptChecksum(MTR_AGENT_UNIVERSAL_PROMPT)).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    "trusted context",
    "bounded plan",
    "requiresHumanReview",
    "proposal → confirm → reauthorization",
    "REVOKED_CITATION",
    "PARTIAL_SOURCE_FAILURE",
    "DENIED_SCOPE",
    "INSUFFICIENT_EVIDENCE",
  ])("содержит обязательное правило %s", (rule) => {
    expect(MTR_AGENT_ORCHESTRATOR_PROMPT).toContain(rule);
  });

  it("не содержит фактических остатков, конкретной роли пользователя или контактов", () => {
    expect(MTR_AGENT_ORCHESTRATOR_PROMPT).not.toMatch(/\b(?:телефон|e-?mail|@mail|\+7\s*\d)/iu);
    expect(MTR_AGENT_ORCHESTRATOR_PROMPT).not.toMatch(/demo-user|Демо-пользователь|остаток\s*=\s*\d/iu);
  });
});
