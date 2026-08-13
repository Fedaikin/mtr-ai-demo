import { readAgentFeaturePolicy } from "@/application/agent-orchestrator/feature-policy";

describe("feature policy МТР-агента", () => {
  it("fail-closed без явных флагов", () => {
    expect(readAgentFeaturePolicy({})).toEqual({
      orchestratorEnabled: false,
      actionsEnabled: false,
      eventsEnabled: false,
      executionAllowed: false,
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
    });
  });
});
