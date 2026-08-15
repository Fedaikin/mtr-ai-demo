export interface AgentFeaturePolicy {
  readonly orchestratorEnabled: boolean;
  readonly actionsEnabled: boolean;
  readonly eventsEnabled: boolean;
  readonly universalChatEnabled?: boolean;
  readonly liveLlmEnabled?: boolean;
  readonly executionAllowed: boolean;
  readonly actionExecutionAllowed: boolean;
}

type AgentFeatureEnvironment = Readonly<Partial<Record<
  | "MTR_AGENT_ORCHESTRATOR_ENABLED"
  | "MTR_AGENT_ACTIONS_ENABLED"
  | "MTR_AGENT_ACTION_MODE"
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
  const actionsEnabled = executionAllowed && enabled(values.MTR_AGENT_ACTIONS_ENABLED);
  const actionExecutionAllowed = actionsEnabled && values.MTR_AGENT_ACTION_MODE?.trim().toUpperCase() !== "PROPOSE_ONLY";
  return Object.freeze({
    orchestratorEnabled,
    actionsEnabled,
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
    actionExecutionAllowed,
  });
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}
