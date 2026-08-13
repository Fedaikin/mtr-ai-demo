export const DEMO_PERSONAS = [
  { login: "viewer", label: "Наблюдатель проекта", description: "Просмотр проекта, каталога и отчётов" },
  { login: "analyst", label: "Аналитик МТР", description: "Загрузка спецификаций и запуск анализа" },
  { login: "expert", label: "Эксперт МТР", description: "Даблчекер и решения экспертной очереди" },
  { login: "demo", label: "Менеджер проекта", description: "Команда, отклонения и узкие места проекта" },
  { login: "director", label: "Руководитель", description: "KPI, SLA, критические риски и варианты решений" },
  { login: "admin", label: "Системный администратор", description: "Пользователи, роли и конфигурация" },
  { login: "auditor", label: "Аудитор", description: "Глобальный аудит без права изменений" },
] as const;

export type DemoPersonaLogin = (typeof DEMO_PERSONAS)[number]["login"];

export const DEMO_PERSONA_LOGINS = DEMO_PERSONAS.map((persona) => persona.login) as [DemoPersonaLogin, ...DemoPersonaLogin[]];

export type DashboardAudience = "OBSERVER" | "SPECIALIST" | "MANAGER" | "EXECUTIVE";

export function dashboardAudienceForPersona(
  login: string | undefined,
  projectRoleKeys: readonly string[],
): DashboardAudience {
  if (login === "director") return "EXECUTIVE";
  if (projectRoleKeys.includes("PROJECT_MANAGER")) return "MANAGER";
  if (projectRoleKeys.includes("MTR_ANALYST") || projectRoleKeys.includes("MTR_EXPERT")) return "SPECIALIST";
  return "OBSERVER";
}

export function landingPathForPermissions(permissionKeys: ReadonlySet<string>): string {
  if (permissionKeys.has("project.read")) return "/";
  if (permissionKeys.has("user.manage")) return "/admin/users";
  if (permissionKeys.has("audit.read.global")) return "/admin/audit";
  return "/forbidden";
}
