import "server-only";

import { createHash } from "node:crypto";

import {
  listAccessUsers,
  listProjectMembers,
} from "@/application/access-administration";
import { AgentActionService } from "@/application/agent-orchestrator/action-service";
import { AgentCaseService } from "@/application/agent-orchestrator/case-service";
import {
  buildPrivilegedActionImpact,
  privilegedActionPermission,
  resolvePrivilegedActionResource,
} from "@/application/agent-orchestrator/privileged-action-executor";
import { requirePermission, type TrustedRequestContext } from "@/application/authorization-service";
import { toPublicAgentActionProposal, type PublicAgentActionProposal } from "@/domain/agent/actions";
import {
  type PrivilegedActionParameters,
} from "@/domain/agent/privileged-actions";
import type { RoleKey } from "@/domain/rbac";

export interface PrivilegedActionChatResult {
  readonly content: string;
  readonly structuredOutput: Readonly<{
    schemaVersion: "agent-privileged-action-v1";
    actionProposal: PublicAgentActionProposal | null;
    clarification: string | null;
  }>;
}

export class PrivilegedActionChatService {
  constructor(
    private readonly actions: AgentActionService,
    private readonly cases: AgentCaseService,
  ) {}

  async prepare(
    message: string,
    threadId: string,
    context: TrustedRequestContext,
  ): Promise<PrivilegedActionChatResult | null> {
    const kind = detectIntentKind(message);
    if (!kind) return null;
    requirePermission(context, "agent.chat");
    if (!context.activeProjectId) return clarification("Сначала выберите рабочий проект.");

    const resolved = await resolveParameters(kind, message, context);
    if ("clarification" in resolved) return clarification(resolved.clarification);
    const permission = privilegedActionPermission(resolved);
    requirePermission(context, permission);
    if ("targetUserId" in resolved && resolved.targetUserId === context.subjectId) {
      return clarification("Изменять собственный доступ или роли через чат нельзя.");
    }
    const impact = await buildPrivilegedActionImpact(resolved, context);
    if (impact.segregationOfDuties === "BLOCKED") {
      return clarification("Действие нарушает разделение обязанностей и не может быть предложено.");
    }
    if (impact.lastAdministratorRisk || impact.lastProjectManagerRisk) {
      return clarification("Действие лишит контур последнего администратора или руководителя проекта и запрещено.");
    }
    if (resolved.actionType === "SET_ROLE_STATUS" && !resolved.active && impact.affectedAssignments > 0) {
      return clarification("У роли есть активные назначения. Сначала нужен отдельно утверждённый план переназначения.");
    }
    const resource = await resolvePrivilegedActionResource(resolved, context);
    if (!resource) return clarification("Объект изменился или больше недоступен. Обновите запрос.");
    const requestKey = hash(message.normalize("NFKC").trim());
    const agentCase = await this.cases.create({
      title: `Управление доступом: ${impact.targetDisplayName}`,
      threadId,
      requestKey: `access-${requestKey}`,
    }, context);
    const proposal = await this.actions.propose({
      caseId: agentCase.id,
      actionType: resolved.actionType,
      resource,
      summary: impact.newState,
      consequences: consequences(resolved, impact),
      parameters: { ...withoutActionType(resolved), impact },
      requestKey,
    }, context);
    const publicProposal = toPublicAgentActionProposal(proposal);
    return {
      content: `Подготовлено действие «${publicProposal.summary}». Проверьте сотрудника, роли и последствия в карточке, затем отдельно подтвердите или отмените.`,
      structuredOutput: {
        schemaVersion: "agent-privileged-action-v1",
        actionProposal: publicProposal,
        clarification: null,
      },
    };
  }
}

type IntentKind = PrivilegedActionParameters["actionType"];

function detectIntentKind(message: string): IntentKind | null {
  const value = normalize(message);
  if (!/(?:заблок|разблок|активир|приостанов|возобнов|назнач|смени|сменить|отзов|отозв|деактив)/u.test(value)) return null;
  // JavaScript `\b` only understands ASCII word characters. Using it around
  // Russian nouns makes otherwise exact privileged commands silently miss
  // this guarded path and fall through to ordinary chat.
  if (/(?:деактив|активир).*роль/u.test(value) && !/(?:сотрудник|пользовател|логин)/u.test(value)) return "SET_ROLE_STATUS";
  if (/(?:приостанов|возобнов).*(?:доступ|участие)/u.test(value)) return "SET_PROJECT_MEMBERSHIP_STATUS";
  if (/(?:смени|сменить).*роль/u.test(value)) return "CHANGE_PROJECT_ROLE";
  if (/(?:отзов|отозв).*роль/u.test(value)) return "REVOKE_ROLE_ASSIGNMENT";
  if (/(?:назнач).*роль/u.test(value)) return findRoleKey(value) && isGlobalRole(findRoleKey(value)!) ? "ASSIGN_GLOBAL_ROLE" : "ASSIGN_PROJECT_ROLE";
  if (/(?:заблок|разблок|активир).*(?:сотрудник|пользовател|учетн|учётн|логин)/u.test(value)) return "SET_USER_STATUS";
  if (/заблок.*роль/u.test(value)) return "SET_ROLE_STATUS";
  return null;
}

async function resolveParameters(
  kind: IntentKind,
  message: string,
  context: TrustedRequestContext,
): Promise<PrivilegedActionParameters | { clarification: string }> {
  const normalized = normalize(message);
  if (kind === "SET_ROLE_STATUS") {
    if (/заблок.*роль/u.test(normalized)) {
      return { clarification: "Уточните: отозвать роль у сотрудника или деактивировать определение роли?" };
    }
    const roleKey = findRoleKey(normalized);
    if (!roleKey || isGlobalRole(roleKey) || roleKey === "INTEGRATION_SERVICE") {
      return { clarification: "Укажите одну проектную роль. Защищённые глобальные и сервисные роли через чат не деактивируются." };
    }
    return {
      actionType: kind,
      roleKey,
      active: !/деактив/u.test(normalized),
      approvedReassignmentPlan: false,
    };
  }

  const projectAction = kind === "SET_PROJECT_MEMBERSHIP_STATUS" || kind === "ASSIGN_PROJECT_ROLE" || kind === "CHANGE_PROJECT_ROLE";
  requirePermission(context, projectAction ? "project.members.manage" : kind === "SET_USER_STATUS" ? "user.manage" : "global_role.manage");
  const candidates = projectAction
    ? await listProjectMembers(context.activeProjectId!)
    : await listAccessUsers();
  const target = resolveUser(message, candidates);
  if (target.status !== "FOUND") {
    return {
      clarification: target.status === "AMBIGUOUS"
        ? "Найдено несколько сотрудников. Укажите точный login."
        : "Не удалось однозначно найти сотрудника. Укажите точный login или полное отображаемое имя.",
    };
  }
  const targetUserId = target.userId;

  if (kind === "SET_USER_STATUS") {
    return { actionType: kind, targetUserId, status: /разблок|активир/u.test(normalized) ? "ACTIVE" : "BLOCKED" };
  }
  if (kind === "SET_PROJECT_MEMBERSHIP_STATUS") {
    return {
      actionType: kind,
      targetUserId,
      projectId: context.activeProjectId!,
      status: /возобнов|активир/u.test(normalized) ? "ACTIVE" : "SUSPENDED",
    };
  }

  const roleKey = findRoleKey(normalized);
  if (!roleKey || roleKey === "INTEGRATION_SERVICE") return { clarification: "Укажите точную роль сотрудника." };
  const assignments = userAssignments(
    target.raw,
    projectAction ? context.activeProjectId : null,
  );
  if (kind === "ASSIGN_PROJECT_ROLE") {
    if (isGlobalRole(roleKey)) return { clarification: "Для глобальной роли используйте явную команду назначения глобальной роли." };
    return { actionType: kind, targetUserId, projectId: context.activeProjectId!, roleKey, validUntil: null };
  }
  if (kind === "ASSIGN_GLOBAL_ROLE") {
    if (!isGlobalRole(roleKey)) return { clarification: "Укажите глобальную роль: Системный администратор или Аудитор." };
    return { actionType: kind, targetUserId, roleKey, validUntil: null };
  }
  if (kind === "REVOKE_ROLE_ASSIGNMENT") {
    const matching = assignments.filter((item) => item.roleKey === roleKey && item.status === "ACTIVE");
    if (matching.length !== 1) return { clarification: "Активное назначение роли не найдено однозначно." };
    return {
      actionType: kind,
      targetUserId,
      assignmentId: matching[0]!.assignmentId,
      roleKey,
      projectId: matching[0]!.projectId,
    };
  }
  if (isGlobalRole(roleKey)) return { clarification: "Глобальную роль нельзя менять как проектную." };
  const current = assignments.filter((item) => item.projectId === context.activeProjectId && item.status === "ACTIVE" && isProjectRole(item.roleKey));
  if (current.length !== 1) return { clarification: "Текущая проектная роль сотрудника не определена однозначно." };
  return {
    actionType: "CHANGE_PROJECT_ROLE",
    targetUserId,
    projectId: context.activeProjectId!,
    currentAssignmentId: current[0]!.assignmentId,
    fromRoleKey: current[0]!.roleKey as Extract<RoleKey, "PROJECT_VIEWER" | "MTR_ANALYST" | "MTR_EXPERT" | "PROJECT_MANAGER">,
    toRoleKey: roleKey,
  };
}

function resolveUser(message: string, rows: Array<Record<string, unknown>>):
  | { status: "FOUND"; userId: string; raw: Record<string, unknown> }
  | { status: "NONE" | "AMBIGUOUS" } {
  const normalized = normalize(message);
  const humans = rows.filter((row) => row.account_type !== "SERVICE_ACCOUNT");
  const byLogin = humans.filter((row) => {
    const login = normalize(String(row.login ?? ""));
    return login && new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(login)}(?:$|[^\\p{L}\\p{N}])`, "u").test(normalized);
  });
  const matches = byLogin.length > 0 ? byLogin : humans.filter((row) => {
    const name = normalize(String(row.display_name ?? ""));
    return name.length >= 3 && normalized.includes(name);
  });
  if (matches.length === 0) return { status: "NONE" };
  if (matches.length > 1) return { status: "AMBIGUOUS" };
  const row = matches[0]!;
  const userId = String(row.user_id ?? row.id ?? "");
  return userId ? { status: "FOUND", userId, raw: row } : { status: "NONE" };
}

interface AssignmentView {
  assignmentId: string;
  roleKey: RoleKey;
  projectId: string | null;
  status: string;
}

function userAssignments(
  row: Record<string, unknown>,
  defaultProjectId: string | null,
): AssignmentView[] {
  const value = Array.isArray(row.assignments) ? row.assignments : Array.isArray(row.roles) ? row.roles : [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const roleKey = String(record.roleKey ?? "") as RoleKey;
    const assignmentId = String(record.assignmentId ?? "");
    return assignmentId && isSupportedHumanRole(roleKey)
      ? [{
          assignmentId,
          roleKey,
          projectId: typeof record.projectId === "string" ? record.projectId : defaultProjectId,
          status: String(record.status ?? ""),
        }]
      : [];
  });
}

function findRoleKey(value: string): RoleKey | null {
  if (/системн.*админист/u.test(value)) return "SYSTEM_ADMIN";
  if (/аудитор/u.test(value)) return "AUDITOR";
  if (/руководител.*проект/u.test(value)) return "PROJECT_MANAGER";
  if (/аналитик.*мтр/u.test(value)) return "MTR_ANALYST";
  if (/эксперт.*мтр/u.test(value)) return "MTR_EXPERT";
  if (/наблюдател.*проект/u.test(value)) return "PROJECT_VIEWER";
  return null;
}

function consequences(
  parameters: PrivilegedActionParameters,
  impact: Awaited<ReturnType<typeof buildPrivilegedActionImpact>>,
): string[] {
  const items = [
    `Текущее состояние: ${impact.currentStatus}. Новое состояние: ${impact.newState}.`,
    `Активных сессий будет затронуто: ${impact.affectedSessions}.`,
    `Назначений ролей будет затронуто: ${impact.affectedAssignments}.`,
    "Права и состояние объекта будут повторно проверены непосредственно перед выполнением.",
  ];
  if (parameters.actionType !== "SET_ROLE_STATUS") items.push("Authorization version пользователя будет увеличена, активные сессии — отозваны.");
  return items;
}

function clarification(message: string): PrivilegedActionChatResult {
  return {
    content: message,
    structuredOutput: {
      schemaVersion: "agent-privileged-action-v1",
      actionProposal: null,
      clarification: message,
    },
  };
}

function isGlobalRole(value: RoleKey): value is "SYSTEM_ADMIN" | "AUDITOR" {
  return value === "SYSTEM_ADMIN" || value === "AUDITOR";
}

function isProjectRole(value: RoleKey): value is "PROJECT_VIEWER" | "MTR_ANALYST" | "MTR_EXPERT" | "PROJECT_MANAGER" {
  return (["PROJECT_VIEWER", "MTR_ANALYST", "MTR_EXPERT", "PROJECT_MANAGER"] as readonly RoleKey[]).includes(value);
}

function isSupportedHumanRole(value: RoleKey): boolean {
  return isGlobalRole(value) || isProjectRole(value);
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function withoutActionType(parameters: PrivilegedActionParameters): Record<string, unknown> {
  const stored = { ...parameters } as Record<string, unknown>;
  delete stored.actionType;
  return stored;
}
