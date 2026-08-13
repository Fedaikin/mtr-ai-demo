export const AGENT_CONTEXT_RESET_EVENT = "mtr-agent-context-reset";

/** Clears client-only agent state before a new authorization context renders. */
export function resetAgentClientContext(): void {
  window.dispatchEvent(new Event(AGENT_CONTEXT_RESET_EVENT));
}
