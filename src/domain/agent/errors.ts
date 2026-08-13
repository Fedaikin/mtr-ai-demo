export type AgentCommandExecutionErrorCode =
  | "AGENT_COMMAND_FORBIDDEN"
  | "AGENT_COMMAND_NOT_REGISTERED"
  | "AGENT_PROJECT_CONTEXT_REQUIRED"
  | "AGENT_SELECTION_STALE"
  | "AGENT_WAREHOUSE_SCOPE_DENIED";

export class AgentCommandExecutionError extends Error {
  constructor(readonly code: AgentCommandExecutionErrorCode) {
    super(messageFor(code));
    this.name = "AgentCommandExecutionError";
  }
}

function messageFor(code: AgentCommandExecutionErrorCode): string {
  switch (code) {
    case "AGENT_COMMAND_FORBIDDEN":
      return "Недостаточно прав для выполнения команды МТР-агента";
    case "AGENT_COMMAND_NOT_REGISTERED":
      return "Команда МТР-агента недоступна";
    case "AGENT_PROJECT_CONTEXT_REQUIRED":
      return "Не выбран доступный проект";
    case "AGENT_SELECTION_STALE":
      return "Контекст команды изменился, обновите данные";
    case "AGENT_WAREHOUSE_SCOPE_DENIED":
      return "Запрошенный склад недоступен";
  }
}
