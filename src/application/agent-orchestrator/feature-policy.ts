export interface AgentFeaturePolicy {
  readonly orchestratorEnabled: boolean;
  readonly actionsEnabled: boolean;
  readonly eventsEnabled: boolean;
  readonly executionAllowed: boolean;
}

type AgentFeatureEnvironment = Readonly<Partial<Record<
  | "MTR_AGENT_ORCHESTRATOR_ENABLED"
  | "MTR_AGENT_ACTIONS_ENABLED"
  | "MTR_AGENT_EVENTS_ENABLED"
  | "MTR_AGENT_KILL_SWITCH",
  string
>>>;

export function readAgentFeaturePolicy(
  environment: AgentFeatureEnvironment = process.env,
): AgentFeaturePolicy {
  const orchestratorEnabled = enabled(environment.MTR_AGENT_ORCHESTRATOR_ENABLED);
  const killed = enabled(environment.MTR_AGENT_KILL_SWITCH);
  const executionAllowed = orchestratorEnabled && !killed;
  return Object.freeze({
    orchestratorEnabled,
    actionsEnabled: executionAllowed && enabled(environment.MTR_AGENT_ACTIONS_ENABLED),
    eventsEnabled: executionAllowed && enabled(environment.MTR_AGENT_EVENTS_ENABLED),
    executionAllowed,
  });
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}
