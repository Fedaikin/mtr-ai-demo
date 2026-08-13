import type { TrustedRequestContext } from "@/application/authorization-service";
import type { PermissionKey } from "@/domain/rbac";

export const AGENT_COMMAND_KEYS = ["SUMMARY", "MY_TASKS", "RISKS", "STOCKS", "KPI"] as const;
export type AgentCommandKey = (typeof AGENT_COMMAND_KEYS)[number];

export interface AgentCommandDefinition {
  readonly key: AgentCommandKey;
  readonly label: string;
  readonly description: string;
  readonly requiredPermissions: readonly PermissionKey[];
  readonly readOnly: true;
}

export const AGENT_COMMANDS: readonly AgentCommandDefinition[] = Object.freeze([
  {
    key: "SUMMARY",
    label: "Оперативная сводка",
    description: "Показать подтверждённую сводку в выбранном контексте проекта.",
    requiredPermissions: ["agent.chat", "project.read"],
    readOnly: true,
  },
  {
    key: "MY_TASKS",
    label: "Мои задачи",
    description: "Показать только задания, назначенные текущему пользователю.",
    requiredPermissions: ["agent.chat", "review.read"],
    readOnly: true,
  },
  {
    key: "RISKS",
    label: "Риски",
    description: "Показать риски с доказанным охватом и источниками.",
    requiredPermissions: ["agent.chat", "analysis.read"],
    readOnly: true,
  },
  {
    key: "STOCKS",
    label: "Остатки",
    description: "Показать разрешённые остатки и актуальность снимка.",
    requiredPermissions: ["agent.chat", "stock.search"],
    readOnly: true,
  },
  {
    key: "KPI",
    label: "KPI и SLA",
    description: "Показать versioned KPI/SLA разрешённого проекта.",
    requiredPermissions: ["agent.chat", "analysis.read", "project.read"],
    readOnly: true,
  },
]);

export function getAgentCommand(key: string): AgentCommandDefinition | undefined {
  return AGENT_COMMANDS.find((command) => command.key === key);
}

export function isAgentCommandAllowed(
  context: Pick<TrustedRequestContext, "permissionKeys">,
  command: AgentCommandDefinition,
): boolean {
  return command.requiredPermissions.every((permission) => context.permissionKeys.has(permission));
}

export function getAvailableAgentCommands(
  context: Pick<TrustedRequestContext, "permissionKeys">,
): readonly AgentCommandDefinition[] {
  return AGENT_COMMANDS.filter((command) => isAgentCommandAllowed(context, command));
}
