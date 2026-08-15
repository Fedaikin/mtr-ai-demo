import { readAgentFeaturePolicy } from "@/application/agent-orchestrator/feature-policy";

describe("feature policy МТР-агента", () => {
  it("fail-closed без явных флагов", () => {
    expect(readAgentFeaturePolicy({})).toEqual({
      orchestratorEnabled: false,
      actionsEnabled: false,
      eventsEnabled: false,
      executionAllowed: false,
      actionExecutionAllowed: false,
    });
  });

  it("kill switch блокирует execution при включённых возможностях", () => {
    expect(
      readAgentFeaturePolicy({
        MTR_AGENT_ORCHESTRATOR_ENABLED: "true",
        MTR_AGENT_ACTIONS_ENABLED: "true",
        MTR_AGENT_EVENTS_ENABLED: "true",
        MTR_AGENT_KILL_SWITCH: "true",
      }),
    ).toEqual({
      orchestratorEnabled: true,
      actionsEnabled: false,
      eventsEnabled: false,
      executionAllowed: false,
      actionExecutionAllowed: false,
    });
  });

  it("разрешает execution только при явном включении и снятом kill switch", () => {
    expect(
      readAgentFeaturePolicy({
        MTR_AGENT_ORCHESTRATOR_ENABLED: "true",
        MTR_AGENT_ACTIONS_ENABLED: "true",
        MTR_AGENT_EVENTS_ENABLED: "true",
        MTR_AGENT_KILL_SWITCH: "false",
      }),
    ).toEqual({
      orchestratorEnabled: true,
      actionsEnabled: true,
      eventsEnabled: true,
      executionAllowed: true,
      actionExecutionAllowed: true,
    });
  });

  it("включает live LLM только вместе с orchestrator и отключает kill switch", () => {
    expect(readAgentFeaturePolicy({
      MTR_AGENT_ORCHESTRATOR_ENABLED: "true",
      MTR_AGENT_UNIVERSAL_CHAT_ENABLED: "true",
      MTR_AGENT_LIVE_LLM_ENABLED: "true",
      MTR_AGENT_KILL_SWITCH: "false",
    })).toEqual({
      orchestratorEnabled: true,
      actionsEnabled: false,
      eventsEnabled: false,
      universalChatEnabled: true,
      liveLlmEnabled: true,
      executionAllowed: true,
      actionExecutionAllowed: false,
    });

    expect(readAgentFeaturePolicy({
      MTR_AGENT_ORCHESTRATOR_ENABLED: "true",
      MTR_AGENT_UNIVERSAL_CHAT_ENABLED: "true",
      MTR_AGENT_LIVE_LLM_ENABLED: "true",
      MTR_AGENT_KILL_SWITCH: "true",
    })).toMatchObject({
      universalChatEnabled: false,
      liveLlmEnabled: false,
      executionAllowed: false,
    });
  });

  it("оставляет proposal/cancel доступными, но запрещает confirm в PROPOSE_ONLY", () => {
    expect(readAgentFeaturePolicy({
      MTR_AGENT_ORCHESTRATOR_ENABLED: "true",
      MTR_AGENT_ACTIONS_ENABLED: "true",
      MTR_AGENT_ACTION_MODE: "PROPOSE_ONLY",
    })).toMatchObject({
      actionsEnabled: true,
      executionAllowed: true,
      actionExecutionAllowed: false,
    });
  });
});
