import type { AgentExecutionContext } from "@/domain/agent/context";
import type {
  UniversalAgentAnswer,
  UniversalCitation,
  UniversalClarification,
  UniversalCompatibilityResult,
  UniversalEntityRef,
  UniversalRecommendationCard,
  UniversalResolvedContext,
  UniversalRiskCard,
} from "@/domain/agent/universal-chat/answer";
import type { BusinessProject, SpecificationIntakeItem } from "@/domain/agent/universal-chat/dataset";
import { resolveEntity, type EntityResolution } from "@/domain/agent/universal-chat/entity-resolution";
import {
  createSystemScenarioClock,
  moscowCalendarDay,
  type ScenarioClock,
} from "@/domain/agent/universal-chat/scenario-clock";
import {
  calculateProjectMaterialBalance,
  calculateQuantityCoveragePercent,
  PROJECT_MATERIAL_BALANCE_FORMULA_VERSION,
} from "@/application/agent-orchestrator/universal-chat/project-stock-formulas";
import type {
  UniversalMaterialRecord,
  UniversalPositionRecord,
  UniversalSpecificationRecord,
  UniversalSpecificationVersionRecord,
} from "@/ports/universal-agent";

import {
  UniversalCapabilityRegistry,
  type UniversalReadCapabilityKey,
} from "./capability-registry";

export const UNIVERSAL_CHAT_RUNTIME_VERSION = "universal-read-runtime-v1" as const;

export interface UniversalChatMemory {
  readonly resolvedContext?: UniversalResolvedContext;
  readonly shortageMaterialCodes?: readonly string[];
}

export interface UniversalChatServiceRequest {
  readonly message: string;
  readonly threadId?: string;
  readonly memory?: UniversalChatMemory | null;
}

export type UniversalChatServiceResult = UniversalAgentAnswer | UniversalClarification | null;

export class UniversalChatService {
  constructor(
    private readonly capabilities: UniversalCapabilityRegistry,
    private readonly clock: ScenarioClock = createSystemScenarioClock(),
  ) {}

  async respond(
    request: UniversalChatServiceRequest,
    context: AgentExecutionContext,
  ): Promise<UniversalChatServiceResult> {
    const message = request.message.trim();
    const normalized = message.toLocaleLowerCase("ru-RU");
    if (!message) return null;

    if (asksProjectStatusSequence(normalized)) return this.projectStatusSequence(context);
    if (asksPlannedProjects(normalized)) return this.projectsByStatus(context, ["PLANNED"], "Запланированные проекты");
    if (asksAllProjects(normalized)) return this.projectsByStatus(context, ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED"], "Все доступные проекты");
    if (asksActiveProjects(normalized)) return this.activeProjects(context);
    if (asksSpecificationIntake(normalized)) return this.specificationIntake(context, normalized);
    if (asksSpecificationVersionChange(normalized)) return this.specificationVersionChange(context, message);
    if (asksPositionsForReview(normalized)) return this.positionsForReview(context);
    if (asksUpcomingDeadlines(normalized)) return this.upcomingDeadlines(context, normalized);
    if (asksPortfolioAttention(normalized)) return this.portfolioAttention(context, normalized);
    if (asksPortfolioExhaustion(normalized)) return this.portfolioExhaustion(context, requestedDays(normalized) ?? 30);

    const materialCodes = extractMaterialCodes(message);
    // An explicit public material code is a stronger signal than generic words
    // such as «материал», which also appear in project-level questions. Resolve
    // it before project intent routing so an unknown code produces an honest
    // material answer instead of unrelated project candidates.
    if (materialCodes.length > 0 && !(/проект/iu.test(normalized) && asksProjectQuestion(normalized))) {
      return this.materialQuestion(context, message, normalized, materialCodes);
    }
    if (asksInventoryExistence(normalized)) {
      return this.materialQuestion(context, message, normalized, materialCodes);
    }
    const rememberedMaterialCode = request.memory?.resolvedContext?.material?.code;
    if (rememberedMaterialCode && asksWarehouseFollowup(normalized)) {
      return this.materialQuestion(context, message, normalized, [rememberedMaterialCode]);
    }

    const projects = await this.execute<readonly BusinessProject[]>("project.list", context, {
      status: ["ACTIVE", "ON_HOLD", "PLANNED"],
      limit: 200,
    });
    const projectResolution = resolveProject(
      message,
      projects,
      request.memory?.resolvedContext?.businessProject?.id,
    );
    if (projectResolution.kind === "AMBIGUOUS") {
      return clarification("Уточните, по какому проекту выполнить расчёт?", projectResolution);
    }

    if (asksProjectQuestion(normalized)) {
      if (projectResolution.kind !== "RESOLVED") {
        return {
          kind: "ASK_CLARIFICATION",
          question: "Уточните проект по названию или коду.",
          candidates: projects.slice(0, 5).map((project) => entityRef("BUSINESS_PROJECT", project, 1)),
        };
      }
      const purpose = requestedPurpose(normalized) ?? request.memory?.resolvedContext?.purpose;
      if (asksSpecifications(normalized)) {
        return this.projectSpecifications(context, projectResolution.entity, purpose);
      }
      return this.projectMaterials(
        context,
        projectResolution.entity,
        normalized,
        purpose,
        request.memory?.shortageMaterialCodes,
      );
    }

    if (asksMaterialQuestion(normalized)) {
      return this.materialQuestion(context, message, normalized, materialCodes);
    }
    return null;
  }

  private async activeProjects(context: AgentExecutionContext): Promise<UniversalAgentAnswer> {
    return this.projectsByStatus(context, ["ACTIVE"], "Активные проекты");
  }

  private async projectStatusSequence(
    context: AgentExecutionContext,
  ): Promise<UniversalAgentAnswer> {
    const [active, planned, all] = await Promise.all([
      this.execute<readonly BusinessProject[]>("project.list", context, {
        status: ["ACTIVE"],
        limit: 200,
      }),
      this.execute<readonly BusinessProject[]>("project.list", context, {
        status: ["PLANNED"],
        limit: 200,
      }),
      this.execute<readonly BusinessProject[]>("project.list", context, {
        status: ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED"],
        limit: 200,
      }),
    ]);
    const table = (id: string, title: string, projects: readonly BusinessProject[]) => ({
      id,
      title,
      columns: ["Проект", "Статус", "Фаза", "Дата потребности"],
      rows: projects.map((project) => ({
        "Проект": `${project.name} (${project.code})`,
        "Статус": projectStatus(project.status),
        "Фаза": projectPhase(project.phase),
        "Дата потребности": localDate(project.needDate),
      })),
      totalRows: projects.length,
    });
    return answer({
      summary: `Активных проектов: ${active.length}; запланированных: ${planned.length}; всего доступно: ${all.length}.`,
      facts: [
        fact("active-project-count", "Активных проектов", active.length),
        fact("planned-project-count", "Запланированных проектов", planned.length),
        fact("all-project-count", "Всего доступно проектов", all.length),
      ],
      tables: [
        table("active-projects", "Активные проекты", active),
        table("planned-projects", "Запланированные проекты", planned),
        table("all-projects", "Все доступные проекты", all),
      ],
      citations: uniqueCitations(all.map(projectCitation)),
      missingData: [],
      confidence: 1,
      requiresHumanReview: false,
    }, this.clock);
  }

  private async projectsByStatus(
    context: AgentExecutionContext,
    statuses: readonly BusinessProject["status"][],
    title: string,
  ): Promise<UniversalAgentAnswer> {
    const projects = await this.execute<readonly BusinessProject[]>("project.list", context, {
      status: [...statuses],
      limit: 200,
    });
    const activeOnly = statuses.length === 1 && statuses[0] === "ACTIVE";
    const plannedOnly = statuses.length === 1 && statuses[0] === "PLANNED";
    return answer({
      summary: projects.length
        ? activeOnly
          ? `Доступно ${projects.length} активных бизнес-проекта.`
          : plannedOnly
            ? `Доступно ${projects.length} запланированных бизнес-проектов.`
            : `Всего доступно бизнес-проектов: ${projects.length}.`
        : plannedOnly
          ? "Запланированных бизнес-проектов в текущем контуре доступа нет."
          : "В текущем контуре доступа проекты не найдены.",
      facts: [
        fact("project-count", "Проектов", projects.length),
        fact("project-at-risk", "С риском по срокам", projects.filter((project) => project.deadlines.some((deadline) => deadline.status === "AT_RISK")).length, undefined, "ATTENTION"),
      ],
      tables: [{
        id: "active-projects",
        title,
        columns: ["Проект", "Статус", "Фаза", "Дата потребности"],
        rows: projects.map((project) => ({
          "Проект": `${project.name} (${project.code})`,
          "Статус": projectStatus(project.status),
          "Фаза": projectPhase(project.phase),
          "Дата потребности": localDate(project.needDate),
        })),
        totalRows: projects.length,
      }],
      citations: projects.map(projectCitation),
      missingData: projects.length || plannedOnly ? [] : [{
        code: "PROJECT_SCOPE_EMPTY",
        message: "В текущем контуре доступа нет подтверждённых бизнес-проектов.",
        impact: "Нельзя делать вывод об отсутствии проектов вне разрешённого контура.",
      }],
      confidence: projects.length || plannedOnly ? 1 : 0,
      requiresHumanReview: projects.length === 0 && !plannedOnly,
    }, this.clock);
  }

  private async upcomingDeadlines(
    context: AgentExecutionContext,
    message: string,
  ): Promise<UniversalAgentAnswer> {
    const withinDays = requestedDays(message) ?? 3;
    const rows = await this.execute<ReadonlyArray<{
      project: BusinessProject;
      deadline: BusinessProject["deadlines"][number];
    }>>("deadline.listUpcoming", context, { withinDays, limit: 200 });
    const projectIds = [...new Set(rows.map(({ project }) => project.id))];
    const specificationsByProject = new Map(await Promise.all(projectIds.map(async (projectId) => [
      projectId,
      await this.execute<readonly UniversalSpecificationRecord[]>(
        "project.listSpecifications",
        context,
        { projectId, limit: 200 },
      ),
    ] as const)));
    return answer({
      summary: rows.length
        ? `В ближайшие ${withinDays} дн. найдено сроков: ${rows.length}.`
        : `В ближайшие ${withinDays} дн. сроков по доступным проектам нет.`,
      facts: [fact("deadline-count", "Ближайших сроков", rows.length, undefined, rows.length ? "ATTENTION" : "NORMAL")],
      tables: [{
        id: "upcoming-deadlines",
        title: "Ближайшие сроки",
        columns: ["Проект", "Спецификации", "Событие", "Срок", "Статус"],
        rows: rows.map(({ project, deadline }) => ({
          "Проект": project.name,
          "Спецификации": (specificationsByProject.get(project.id) ?? [])
            .map((specification) => specification.specificationId)
            .sort((left, right) => left.localeCompare(right, "en"))
            .join(", "),
          "Событие": deadlineKind(deadline.kind),
          "Срок": localDate(deadline.dueAt),
          "Статус": deadlineStatus(deadline.status),
        })),
        totalRows: rows.length,
      }],
      citations: uniqueCitations([
        ...rows.map(({ project }) => projectCitation(project)),
        ...projectIds.flatMap((projectId) => (specificationsByProject.get(projectId) ?? [])
          .map((specification) => specificationCitation(specification, this.clock.now().toISOString()))),
      ]),
      missingData: rows.length ? [] : [{
        code: "DEADLINE_SCOPE_EMPTY",
        message: "В доступном контуре нет подтверждённых сроков для выбранного горизонта.",
        impact: "Нельзя делать вывод о сроках вне разрешённого контура.",
      }],
      confidence: rows.length ? 1 : 0,
      requiresHumanReview: rows.length === 0,
    }, this.clock);
  }

  private async specificationIntake(
    context: AgentExecutionContext,
    message: string,
  ): Promise<UniversalAgentAnswer> {
    const day = moscowCalendarDay(this.clock);
    // The summary and the queue must share one complete, time-bounded source
    // population. Querying the open queue first silently dropped today's
    // COMPLETED/CANCELLED rows and mixed older records into today's counts.
    const rows = await this.execute<readonly SpecificationIntakeItem[]>("specification.getStatusBreakdown", context, {
      from: day.startsAt,
      to: day.endsAtExclusive,
    });
    const statusCounts = countBy(rows, (item) => item.status);
    const failedOnly = asksFailedIntake(message);
    const pendingRows = rows.filter((item) => !["COMPLETED", "CANCELLED"].includes(item.status));
    const visibleRows = failedOnly
      ? rows.filter((item) => item.status === "FAILED")
      : asksQueue(message)
        ? pendingRows
        : rows;
    const pending = pendingRows.length;
    return answer({
      summary: failedOnly
        ? `Сегодня с ошибкой: ${visibleRows.length}.`
        : `Сегодня получено ${rows.length}, завершено ${statusCounts.get("COMPLETED") ?? 0}, осталось обработать ${pending}.`,
      facts: [
        fact("received", "Получено", rows.length),
        fact("completed", "Завершено", statusCounts.get("COMPLETED") ?? 0),
        fact("pending", "Осталось", pending, undefined, pending ? "ATTENTION" : "NORMAL"),
        fact("needs-review", "Требуют проверки", statusCounts.get("NEEDS_REVIEW") ?? 0, undefined, "ATTENTION"),
        fact("failed", "С ошибкой", statusCounts.get("FAILED") ?? 0, undefined, "CRITICAL"),
      ],
      tables: [{
        id: "specification-intake",
        title: failedOnly ? "Ошибки загрузки" : "Обработка спецификаций",
        columns: ["Спецификация", "Статус", "Шаг", "Получено", "SLA"],
        rows: visibleRows.map((item) => ({
          "Спецификация": item.specificationId,
          "Статус": intakeStatus(item.status),
          "Шаг": item.currentStep,
          "Получено": localDateTime(item.receivedAt),
          "SLA": localDateTime(item.slaDeadline),
        })),
        totalRows: visibleRows.length,
      }],
      citations: visibleRows.map((item): UniversalCitation => ({
        sourceSystem: "PROCESS",
        entityId: item.id,
        versionOrSnapshot: `intake-v${item.version}`,
        label: `Жизненный цикл ${item.specificationId}`,
        observedAt: item.receivedAt,
      })),
      missingData: rows.length ? [] : [{
        code: "INTAKE_SCOPE_EMPTY",
        message: "В доступном контуре нет подтверждённых записей обработки спецификаций.",
        impact: "Нельзя утверждать отсутствие поступлений или очереди вне разрешённого контура.",
      }],
      confidence: rows.length ? 1 : 0,
      requiresHumanReview: rows.length === 0 || (statusCounts.get("FAILED") ?? 0) > 0 || (statusCounts.get("NEEDS_REVIEW") ?? 0) > 0,
    }, this.clock);
  }

  private async portfolioAttention(
    context: AgentExecutionContext,
    message: string,
  ): Promise<UniversalAgentAnswer> {
    const [projects, queue] = await Promise.all([
      this.execute<readonly BusinessProject[]>("project.list", context, {
        status: ["ACTIVE", "ON_HOLD", "PLANNED"],
        limit: 200,
      }),
      this.execute<readonly SpecificationIntakeItem[]>("process.getQueue", context, { limit: 200 }),
    ]);
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const now = this.clock.now().getTime();
    const humanDecisions = queue.filter((item) => item.status === "NEEDS_REVIEW");
    const slaBreaches = queue.filter((item) => Date.parse(item.slaDeadline) < now);
    const failed = queue.filter((item) => item.status === "FAILED");
    const riskProjectIds = new Set([
      ...projects.filter((project) => project.deadlines.some((deadline) => deadline.status === "AT_RISK")).map((project) => project.id),
      ...failed.map((item) => item.businessProjectId),
      ...slaBreaches.map((item) => item.businessProjectId),
    ]);
    const mode = /решени|ждут\s+человек|требуют\s+человек/iu.test(message)
      ? "HUMAN"
      : /\bsla\b|отста/iu.test(message)
        ? "SLA"
        : "RISK";
    const selected = mode === "HUMAN"
      ? humanDecisions
      : mode === "SLA"
        ? slaBreaches
        : [...riskProjectIds].flatMap((id) => {
            const project = projectById.get(id);
            return project ? [{ businessProjectId: id, project }] : [];
          });
    const rows = mode === "RISK"
      ? selected.map((entry) => ({
          "Проект": "project" in entry ? entry.project.name : entry.businessProjectId,
          "Причина": "Риск срока, SLA или ошибка обработки",
          "Состояние": "Требует внимания",
        }))
      : (selected as readonly SpecificationIntakeItem[]).map((item) => ({
          "Проект": projectById.get(item.businessProjectId)?.name ?? item.businessProjectId,
          "Спецификация": item.specificationId,
          "Состояние": mode === "HUMAN" ? "Ожидает решения человека" : "SLA нарушен",
        }));
    return answer({
      summary: mode === "HUMAN"
        ? `Решений человека ожидают: ${humanDecisions.length}.`
        : mode === "SLA"
          ? `Нарушений SLA в текущей очереди: ${slaBreaches.length}.`
          : `Проектов под подтверждённым операционным риском: ${riskProjectIds.size}.`,
      facts: [
        fact("risk-projects", "Проектов под риском", riskProjectIds.size, undefined, riskProjectIds.size ? "ATTENTION" : "NORMAL"),
        fact("human-decisions", "Ждут решения человека", humanDecisions.length, undefined, humanDecisions.length ? "ATTENTION" : "NORMAL"),
        fact("sla-breaches", "Нарушений SLA", slaBreaches.length, undefined, slaBreaches.length ? "CRITICAL" : "NORMAL"),
        fact("failed-intakes", "Ошибок обработки", failed.length, undefined, failed.length ? "CRITICAL" : "NORMAL"),
      ],
      tables: [{
        id: "portfolio-attention",
        title: mode === "HUMAN" ? "Решения человека" : mode === "SLA" ? "Нарушения SLA" : "Проекты под риском",
        columns: mode === "RISK" ? ["Проект", "Причина", "Состояние"] : ["Проект", "Спецификация", "Состояние"],
        rows,
        totalRows: rows.length,
      }],
      citations: uniqueCitations([
        ...projects.map(projectCitation),
        ...(selected as ReadonlyArray<SpecificationIntakeItem | { businessProjectId: string; project: BusinessProject }>).flatMap((entry) =>
          "id" in entry ? [{
            sourceSystem: "PROCESS" as const,
            entityId: entry.id,
            versionOrSnapshot: `intake-v${entry.version}`,
            label: `Обработка ${entry.specificationId}`,
            observedAt: entry.receivedAt,
          }] : []),
      ]),
      missingData: projects.length || queue.length ? [] : [{
        code: "PORTFOLIO_SCOPE_EMPTY",
        message: "В доступном контуре нет подтверждённых проектов или записей процесса.",
        impact: "Нельзя утверждать отсутствие рисков, SLA-отклонений или решений человека.",
      }],
      confidence: projects.length || queue.length ? 1 : 0,
      requiresHumanReview: projects.length === 0 && queue.length === 0 || mode === "HUMAN" && humanDecisions.length > 0,
    }, this.clock);
  }

  private async projectSpecifications(
    context: AgentExecutionContext,
    project: BusinessProject,
    purpose?: UniversalResolvedContext["purpose"],
  ): Promise<UniversalAgentAnswer> {
    const specifications = await this.execute<readonly UniversalSpecificationRecord[]>(
      "project.listSpecifications",
      context,
      { projectId: project.id, ...(purpose ? { purpose } : {}), limit: 200 },
    );
    return answer({
      summary: `${project.name}: актуальных спецификаций ${specifications.length}.`,
      resolvedContext: {
        businessProject: entityRef("BUSINESS_PROJECT", project, 1),
        ...(purpose ? { purpose } : {}),
      },
      facts: [fact("specification-count", "Актуальных спецификаций", specifications.length)],
      tables: [{
        id: "project-specifications",
        title: "Спецификации проекта",
        columns: ["Спецификация", "Назначение", "Текущая версия"],
        rows: specifications.map((specification) => ({
          "Спецификация": `${specification.name} (${specification.specificationId})`,
          "Назначение": purposeLabel(specification.purpose),
          "Текущая версия": specification.currentVersionId,
        })),
        totalRows: specifications.length,
      }],
      citations: specifications.map((item) => specificationCitation(item, this.clock.now().toISOString())),
      confidence: 1,
    }, this.clock);
  }

  private async specificationVersionChange(
    context: AgentExecutionContext,
    message: string,
  ): Promise<UniversalAgentAnswer | UniversalClarification> {
    const explicitId = extractSpecificationId(message);
    if (!explicitId) {
      return {
        kind: "ASK_CLARIFICATION",
        question: "Уточните спецификацию по номеру или названию.",
        candidates: [],
      };
    }
    const result = await this.execute<Readonly<{
      specification: UniversalSpecificationRecord;
      currentVersion: UniversalSpecificationVersionRecord | null;
      previousVersion: UniversalSpecificationVersionRecord | null;
    }> | null>("specification.getCurrentVersion", context, {
      specificationId: explicitId,
      includePrevious: true,
    });
    if (!result?.currentVersion) {
      return answer({
        summary: `Спецификация ${explicitId} в доступном контуре не найдена.`,
        missingData: [{
          code: "SPECIFICATION_NOT_FOUND",
          message: "Не найдена разрешённая актуальная версия.",
          impact: "Сравнение версий не выполнено.",
        }],
        confidence: 0,
        requiresHumanReview: true,
      }, this.clock);
    }
    const previous = result.previousVersion;
    const positionDelta = previous
      ? result.currentVersion.positionCount - previous.positionCount
      : null;
    return answer({
      summary: previous
        ? `${result.specification.name}: текущая версия v${result.currentVersion.versionNumber}; изменение количества позиций ${signed(positionDelta ?? 0)}.`
        : `${result.specification.name}: текущая версия v${result.currentVersion.versionNumber}; предыдущая версия отсутствует.`,
      resolvedContext: {
        specification: entityRef("SPECIFICATION", {
          id: result.specification.specificationId,
          code: result.specification.specificationId,
          name: result.specification.name,
        }, 1),
      },
      facts: [
        fact("current-version", "Текущая версия", result.currentVersion.versionNumber),
        fact("current-positions", "Позиций в текущей версии", result.currentVersion.positionCount),
        ...(previous ? [
          fact("previous-version", "Предыдущая версия", previous.versionNumber),
          fact("position-delta", "Изменение количества позиций", positionDelta ?? 0),
        ] : []),
      ],
      tables: [{
        id: "specification-version-diff",
        title: "Сравнение последних версий",
        columns: ["Версия", "Статус", "Позиций", "Дата действия"],
        rows: [result.currentVersion, ...(previous ? [previous] : [])].map((version) => ({
          "Версия": `v${version.versionNumber}`,
          "Статус": version.isCurrent ? "Актуальная" : "Архивная",
          "Позиций": version.positionCount,
          "Дата действия": localDate(version.effectiveAt),
        })),
        totalRows: previous ? 2 : 1,
      }],
      citations: [specificationCitation(result.specification, result.currentVersion.effectiveAt)],
      missingData: previous ? [] : [{
        code: "PREVIOUS_VERSION_MISSING",
        message: "Предыдущая версия отсутствует.",
        impact: "Доступно только состояние текущей версии, без построчного сравнения.",
      }],
      confidence: previous ? 0.95 : 0.7,
      requiresHumanReview: !previous,
    }, this.clock);
  }

  private async positionsForReview(context: AgentExecutionContext): Promise<UniversalAgentAnswer> {
    const queue = await this.execute<readonly SpecificationIntakeItem[]>(
      "specification.getProcessingQueue",
      context,
      { limit: 200 },
    );
    const review = queue.filter((item) => item.status === "NEEDS_REVIEW" || item.status === "FAILED");
    return answer({
      summary: `Спецификаций с позициями, требующими проверки: ${review.length}.`,
      facts: [fact("review-specifications", "Требуют проверки", review.length, undefined, review.length ? "ATTENTION" : "NORMAL")],
      tables: [{
        id: "positions-requiring-review",
        title: "Позиции и спецификации на проверке",
        columns: ["Спецификация", "Статус", "Шаг", "Причина"],
        rows: review.map((item) => ({
          "Спецификация": item.specificationId,
          "Статус": intakeStatus(item.status),
          "Шаг": item.currentStep,
          "Причина": item.safeErrorCategory ?? "Требуется решение человека",
        })),
        totalRows: review.length,
      }],
      citations: review.map((item) => ({
        sourceSystem: "PROCESS",
        entityId: item.id,
        versionOrSnapshot: `intake-v${item.version}`,
        label: `Проверка ${item.specificationId}`,
        observedAt: item.receivedAt,
      })),
      confidence: 1,
      requiresHumanReview: review.length > 0,
    }, this.clock);
  }

  private async portfolioExhaustion(
    context: AgentExecutionContext,
    horizonDays: number,
  ): Promise<UniversalAgentAnswer> {
    const projects = await this.execute<readonly BusinessProject[]>("project.list", context, {
      status: ["ACTIVE", "ON_HOLD", "PLANNED"],
      limit: 200,
    });
    const inputs = await Promise.all(projects.map((project) =>
      this.execute<ProjectMaterialCapabilityResult>("analysis.projectSummary", context, { projectId: project.id })));
    const materialByCode = new Map<string, UniversalMaterialRecord>();
    for (const input of inputs) {
      for (const material of input.materials) materialByCode.set(material.materialCode, material);
    }
    const rows = [...materialByCode.values()].flatMap((material) => {
      const weekly = material.weeklyMovements.length
        ? material.weeklyMovements.reduce((total, item) => total + item.consumptionQuantity, 0) /
          material.weeklyMovements.length
        : 0;
      const days = weekly > 0 ? Math.floor(netAvailable(material) / (weekly / 7)) : null;
      return days !== null && days <= horizonDays ? [{ material, weekly, days }] : [];
    }).sort((left, right) => left.days - right.days || left.material.materialCode.localeCompare(right.material.materialCode, "en"));
    return answer({
      summary: `В горизонте ${horizonDays} дн. риск исчерпания подтверждён для ${rows.length} материалов.`,
      facts: [fact("exhaustion-materials", "Материалов с риском исчерпания", rows.length, undefined, rows.length ? "CRITICAL" : "NORMAL")],
      tables: [{
        id: "portfolio-exhaustion",
        title: "Прогноз исчерпания",
        columns: ["Материал", "Доступно", "Средний расход в неделю", "Дней до исчерпания"],
        rows: rows.map(({ material, weekly, days }) => ({
          "Материал": `${material.nameRu} (${material.materialCode})`,
          "Доступно": netAvailable(material),
          "Средний расход в неделю": Math.round(weekly * 100) / 100,
          "Дней до исчерпания": days,
        })),
        totalRows: rows.length,
      }],
      citations: uniqueCitations([
        ...projects.map(projectCitation),
        ...rows.flatMap(({ material }) => [
          materialStockCitation(material),
          {
            sourceSystem: "FORECAST" as const,
            entityId: material.materialCode,
            versionOrSnapshot: "universal-chat-movements-v1",
            label: `История расхода ${material.materialCode}`,
            observedAt: material.asOf,
          },
        ]),
      ]),
      missingData: projects.length ? [] : [{
        code: "FORECAST_SCOPE_EMPTY",
        message: "В доступном контуре нет проектов для расчёта исчерпания.",
        impact: "Нельзя утверждать отсутствие риска по недоступным проектам.",
      }],
      confidence: projects.length ? 0.9 : 0,
      requiresHumanReview: projects.length === 0 || rows.length > 0,
    }, this.clock);
  }

  private async projectMaterials(
    context: AgentExecutionContext,
    project: BusinessProject,
    message: string,
    purpose?: UniversalResolvedContext["purpose"],
    previousShortages: readonly string[] = [],
  ): Promise<UniversalAgentAnswer> {
    const equipmentType = asksPipes(message) ? "PIPE" : undefined;
    const requestedMaterialCode = extractMaterialCodes(message)[0];
    const input = await this.execute<ProjectMaterialCapabilityResult>(
      asksReorder(message) ? "analysis.reorderRecommendations" : "project.getMaterialCoverage",
      context,
      {
        projectId: project.id,
        ...(equipmentType ? { equipmentType } : {}),
        ...(requestedMaterialCode ? { materialCode: requestedMaterialCode } : {}),
        ...(asksFollowupSubstitutes(message) && previousShortages.length === 1
          ? { materialCode: previousShortages[0] }
          : {}),
        limit: 200,
      },
    );
    const specifications = await this.execute<readonly UniversalSpecificationRecord[]>(
      "project.listSpecifications",
      context,
      { projectId: project.id, ...(purpose ? { purpose } : {}), limit: 200 },
    );
    const allowedSpecificationIds = new Set(specifications.map((item) => item.specificationId));
    const positions = purpose
      ? input.positions.filter((position) => allowedSpecificationIds.has(position.specificationId))
      : input.positions;
    const materialByCode = new Map(input.materials.map((material) => [material.materialCode, material]));
    const requirements = aggregatePositions(positions);
    const balances = [...requirements].flatMap(([materialCode, requiredQuantity]) => {
      const material = materialByCode.get(materialCode);
      if (!material) return [];
      const otherAllocations = input.allocations
        .filter((allocation) => allocation.materialCode === materialCode && allocation.businessProjectId !== project.id)
        .reduce((total, allocation) => total + allocation.quantity, 0);
      const inboundBeforeNeed = material.inboundSupplies
        .filter((supply) => Date.parse(supply.promisedAt) <= Date.parse(project.needDate))
        .reduce((total, supply) => total + supply.confirmedQuantity, 0);
      const inboundAfterNeed = material.inboundSupplies
        .filter((supply) => Date.parse(supply.promisedAt) > Date.parse(project.needDate))
        .reduce((total, supply) => total + supply.confirmedQuantity, 0);
      const weeksToNeed = Math.max(0, Math.ceil((Date.parse(project.needDate) - this.clock.now().getTime()) / 604_800_000));
      const averageWeekly = Math.ceil(material.weeklyMovements.reduce(
        (total, movement) => total + movement.consumptionQuantity,
        0,
      ) / material.weeklyMovements.length);
      const calculated = calculateProjectMaterialBalance({
        onHandQuantity: material.stock.onHandQuantity,
        reservedQuantity: material.stock.reservedQuantity,
        quarantinedQuantity: material.stock.quarantinedQuantity,
        committedToOtherNeeds: material.stock.committedToOtherNeeds + otherAllocations,
        confirmedInboundArrivingByNeedDate: inboundBeforeNeed,
        remainingProjectRequirement: requiredQuantity,
        forecastDemandUntilNeedDate: averageWeekly * weeksToNeed,
        safetyStock: material.safetyStock,
        openPurchaseQuantityAfterNeedDateAdjustment: inboundAfterNeed,
        packSize: material.packSize,
      });
      const daysToExhaustion = averageWeekly <= 0
        ? null
        : Math.floor(calculated.netAvailableNow / (averageWeekly / 7));
      return [{
        material,
        requiredQuantity,
        averageWeekly,
        daysToExhaustion,
        quantityCoveragePercent: calculateQuantityCoveragePercent(
          calculated.netAvailableAtNeedDate,
          calculated.requiredAtNeedDate,
        ),
        dataConfidencePercent: 96,
        ...calculated,
      }];
    });
    const shortages = balances.filter((row) => row.shortageAtNeedDate > 0);
    const compatibility = await this.substitutesForShortages(context, shortages.slice(0, 5));
    const coveredBySubstitutes = new Map<string, number>();
    for (const candidate of compatibility) {
      if (candidate.technicalCompatibilityPercent !== null && candidate.technicalCompatibilityPercent >= 85) {
        coveredBySubstitutes.set(
          candidate.sourceMaterialCode,
          (coveredBySubstitutes.get(candidate.sourceMaterialCode) ?? 0) +
            candidate.quantityCoveragePercent,
        );
      }
    }
    const risks: UniversalRiskCard[] = balances.flatMap((row) => {
      const values: UniversalRiskCard[] = [];
      if (row.shortageAtNeedDate > 0) values.push({
        id: `shortage-${row.material.materialCode}`,
        level: "CRITICAL",
        title: `Дефицит ${row.material.materialCode}`,
        explanation: `К сроку не хватает ${row.shortageAtNeedDate} ${row.material.unit}.`,
        materialCode: row.material.materialCode,
      });
      else if (row.netAvailableNow < row.material.safetyStock) values.push({
        id: `safety-${row.material.materialCode}`,
        level: "HIGH",
        title: `Ниже страхового запаса: ${row.material.materialCode}`,
        explanation: `Доступно ${row.netAvailableNow}, страховой запас ${row.material.safetyStock} ${row.material.unit}.`,
        materialCode: row.material.materialCode,
      });
      else if (row.daysToExhaustion !== null && row.daysToExhaustion <= 30) values.push({
        id: `exhaustion-${row.material.materialCode}`,
        level: "MEDIUM",
        title: `Риск исчерпания: ${row.material.materialCode}`,
        explanation: `Расчётный горизонт: ${row.daysToExhaustion} дн.`,
        materialCode: row.material.materialCode,
      });
      return values;
    });
    const recommendations: UniversalRecommendationCard[] = shortages.map((row) => ({
      id: `reorder-${row.material.materialCode}`,
      kind: row.reorderQuantity > 0 ? "REORDER" : "MONITOR",
      title: row.reorderQuantity > 0
        ? `Дозаказать ${row.material.materialCode}`
        : `Контролировать ${row.material.materialCode}`,
      explanation: `Расчёт ${PROJECT_MATERIAL_BALANCE_FORMULA_VERSION}; учтены резервы, карантин, другие аллокации, inbound и страховой запас.`,
      materialCode: row.material.materialCode,
      quantity: row.reorderQuantity,
      unit: row.material.unit,
      residualRisk: (coveredBySubstitutes.get(row.material.materialCode) ?? 0) > 0
        ? "Часть потребности можно закрыть допустимой заменой после экспертного визирования."
        : "Подтверждённой замены с достаточным количеством пока нет.",
    }));
    const citations = uniqueCitations([
      ...specifications.map((item) => specificationCitation(item, this.clock.now().toISOString())),
      ...balances.flatMap((row): UniversalCitation[] => [
        materialStockCitation(row.material),
        {
          sourceSystem: "FORECAST",
          entityId: row.material.materialCode,
          versionOrSnapshot: "universal-chat-movements-v1",
          label: `52 недели движения ${row.material.materialCode}`,
          observedAt: row.material.asOf,
        },
      ]),
      {
        sourceSystem: "CATALOG",
        entityId: project.id,
        versionOrSnapshot: "universal-chat-v1@1.0.0-DEMO",
        label: `Проектные связи ${project.name}`,
        observedAt: this.clock.now().toISOString(),
      },
    ]);
    const totalRequired = sum(balances.map((row) => row.requiredAtNeedDate));
    const totalNow = sum(balances.map((row) => row.netAvailableNow));
    const totalAtNeed = sum(balances.map((row) => row.netAvailableAtNeedDate));
    return answer({
      summary: `${project.name} · ${equipmentType === "PIPE" ? "трубы" : "материалы"} · актуальный срез ${localDateTime(this.clock.now().toISOString())}. Дефицитных позиций: ${shortages.length}.`,
      resolvedContext: {
        businessProject: entityRef("BUSINESS_PROJECT", project, 1),
        ...(purpose ? { purpose } : {}),
      },
      facts: [
        fact("active-specifications", "Активных спецификаций", specifications.length),
        fact("positions", equipmentType === "PIPE" ? "Трубных позиций" : "Позиций", positions.length),
        fact("required", "Потребность к сроку", totalRequired, mixedUnit(balances)),
        fact("available-now", "Доступно сейчас", totalNow, mixedUnit(balances)),
        fact("available-at-need", "Ожидается к сроку", totalAtNeed, mixedUnit(balances)),
        fact("shortages", "Дефицитных материалов", shortages.length, undefined, shortages.length ? "CRITICAL" : "NORMAL"),
        fact("exhaustion-risk", "Риск исчерпания", risks.filter((risk) => risk.id.startsWith("exhaustion-")).length, undefined, "ATTENTION"),
        fact("association-confidence", "Уверенность отнесения к проекту", positions.length ? Math.min(...positions.map((position) => position.projectAssociationConfidencePercent)) : 0, "%"),
        fact("data-confidence", "Достоверность данных", balances.length ? Math.min(...balances.map((row) => row.dataConfidencePercent)) : 0, "%"),
      ],
      tables: [{
        id: "project-material-balance",
        title: "Требуют внимания",
        columns: ["Материал", "Потребность", "Доступно", "К сроку", "Дефицит", "Покрытие", "Дозаказ", "Риск"],
        rows: balances.map((row) => ({
          "Материал": `${row.material.nameRu} (${row.material.materialCode})`,
          "Потребность": row.requiredAtNeedDate,
          "Доступно": row.netAvailableNow,
          "К сроку": row.netAvailableAtNeedDate,
          "Дефицит": row.shortageAtNeedDate,
          "Покрытие": `${row.quantityCoveragePercent}%`,
          "Дозаказ": row.reorderQuantity,
          "Риск": row.shortageAtNeedDate > 0 ? "Дефицит" : row.daysToExhaustion !== null && row.daysToExhaustion <= 30 ? "Исчерпание" : "Контроль",
        })),
        totalRows: balances.length,
      }],
      risks,
      compatibility,
      recommendations,
      actions: shortages.length ? [{
        id: `purchase-draft-${project.id}`,
        kind: "PURCHASE_REQUEST_DRAFT",
        title: "Подготовить черновик заявки на дозаказ",
        enabled: context.trusted.permissionKeys.has("analysis.create"),
        requiresConfirmation: true,
      }] : [],
      citations,
      confidence: citations.length > 0 ? 0.96 : 0,
      requiresHumanReview: shortages.length > 0 || compatibility.some((item) => item.requiresHumanReview),
    }, this.clock);
  }

  private async substitutesForShortages(
    context: AgentExecutionContext,
    shortages: readonly ProjectBalanceRow[],
  ): Promise<UniversalCompatibilityResult[]> {
    if (
      !context.trusted.permissionKeys.has("catalog.substitutes.read") ||
      !context.trusted.permissionKeys.has("catalog.read")
    ) return [];
    const results: UniversalCompatibilityResult[] = [];
    for (const shortage of shortages) {
      const candidates = await this.execute<readonly UniversalMaterialRecord[]>(
        "catalog.getSubstitutes",
        context,
        { materialCode: shortage.material.materialCode, limit: 4 },
      );
      for (const candidate of candidates
        .filter((item) => item.materialCode !== shortage.material.materialCode)
        .slice(0, 3)) {
        const evaluated = await this.execute<UniversalCompatibilityResult | null>(
          "compatibility.evaluate",
          context,
          {
            sourceMaterialCode: shortage.material.materialCode,
            candidateMaterialCode: candidate.materialCode,
            requiredQuantity: shortage.shortageAtNeedDate,
          },
        );
        if (evaluated) results.push(evaluated);
      }
    }
    return results;
  }

  private async materialQuestion(
    context: AgentExecutionContext,
    message: string,
    normalized: string,
    extractedCodes: readonly string[],
  ): Promise<UniversalAgentAnswer | UniversalClarification> {
    const rawQuery = extractedCodes[0] ?? materialQuery(message);
    const matches = await this.execute<readonly UniversalMaterialRecord[]>("material.search", context, {
      query: rawQuery,
      limit: 20,
    });
    const resolution = resolveEntity(rawQuery, matches.map(materialEntity));
    if (resolution.kind === "NOT_FOUND") {
      return answer({
        summary: `Материал «${rawQuery}» не найден. Проверено записей в доступной выборке: ${resolution.checkedCount}.`,
        missingData: [{
          code: "MATERIAL_NOT_FOUND",
          message: "Не удалось однозначно определить материал по коду, названию или alias.",
          impact: "Расчёт остатка и рекомендации не выполнены.",
        }],
        confidence: 0,
        requiresHumanReview: true,
      }, this.clock);
    }
    if (resolution.kind === "AMBIGUOUS") {
      return clarification("Уточните материал из найденных вариантов.", resolution, "MATERIAL");
    }
    const source = matches.find((item) => item.materialCode === resolution.entity.code);
    if (!source) throw new Error("UNIVERSAL_MATERIAL_RESOLUTION_MISMATCH");
    const requestedWarehouse = warehouseRequest(message);
    if (requestedWarehouse.mentioned) {
      const balances = source.stock.balances.slice(0, 5);
      const selectedBalance = requestedWarehouse.explicitId
        ? balances.find((balance) => balance.warehouseId === requestedWarehouse.explicitId)
        : balances.length === 1
          ? balances[0]
          : undefined;
      if (!selectedBalance) {
        return {
          kind: "ASK_CLARIFICATION",
          question: `Уточните склад для материала «${source.nameRu}».`,
          candidates: balances.map((balance) => warehouseEntityRef(balance.warehouseId, balance.plant)),
        };
      }
      const available = Math.max(
        0,
        selectedBalance.onHandQuantity - selectedBalance.reservedQuantity - selectedBalance.quarantinedQuantity,
      );
      return answer({
        summary: available > 0
          ? `Да. На складе ${selectedBalance.warehouseId} доступно ${available} ${selectedBalance.unit} материала «${source.nameRu}».`
          : `Нет. На складе ${selectedBalance.warehouseId} доступного количества материала «${source.nameRu}» нет.`,
        resolvedContext: { material: materialEntityRef(source, resolution.confidence) },
        facts: [
          fact("warehouse-on-hand", "Фактический остаток", selectedBalance.onHandQuantity, selectedBalance.unit),
          fact("warehouse-reserved", "В резерве", selectedBalance.reservedQuantity, selectedBalance.unit),
          fact("warehouse-quarantine", "В карантине", selectedBalance.quarantinedQuantity, selectedBalance.unit),
          fact("warehouse-available", "Доступно", available, selectedBalance.unit, available > 0 ? "NORMAL" : "ATTENTION"),
        ],
        tables: [{
          id: "warehouse-inventory",
          title: "Остаток на выбранном складе",
          columns: ["Склад", "Площадка", "Остаток", "Резерв", "Карантин", "Доступно"],
          rows: [{
            "Склад": selectedBalance.warehouseId,
            "Площадка": selectedBalance.plant,
            "Остаток": selectedBalance.onHandQuantity,
            "Резерв": selectedBalance.reservedQuantity,
            "Карантин": selectedBalance.quarantinedQuantity,
            "Доступно": available,
          }],
          totalRows: 1,
        }],
        citations: [materialStockCitation(source)],
        confidence: 1,
        requiresHumanReview: false,
      }, this.clock);
    }
    const whereUsed = await this.execute<readonly UniversalPositionRecord[]>(
      "material.getWhereUsed",
      context,
      { materialCode: source.materialCode, limit: 200 },
    );
    const projects = whereUsed.length
      ? await this.execute<readonly BusinessProject[]>("project.list", context, { limit: 200 })
      : [];
    const projectNameById = new Map(projects.map((project) => [project.id, project.name]));
    const citations: UniversalCitation[] = [materialStockCitation(source), {
      sourceSystem: "CATALOG",
      entityId: source.catalogItemCode,
      versionOrSnapshot: source.datasetVersion,
      label: `${source.nameRu} · каталог`,
      observedAt: source.asOf,
    }];
    const facts = [
      fact("material-code", "Код материала", source.materialCode),
      fact("catalog-code", "Код каталога", source.catalogItemCode),
      fact("stock", "На складе", source.stock.onHandQuantity, source.unit),
      fact("reserved", "В резерве", source.stock.reservedQuantity, source.unit),
      fact("quarantine", "В карантине", source.stock.quarantinedQuantity, source.unit),
      fact("where-used", "Проектных позиций", whereUsed.length),
    ];
    let compatibility: UniversalCompatibilityResult[] = [];
    const recommendations: UniversalRecommendationCard[] = [];
    if (asksSubstitutes(normalized) || asksReliability(normalized)) {
      const explicitCandidateMatches = extractedCodes[1]
        ? await this.execute<readonly UniversalMaterialRecord[]>("material.search", context, {
            query: extractedCodes[1],
            limit: 20,
          })
        : [];
      const explicitCandidateResolution = extractedCodes[1]
        ? resolveEntity(extractedCodes[1], explicitCandidateMatches.map(materialEntity))
        : null;
      const explicitCandidate = explicitCandidateResolution?.kind === "RESOLVED"
        ? explicitCandidateMatches.find((item) => item.materialCode === explicitCandidateResolution.entity.code) ?? null
        : null;
      const candidates = explicitCandidate
        ? [explicitCandidate]
        : await this.execute<readonly UniversalMaterialRecord[]>(
            "catalog.getSubstitutes",
            context,
            { materialCode: source.materialCode, limit: 4 },
          );
      for (const candidate of candidates.filter((item) => item.materialCode !== source.materialCode).slice(0, 3)) {
        citations.push(materialStockCitation(candidate), {
          sourceSystem: "CATALOG",
          entityId: candidate.catalogItemCode,
          versionOrSnapshot: candidate.datasetVersion,
          label: `${candidate.nameRu} · каталог`,
          observedAt: candidate.asOf,
        });
        const evaluated = await this.execute<UniversalCompatibilityResult | null>(
          "compatibility.evaluate",
          context,
          { sourceMaterialCode: source.materialCode, candidateMaterialCode: candidate.materialCode, requiredQuantity: Math.max(1, netAvailable(source)) },
        );
        if (evaluated) compatibility.push(evaluated);
      }
      if (asksReliability(normalized)) {
        const best = compatibility.find((item) => (item.technicalCompatibilityPercent ?? 0) >= 95);
        if (best) {
          const compared = await this.execute<ReliabilityResult>("reliability.compare", context, {
            sourceMaterialCode: best.sourceMaterialCode,
            candidateMaterialCode: best.candidateMaterialCode,
            operatingHours: source.reliability.operatingHours,
          });
          recommendations.push({
            id: `reliability-${best.candidateMaterialCode}`,
            kind: compared.verdict === "IMPROVES" ? "REPLACEMENT" : "EXPERT_REVIEW",
            title: compared.verdict === "IMPROVES"
              ? `Рассмотреть ${best.candidateMaterialCode} для снижения риска отказа`
              : "Не утверждать рост надёжности без дополнительной проверки",
            explanation: `Относительное изменение риска: ${compared.relativeRiskReductionPercent}%. ${compared.assumptions.join("; ")}.`,
            materialCode: best.candidateMaterialCode,
            residualRisk: compared.residualRisk,
          });
        } else {
          recommendations.push({
            id: `reliability-insufficient-${source.materialCode}`,
            kind: "EXPERT_REVIEW",
            title: "Недостаточно данных для рекомендации по надёжности",
            explanation: "Нет кандидата с технической совместимостью не ниже 95%.",
            materialCode: source.materialCode,
            residualRisk: "Совместимость и надёжность оцениваются независимо.",
          });
        }
      }
    }
    let bomRows: readonly Record<string, string | number | null>[] = [];
    if (source.itemKind === "ASSEMBLY" || asksBom(normalized)) {
      const bom = await this.execute<ReadonlyArray<{
        componentMaterialCode: string;
        positionNumber: string;
        quantity: number;
        unit: string;
        isCritical: boolean;
      }>>("catalog.getBom", context, { materialCode: source.materialCode });
      bomRows = bom.map((item) => ({
        "Позиция": item.positionNumber,
        "Компонент": item.componentMaterialCode,
        "Количество": item.quantity,
        "Единица": item.unit,
        "Критичность": item.isCritical ? "Критичный" : "Обычный",
      }));
    }
    compatibility = compatibility.sort((left, right) =>
      (right.technicalCompatibilityPercent ?? -1) - (left.technicalCompatibilityPercent ?? -1),
    );
    return answer({
      summary: `${source.nameRu} (${source.materialCode}): доступно без резерва и карантина ${netAvailable(source)} ${source.unit}; используется в ${whereUsed.length} проектных позициях.`,
      resolvedContext: { material: materialEntityRef(source, resolution.confidence) },
      facts,
      tables: [
        ...(whereUsed.length ? [{
          id: "material-where-used",
          title: "Где используется",
          columns: ["Проект", "Спецификация", "Позиция", "Потребность"],
          rows: whereUsed.map((position) => ({
            "Проект": projectNameById.get(position.businessProjectId) ?? "Доступный проект",
            "Спецификация": position.specificationId,
            "Позиция": position.positionId,
            "Потребность": `${position.requiredQuantity} ${position.unit}`,
          })),
          totalRows: whereUsed.length,
        }] : []),
        ...(bomRows.length ? [{
          id: "assembly-bom",
          title: "Состав сборочного узла",
          columns: ["Позиция", "Компонент", "Количество", "Единица", "Критичность"],
          rows: bomRows,
          totalRows: bomRows.length,
        }] : []),
      ],
      compatibility,
      recommendations,
      citations,
      confidence: 0.96,
      requiresHumanReview: compatibility.some((item) => item.requiresHumanReview) || recommendations.some((item) => item.kind === "EXPERT_REVIEW"),
    }, this.clock);
  }

  private execute<T>(
    key: UniversalReadCapabilityKey,
    context: AgentExecutionContext,
    input: unknown,
  ): Promise<T> {
    return this.capabilities.execute(key, context, input) as Promise<T>;
  }
}

interface ProjectMaterialCapabilityResult {
  readonly project: BusinessProject | null;
  readonly positions: readonly UniversalPositionRecord[];
  readonly materials: readonly UniversalMaterialRecord[];
  readonly allocations: readonly Readonly<{
    businessProjectId: string;
    materialCode: string;
    snapshotId: string;
    quantity: number;
    unit: string;
  }>[];
}

type ProjectBalanceRow = Readonly<{
  material: UniversalMaterialRecord;
  requiredQuantity: number;
  averageWeekly: number;
  daysToExhaustion: number | null;
  netAvailableNow: number;
  netAvailableAtNeedDate: number;
  requiredAtNeedDate: number;
  shortageAtNeedDate: number;
  reorderQuantity: number;
  quantityCoveragePercent: number;
  dataConfidencePercent: number;
}>;

interface ReliabilityResult {
  readonly relativeRiskReductionPercent: number;
  readonly verdict: "IMPROVES" | "NO_IMPROVEMENT" | "INSUFFICIENT_DATA";
  readonly assumptions: readonly string[];
  readonly residualRisk: string;
}

function answer(
  partial: Partial<UniversalAgentAnswer> & Pick<UniversalAgentAnswer, "summary">,
  clock: ScenarioClock,
): UniversalAgentAnswer {
  return {
    summary: partial.summary,
    resolvedContext: partial.resolvedContext ?? {},
    facts: partial.facts ?? [],
    tables: partial.tables ?? [],
    risks: partial.risks ?? [],
    compatibility: partial.compatibility ?? [],
    recommendations: partial.recommendations ?? [],
    actions: partial.actions ?? [],
    citations: partial.citations ?? [],
    missingData: partial.missingData ?? [],
    confidence: partial.confidence ?? 0,
    requiresHumanReview: partial.requiresHumanReview ?? false,
    generatedAt: clock.now().toISOString(),
    mode: "DETERMINISTIC_FALLBACK",
  };
}

function fact(
  key: string,
  label: string,
  value: string | number,
  unit?: string,
  status: "NORMAL" | "ATTENTION" | "CRITICAL" | "UNKNOWN" = "NORMAL",
) {
  return { key, label, value, ...(unit ? { unit } : {}), status } as const;
}

function resolveProject(
  message: string,
  projects: readonly BusinessProject[],
  previousProjectId?: string,
): EntityResolution<BusinessProject> {
  const direct = resolveEntity(message, projects);
  if (direct.kind !== "NOT_FOUND") return direct;
  const previous = projects.find((project) => project.id === previousProjectId);
  return previous
    ? { kind: "RESOLVED", entity: previous, confidence: 1, matchedBy: "thread-context" }
    : direct;
}

function clarification<T extends { id: string; code: string; name: string; aliases: readonly string[] }>(
  question: string,
  resolution: Extract<EntityResolution<T>, { kind: "AMBIGUOUS" }>,
  kind: UniversalEntityRef["kind"] = "BUSINESS_PROJECT",
): UniversalClarification {
  return {
    kind: "ASK_CLARIFICATION",
    question,
    candidates: resolution.candidates.map(({ entity, confidence }) =>
      entityRef(kind, entity, confidence)),
  };
}

function entityRef(
  kind: UniversalEntityRef["kind"],
  entity: { id: string; code: string; name: string },
  confidence: number,
): UniversalEntityRef {
  return { kind, id: entity.id, code: entity.code, name: entity.name, confidence };
}

function materialEntity(material: UniversalMaterialRecord) {
  return {
    id: material.id,
    code: material.materialCode,
    name: material.nameRu,
    aliases: [material.catalogItemCode, material.legacyCode, material.manufacturerPartNumber, material.nameEn, ...material.aliases],
  };
}

function materialEntityRef(material: UniversalMaterialRecord, confidence: number): UniversalEntityRef {
  return entityRef("MATERIAL", materialEntity(material), confidence);
}

function warehouseEntityRef(warehouseId: string, plant: string): UniversalEntityRef {
  return entityRef("WAREHOUSE", {
    id: warehouseId,
    code: warehouseId,
    name: `${warehouseId} · ${plant}`,
  }, 1);
}

function projectCitation(project: BusinessProject): UniversalCitation {
  return {
    sourceSystem: "APPIUS",
    entityId: project.id,
    versionOrSnapshot: "universal-chat-v1@1.0.0-DEMO",
    label: `${project.name} · проектный контур`,
    observedAt: project.needDate,
  };
}

function specificationCitation(specification: UniversalSpecificationRecord, observedAt: string): UniversalCitation {
  return {
    sourceSystem: "APPIUS",
    entityId: specification.specificationId,
    versionOrSnapshot: specification.currentVersionId,
    label: specification.name,
    observedAt,
  };
}

function materialStockCitation(material: UniversalMaterialRecord): UniversalCitation {
  return {
    sourceSystem: "SAP",
    entityId: material.materialCode,
    versionOrSnapshot: material.stock.snapshotId,
    label: `${material.nameRu} · остаток, резерв, карантин и inbound`,
    observedAt: material.stock.snapshotAt,
  };
}

function uniqueCitations(citations: readonly UniversalCitation[]): UniversalCitation[] {
  return [...new Map(citations.map((citation) => [
    `${citation.sourceSystem}:${citation.entityId}:${citation.versionOrSnapshot}`,
    citation,
  ])).values()];
}

function aggregatePositions(positions: readonly UniversalPositionRecord[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const position of positions) {
    result.set(position.materialCode, (result.get(position.materialCode) ?? 0) + position.requiredQuantity);
  }
  return result;
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const result = new Map<string, number>();
  for (const item of items) result.set(key(item), (result.get(key(item)) ?? 0) + 1);
  return result;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function netAvailable(material: UniversalMaterialRecord): number {
  return Math.max(0, material.stock.onHandQuantity - material.stock.reservedQuantity - material.stock.quarantinedQuantity - material.stock.committedToOtherNeeds);
}

function mixedUnit(rows: readonly ProjectBalanceRow[]): string {
  const units = [...new Set(rows.map((row) => row.material.unit))];
  return units.length === 1 ? units[0] : "по группам единиц";
}

function extractMaterialCodes(message: string): string[] {
  return [...new Set([...message.matchAll(/\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/giu)]
    .map((match) => match[0].toLocaleUpperCase("en-US"))
    .filter((code) => !/^(?:WH|SPEC|RUN|PROJECT|BUSINESS)-/u.test(code) && code.length >= 8))];
}

function extractSpecificationId(message: string): string | null {
  return message.match(/\bspec-[a-z0-9-]+\b/iu)?.[0]?.toLocaleLowerCase("en-US") ?? null;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function materialQuery(message: string): string {
  return message
    .replace(/^(?:есть|имеется)\s+ли\s+(?:на|в)\s+.{0,40}?склад\p{L}*\s+/iu, "")
    .replace(/^(?:есть|имеется)\s+ли\s+(?:на|в)\s+WH-[A-Z0-9-]+\s+/iu, "")
    .replace(/^(?:есть|имеется)\s+ли\s+/iu, "")
    .replace(/^(?:что\s+это\s+за|найди|покажи|какой|какая|какие|где\s+используется)\s+/iu, "")
    .replace(/\s+(?:на|в)\s+.{0,40}?склад\p{L}*[?.!]*$/iu, "")
    .replace(/\s+(?:на|в)\s+WH-[A-Z0-9-]+[?.!]*$/iu, "")
    .replace(/[?.!]+$/gu, "")
    .trim();
}

function warehouseRequest(message: string): { mentioned: boolean; explicitId: string | null } {
  const explicitId = message.match(/\bWH-[A-Z0-9-]+\b/iu)?.[0]?.toLocaleUpperCase("en-US") ?? null;
  return { mentioned: explicitId !== null || /склад/iu.test(message), explicitId };
}

function requestedPurpose(message: string): UniversalResolvedContext["purpose"] | undefined {
  if (/обслуживан|техобслуж/iu.test(message)) return "MAINTENANCE";
  if (/ремонт/iu.test(message)) return "REPAIR";
  if (/строитель|монтаж/iu.test(message)) return "CONSTRUCTION";
  if (/запасн|зип/iu.test(message)) return "SPARES";
  return undefined;
}

function requestedDays(message: string): number | null {
  const match = message.match(/(\d{1,3})\s*(?:дн(?:я|ей)?|день)/iu)?.[1];
  if (!match) return null;
  const value = Number(match);
  return Number.isInteger(value) && value > 0 && value <= 365 ? value : null;
}

function asksActiveProjects(message: string): boolean {
  if (/по\s+проекту|контекст\s+проекта/iu.test(message)) return false;
  if (!/проект/iu.test(message) && !/что\s+у\s+нас\s+сейчас\s+в\s+работ/iu.test(message)) return false;
  return /(?:активн|текущ|рабоч|в\s+работ|работаем|идут\s+сейчас)/iu.test(message);
}

function asksPlannedProjects(message: string): boolean {
  return /(?:покажи|какие|список).{0,25}(?:запланирован|планируем).{0,15}проект/iu.test(message);
}

function asksAllProjects(message: string): boolean {
  return /(?:покажи|какие|список).{0,20}(?:все|полный\s+список).{0,10}проект/iu.test(message) ||
    /(?:все|полный\s+список).{0,20}проект/iu.test(message);
}

function asksProjectStatusSequence(message: string): boolean {
  return /активн/iu.test(message) && /запланирован/iu.test(message) && /все\s+доступн/iu.test(message);
}

function asksInventoryExistence(message: string): boolean {
  return /(?:есть|имеется)\s+ли/iu.test(message) && /(?:склад|\bWH-[A-Z0-9-]+\b)/iu.test(message);
}

function asksWarehouseFollowup(message: string): boolean {
  return /склад/iu.test(message) && /(?:этот|эта|это|данн|указан|проверь)/iu.test(message);
}

function asksUpcomingDeadlines(message: string): boolean {
  const horizon = /(?:ближайш|следующ|три\s+дн|3\s+дн|тр[её]хдневн)/iu;
  return horizon.test(message) && (
    /(?:дедлайн|срок)/iu.test(message) ||
    /(?:успеть|контрольн|событи)/iu.test(message)
  );
}

function asksPortfolioAttention(message: string): boolean {
  return /(?:какие\s+проекты\s+под\s+риск|проекты.{0,20}отста.{0,10}\bsla\b|решени.{0,20}ждут.{0,15}человек|что.{0,20}ждет.{0,15}человек)/iu.test(message);
}

function asksSpecificationIntake(message: string): boolean {
  return /спецификац/iu.test(message) && /(?:упал|приш|поступ|загруз|обработ|очеред|ошиб|остал|сводк|нов)/iu.test(message) ||
    /что\s+сейчас\s+в\s+очеред/iu.test(message);
}

function asksSpecificationVersionChange(message: string): boolean {
  return /(?:что\s+изменил|изменени|разниц|сравн).{0,35}(?:последн|текущ|нов).{0,20}верси/iu.test(message);
}

function asksPositionsForReview(message: string): boolean {
  return /(?:какие|покажи).{0,20}позици.{0,25}(?:требуют|нужн).{0,15}провер/iu.test(message);
}

function asksPortfolioExhaustion(message: string): boolean {
  return /что.{0,25}(?:законч|исчерпа).{0,30}(?:дн|месяц|ближайш)/iu.test(message);
}

function asksQueue(message: string): boolean {
  return /очеред|остал.{0,10}обработ/iu.test(message);
}

function asksFailedIntake(message: string): boolean {
  return /(?:ошиб|сбой)/iu.test(message);
}

function asksProjectQuestion(message: string): boolean {
  return /проект|труб|материал|остат|дефицит|дозаказ|спецификац|состояни|что\s+сейчас\s+происход/iu.test(message);
}

function asksSpecifications(message: string): boolean {
  return /спецификац/iu.test(message) && !/остат|дефицит|дозаказ|материал|труб/iu.test(message);
}

function asksPipes(message: string): boolean {
  return /труб/iu.test(message);
}

function asksReorder(message: string): boolean {
  return /дозаказ|дозаказать|следует\s+заказ|закупить/iu.test(message);
}

function asksFollowupSubstitutes(message: string): boolean {
  return /какие.{0,20}(?:дефицит|из\s+них).{0,30}(?:замен|аналог)|чем.{0,15}замен/iu.test(message);
}

function asksMaterialQuestion(message: string): boolean {
  return /что\s+это\s+за\s+(?:детал|материал)|где\s+(?:еще\s+)?использ|совместим|замен|аналог|надежн|надёжн|сборочн|\bbom\b/iu.test(message);
}

function asksSubstitutes(message: string): boolean {
  return /замен|аналог|совместим/iu.test(message);
}

function asksReliability(message: string): boolean {
  return /надежн|надёжн|риск\s+отказ|ремонтопригод/iu.test(message);
}

function asksBom(message: string): boolean {
  return /сборочн|состав\s+узл|\bbom\b/iu.test(message);
}

function localDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "medium" }).format(new Date(value));
}

function localDateTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function projectStatus(value: BusinessProject["status"]): string {
  return { PLANNED: "Запланирован", ACTIVE: "Активен", ON_HOLD: "Приостановлен", COMPLETED: "Завершён" }[value];
}

function projectPhase(value: BusinessProject["phase"]): string {
  return { DESIGN: "Проектирование", PROCUREMENT: "Закупка", CONSTRUCTION: "Строительство", COMMISSIONING: "Пусконаладка", OPERATIONS: "Эксплуатация" }[value];
}

function deadlineKind(value: BusinessProject["deadlines"][number]["kind"]): string {
  return { DESIGN_FREEZE: "Фиксация проекта", MATERIAL_NEED: "Потребность в материалах", START_UP: "Пуск" }[value];
}

function deadlineStatus(value: BusinessProject["deadlines"][number]["status"]): string {
  return { UPCOMING: "Предстоит", AT_RISK: "Под риском", MET: "Выполнено" }[value];
}

function intakeStatus(value: SpecificationIntakeItem["status"]): string {
  return {
    RECEIVED: "Получено",
    VALIDATING: "Проверяется",
    QUEUED: "В очереди",
    PROCESSING: "Обрабатывается",
    NEEDS_REVIEW: "Требует проверки",
    COMPLETED: "Завершено",
    FAILED: "Ошибка",
    CANCELLED: "Отменено",
  }[value];
}

function purposeLabel(value: UniversalSpecificationRecord["purpose"]): string {
  return { CONSTRUCTION: "Строительство", MAINTENANCE: "Обслуживание", REPAIR: "Ремонт", SPARES: "Запасные части" }[value];
}
