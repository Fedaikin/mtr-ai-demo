import "server-only";

import { requirePermission } from "@/application/authorization-service";
import { AgentTaskService, type PersonalReviewTaskSnapshot } from "@/application/agent-orchestrator/task-service";
import type { AgentExecutionContext } from "@/domain/agent/context";
import type {
  DigestComparisonMetric,
  DigestKpiChange,
  DigestPeriod,
  DigestPositionChange,
  DigestRecommendedAction,
  DigestSourceState,
  DigestSpecificationChange,
  PersonalReviewTask,
  PublicDigestKpiChange,
  PublicDigestPositionChange,
  PublicDigestSpecificationChange,
  WeeklyDigest,
  WeeklyDigestRoleView,
} from "@/domain/agent/digest";
import type { WeeklyDigestSourcePort, WeeklyDigestSourceSnapshot } from "@/ports/agent-tasks";

export interface WeeklyDigestServiceOptions {
  readonly now?: () => Date;
}

interface PeriodData {
  readonly specifications: readonly DigestSpecificationChange[];
  readonly positions: readonly DigestPositionChange[];
  readonly kpi: readonly DigestKpiChange[];
  readonly tasks: readonly PersonalReviewTask[];
}

export class WeeklyDigestService {
  private readonly now: () => Date;

  constructor(
    private readonly sources: WeeklyDigestSourcePort,
    private readonly tasks: AgentTaskService,
    options: WeeklyDigestServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async generate(context: AgentExecutionContext): Promise<WeeklyDigest> {
    requirePermission(context.trusted, "agent.chat");
    requirePermission(context.trusted, "project.read");
    const projectId = context.trusted.activeProjectId;
    if (!projectId) throw new WeeklyDigestServiceError("DIGEST_PROJECT_REQUIRED");

    const generatedAt = this.now().toISOString();
    const { period, previousPeriod } = resolveCalendarPeriods(generatedAt, context.timezone);
    const roleView = resolveRoleView(context);
    const source = await this.readSources(context, projectId, period, previousPeriod, generatedAt);
    const taskSnapshot = await this.readTasks(context, roleView, generatedAt);
    const visible = visibleSourceData(source, context, roleView);
    const current = selectPeriod(visible, taskSnapshot.tasks, period);
    const previous = selectPeriod(visible, taskSnapshot.tasks, previousPeriod);

    const sections = Object.freeze({
      specificationChanges: Object.freeze(current.specifications.map(publicSpecification)),
      positionChanges: Object.freeze(current.positions.map(publicPosition)),
      kpiChanges: Object.freeze(current.kpi.map(publicKpi)),
      tasks: Object.freeze(current.tasks),
    });
    const sourceStates = Object.freeze({
      specifications: safeSourceState(source.sources.specifications),
      positions: safeSourceState(source.sources.positions),
      kpi: safeSourceState(source.sources.kpi),
      tasks: taskSourceState(taskSnapshot),
    });
    const comparison = Object.freeze(buildComparison(current, previous));
    const recommendedActions = buildActions(sections);

    return Object.freeze({
      schemaVersion: "mtr-agent-weekly-digest-v1",
      status: digestStatus(sourceStates, sections),
      roleView,
      period,
      previousPeriod,
      generatedAt,
      sources: sourceStates,
      sections,
      comparison,
      recommendedActions,
    });
  }

  private async readSources(
    context: AgentExecutionContext,
    projectId: string,
    period: DigestPeriod,
    previousPeriod: DigestPeriod,
    generatedAt: string,
  ): Promise<WeeklyDigestSourceSnapshot> {
    try {
      return await this.sources.read(context, {
        projectId,
        subjectId: context.trusted.subjectId,
        period,
        previousPeriod,
      });
    } catch {
      const unavailable = unavailableSource(generatedAt, "DIGEST_SOURCE_UNAVAILABLE");
      return {
        snapshotAt: generatedAt,
        sources: { specifications: unavailable, positions: unavailable, kpi: unavailable },
        specificationChanges: [],
        positionChanges: [],
        kpiChanges: [],
      };
    }
  }

  private async readTasks(
    context: AgentExecutionContext,
    roleView: WeeklyDigestRoleView,
    generatedAt: string,
  ): Promise<PersonalReviewTaskSnapshot> {
    if (roleView === "VIEWER" || !context.trusted.permissionKeys.has("review.read")) {
      return { snapshotAt: generatedAt, availability: "COMPLETE", complete: true, tasks: [], missingData: [] };
    }
    try {
      return await this.tasks.listPersonal(context);
    } catch {
      return {
        snapshotAt: generatedAt,
        availability: "UNAVAILABLE",
        complete: false,
        tasks: [],
        missingData: [{ code: "TASK_SOURCE_UNAVAILABLE", message: "Личные задания временно недоступны" }],
      };
    }
  }
}

export class WeeklyDigestServiceError extends Error {
  constructor(readonly code: "DIGEST_PROJECT_REQUIRED" | "DIGEST_TIMEZONE_INVALID") {
    super("Недельная сводка недоступна");
    this.name = "WeeklyDigestServiceError";
  }
}

function resolveRoleView(context: AgentExecutionContext): WeeklyDigestRoleView {
  const roles = context.trusted.projectRoleKeys;
  if (roles.includes("PROJECT_MANAGER")) return "MANAGER";
  if (roles.includes("MTR_EXPERT")) return "EXPERT";
  if (roles.includes("MTR_ANALYST")) return "ANALYST";
  return "VIEWER";
}

function visibleSourceData(
  source: WeeklyDigestSourceSnapshot,
  context: AgentExecutionContext,
  roleView: WeeklyDigestRoleView,
) {
  const projectId = context.trusted.activeProjectId;
  const subjectId = context.trusted.subjectId;
  const affected = (ids: readonly string[]) => ids.length === 0 || ids.includes(subjectId);

  return {
    specifications: source.specificationChanges.filter((item) =>
      item.projectId === projectId &&
      affected(item.affectedSubjectIds) &&
      (item.visibility !== "PERSONAL" || item.affectedSubjectIds.includes(subjectId)) &&
      (roleView !== "VIEWER" || item.visibility === "PUBLISHED"),
    ),
    positions: source.positionChanges.filter((item) => {
      if (item.projectId !== projectId || !affected(item.affectedSubjectIds)) return false;
      if (roleView === "VIEWER") return false;
      if (roleView === "ANALYST") return item.kind === "SHORTAGE";
      if (roleView === "EXPERT") return item.kind === "EXPERT_REVIEW";
      return true;
    }),
    kpi: source.kpiChanges.filter((item) => {
      if (item.projectId !== projectId || item.subjectId && item.subjectId !== subjectId) return false;
      if (roleView === "VIEWER") return false;
      if (roleView === "ANALYST") return item.scope === "PERSONAL";
      if (roleView === "EXPERT") return item.scope === "PERSONAL" || item.scope === "EXPERT";
      return item.scope === "PROJECT" || item.subjectId === subjectId;
    }),
  };
}

function selectPeriod(
  visible: ReturnType<typeof visibleSourceData>,
  tasks: readonly PersonalReviewTask[],
  period: DigestPeriod,
): PeriodData {
  const within = (value: string) => {
    const time = Date.parse(value);
    return Number.isFinite(time) && time >= Date.parse(period.from) && time < Date.parse(period.to);
  };
  return {
    specifications: visible.specifications.filter((item) => within(item.occurredAt)),
    positions: visible.positions.filter((item) => within(item.occurredAt)),
    kpi: visible.kpi.filter((item) => within(item.occurredAt)),
    tasks: tasks.filter((item) => within(item.updatedAt)),
  };
}

function publicSpecification(item: DigestSpecificationChange): PublicDigestSpecificationChange {
  return {
    id: item.id,
    specificationId: item.specificationId,
    title: safeText(item.title, "Изменение спецификации"),
    changeType: item.changeType,
    version: safeText(item.version, "Версия не указана"),
    visibility: item.visibility,
    occurredAt: item.occurredAt,
    href: `/specifications/${encodeURIComponent(item.specificationId)}`,
  };
}

function publicPosition(item: DigestPositionChange): PublicDigestPositionChange {
  return {
    id: item.id,
    specificationId: item.specificationId,
    positionId: item.positionId,
    kind: item.kind,
    title: safeText(item.title, "Позиция требует внимания"),
    occurredAt: item.occurredAt,
    href: `/mtr-analysis?position=${encodeURIComponent(item.positionId)}`,
  };
}

function publicKpi(item: DigestKpiChange): PublicDigestKpiChange {
  return {
    id: item.id,
    scope: item.scope,
    label: safeText(item.label, "Показатель"),
    currentValue: item.currentValue,
    previousValue: item.previousValue,
    unit: safeText(item.unit, ""),
    occurredAt: item.occurredAt,
    href: "/analytics",
  };
}

function buildComparison(current: PeriodData, previous: PeriodData): DigestComparisonMetric[] {
  return [
    comparison("SPECIFICATIONS", current.specifications.length, previous.specifications.length),
    comparison("POSITIONS", current.positions.length, previous.positions.length),
    comparison("KPI", current.kpi.length, previous.kpi.length),
    comparison("TASKS", current.tasks.length, previous.tasks.length),
  ];
}

function comparison(
  key: DigestComparisonMetric["key"],
  current: number,
  previous: number,
): DigestComparisonMetric {
  return { key, current, previous, delta: current - previous };
}

function buildActions(sections: WeeklyDigest["sections"]): WeeklyDigest["recommendedActions"] {
  const candidates: DigestRecommendedAction[] = [];
  const task = sections.tasks[0];
  if (task) candidates.push(action(`task:${task.id}`, "OPEN_TASK", "Открыть личное задание", "Проверьте доказательства и подготовьте решение.", task.href));
  const position = sections.positionChanges[0];
  if (position) candidates.push(action(`position:${position.positionId}`, "REVIEW_POSITION", "Проверить позицию", "Откройте результат и уточните причину сигнала.", position.href));
  const specification = sections.specificationChanges[0];
  if (specification) candidates.push(action(`specification:${specification.specificationId}`, "OPEN_SPECIFICATION", "Проверить спецификацию", "Сверьте изменения с актуальной версией.", specification.href));
  if (sections.kpiChanges.length > 0) candidates.push(action("analytics", "OPEN_ANALYTICS", "Открыть аналитику", "Проверьте динамику показателей и источники.", "/analytics"));
  candidates.push(action("analysis", "OPEN_ANALYSIS", "Открыть МТР-анализ", "Проверьте подтверждённые результаты текущего проекта.", "/mtr-analysis"));
  candidates.push(action("digest", "OPEN_DIGEST", "Открыть Пульс МТР", "Сверьте события текущего проекта.", "/pulse"));
  candidates.push(action("help", "OPEN_HELP", "Открыть справку", "Уточните правила работы с результатами агента.", "/help"));
  return Object.freeze(candidates.slice(0, 3)) as WeeklyDigest["recommendedActions"];
}

function action(
  id: string,
  kind: DigestRecommendedAction["kind"],
  label: string,
  nextStep: string,
  href: string,
): DigestRecommendedAction {
  return Object.freeze({ id, kind, label, nextStep, href: safeHref(href) });
}

function digestStatus(
  sources: WeeklyDigest["sources"],
  sections: WeeklyDigest["sections"],
): WeeklyDigest["status"] {
  const states = Object.values(sources);
  if (states.every((state) => state.availability === "COMPLETE" && state.complete)) return "COMPLETE";
  const content = sections.specificationChanges.length + sections.positionChanges.length + sections.kpiChanges.length + sections.tasks.length;
  return content === 0 && states.every((state) => state.availability === "UNAVAILABLE")
    ? "UNAVAILABLE"
    : "PARTIAL";
}

function safeSourceState(state: DigestSourceState): DigestSourceState {
  return Object.freeze({
    availability: state.availability,
    complete: state.complete,
    snapshotAt: state.snapshotAt && Number.isFinite(Date.parse(state.snapshotAt)) ? state.snapshotAt : null,
    missingData: Object.freeze(state.missingData.map((item) => ({
      code: safeIssueCode(item.code),
      message: "Источник доступен частично",
    }))),
  });
}

function taskSourceState(snapshot: PersonalReviewTaskSnapshot): DigestSourceState {
  return safeSourceState({
    availability: snapshot.availability,
    complete: snapshot.complete,
    snapshotAt: snapshot.snapshotAt,
    missingData: snapshot.missingData,
  });
}

function unavailableSource(snapshotAt: string, code: string): DigestSourceState {
  return { availability: "UNAVAILABLE", complete: false, snapshotAt, missingData: [{ code, message: "Источник временно недоступен" }] };
}

function resolveCalendarPeriods(generatedAt: string, timezone: string): {
  period: DigestPeriod;
  previousPeriod: DigestPeriod;
} {
  try {
    const currentDate = zonedDateParts(new Date(generatedAt), timezone);
    const to = zonedMidnightToUtc(currentDate, timezone);
    const from = zonedMidnightToUtc(addCalendarDays(currentDate, -7), timezone);
    const previousFrom = zonedMidnightToUtc(addCalendarDays(currentDate, -14), timezone);
    return {
      period: Object.freeze({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), timezone }),
      previousPeriod: Object.freeze({ from: new Date(previousFrom).toISOString(), to: new Date(from).toISOString(), timezone }),
    };
  } catch {
    throw new WeeklyDigestServiceError("DIGEST_TIMEZONE_INVALID");
  }
}

interface CalendarDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function zonedDateParts(date: Date, timezone: string): CalendarDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return { year: requiredPart(parts, "year"), month: requiredPart(parts, "month"), day: requiredPart(parts, "day") };
}

function addCalendarDays(date: CalendarDateParts, days: number): CalendarDateParts {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function zonedMidnightToUtc(date: CalendarDateParts, timezone: string): number {
  const target = Date.UTC(date.year, date.month - 1, date.day);
  let candidate = target;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const parts = zonedDateTimeParts(new Date(candidate), timezone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    candidate += target - represented;
  }
  return candidate;
}

function zonedDateTimeParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return {
    year: requiredPart(parts, "year"), month: requiredPart(parts, "month"), day: requiredPart(parts, "day"),
    hour: requiredPart(parts, "hour"), minute: requiredPart(parts, "minute"), second: requiredPart(parts, "second"),
  };
}

function requiredPart(parts: readonly Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const value = Number(parts.find((part) => part.type === type)?.value);
  if (!Number.isInteger(value)) throw new WeeklyDigestServiceError("DIGEST_TIMEZONE_INVALID");
  return value;
}

function safeHref(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") && !/[\r\n]/u.test(value) ? value : "/help";
}

function safeText(value: string, fallback: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, "").trim();
  return normalized && normalized.length <= 300 ? normalized : fallback;
}

function safeIssueCode(value: string): string {
  return /^[A-Z][A-Z0-9_]{0,79}$/u.test(value) ? value : "SOURCE_PARTIAL";
}
