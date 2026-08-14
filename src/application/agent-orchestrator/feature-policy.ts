export interface AgentFeaturePolicy {
  readonly orchestratorEnabled: boolean;
  readonly actionsEnabled: boolean;
  readonly eventsEnabled: boolean;
  readonly universalChatEnabled?: boolean;
  readonly liveLlmEnabled?: boolean;
  readonly executionAllowed: boolean;
}

type AgentFeatureEnvironment = Readonly<Partial<Record<
  | "MTR_AGENT_ORCHESTRATOR_ENABLED"
  | "MTR_AGENT_ACTIONS_ENABLED"
  | "MTR_AGENT_EVENTS_ENABLED"
  | "MTR_AGENT_UNIVERSAL_CHAT_ENABLED"
  | "MTR_AGENT_LIVE_LLM_ENABLED"
  | "MTR_AGENT_KILL_SWITCH",
  string
>>>;

export function readAgentFeaturePolicy(
  environment?: AgentFeatureEnvironment,
): AgentFeaturePolicy {
  const values = environment ?? process.env;
  const orchestratorEnabled = enabled(values.MTR_AGENT_ORCHESTRATOR_ENABLED);
  const killed = enabled(values.MTR_AGENT_KILL_SWITCH);
  const executionAllowed = orchestratorEnabled && !killed;
  return Object.freeze({
    orchestratorEnabled,
    actionsEnabled: executionAllowed && enabled(values.MTR_AGENT_ACTIONS_ENABLED),
    eventsEnabled: executionAllowed && enabled(values.MTR_AGENT_EVENTS_ENABLED),
    ...(values.MTR_AGENT_UNIVERSAL_CHAT_ENABLED === undefined
      ? {}
      : {
          universalChatEnabled:
            executionAllowed && enabled(values.MTR_AGENT_UNIVERSAL_CHAT_ENABLED),
        }),
    ...(values.MTR_AGENT_LIVE_LLM_ENABLED === undefined
      ? {}
      : {
          liveLlmEnabled:
            executionAllowed && enabled(values.MTR_AGENT_LIVE_LLM_ENABLED),
        }),
    executionAllowed,
  });
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}
