import type {
  AnalogueCoverage,
  AnalogueRule,
  GroundedAgentOutput,
  GroundedCitation,
  IntegrationState,
  Position,
  PositionAnalysisResult,
  ReportSummary,
  ResponsibilityRule,
  SapMaterial,
  ScenarioRun,
  Specification,
  SpecificationVersion,
} from "@/domain/models";
import {
  analysisStatusLabel,
  integrationStatusLabel,
  localizeKnownEnum,
  matchCategoryLabel,
  runStatusLabel,
} from "@/lib/localization";
import type {
  CatalogAssemblyBom,
  CatalogItemWithStock,
  CatalogSearchResult,
  CatalogSubstituteResult,
  GroundedAgentInput,
  LLMProvider,
  StockSearchResult,
} from "@/ports";

/**
 * Facts passed by AgentService are wrapped so a provider can distinguish trusted
 * tool output from user text. A production provider may serialize this envelope
 * into its own tool/result format without changing the application service.
 */
export interface GroundedFactEnvelope<T = unknown> {
  data: T;
  citations?: GroundedCitation[];
  note?: string;
}

type Fact = GroundedAgentInput["facts"][number];

interface ResponsibilityFact {
  position: Position;
  rules: ResponsibilityRule[];
}

interface AnalogueFact {
  position: Position;
  rules: AnalogueRule[];
  coverage?: AnalogueCoverage;
}

interface SafeToolError {
  sourceSystem: string;
  safeMessage: string;
  manualImport: boolean;
}

/**
 * Deterministic, offline provider used by the demo contour. It never invents a
 * business fact: all factual phrases below are derived from trusted envelopes.
 */
export class MockLLMProvider implements LLMProvider {
  async respond(input: GroundedAgentInput): Promise<GroundedAgentOutput> {
    const sections: string[] = [];
    const facts: string[] = [];
    const recommendations: string[] = [];
    const requestedQuantity = extractRequestedQuantity(input.message);
    let confidence = 0.9;
    let requiresHumanReview = false;

    const errors = factsBySource<SafeToolError>(input.facts, "ERROR.tool");
    for (const error of errors) {
      const system = humanSystemName(error.sourceSystem);
      const manualAction =
        error.sourceSystem === "APPIUS"
          ? "Загрузите спецификацию вручную и повторите запрос."
          : "Загрузите CSV/Excel с остатками вручную и повторите запрос.";
      sections.push(
        `${system}: ${error.safeMessage}${error.manualImport ? ` ${manualAction}` : ""}`,
      );
      facts.push(`${system} не предоставил подтверждённые оперативные данные.`);
      if (error.manualImport) {
        recommendations.push(manualAction);
      }
      confidence = 0;
      requiresHumanReview = true;
    }

    for (const state of factsBySource<IntegrationState>(input.facts, "APPIUS.integration-state")) {
      if (state.state !== "AVAILABLE" && state.state !== "SLOW") {
        facts.push(`Состояние ${humanSystemName(state.system)}: ${integrationStatusLabel(state.state)}.`);
      }
    }
    for (const state of factsBySource<IntegrationState>(input.facts, "SAP.integration-state")) {
      if (state.state !== "AVAILABLE" && state.state !== "SLOW") {
        facts.push(`Состояние ${humanSystemName(state.system)}: ${integrationStatusLabel(state.state)}.`);
      }
      if (state.state === "STALE") {
        sections.push(
          `Снимок SAP S/4HANA помечен как устаревший${state.snapshotAt ? ` (${formatDate(state.snapshotAt)})` : ""}.`,
        );
        recommendations.push("Проверьте актуальность снимка перед принятием решения.");
        requiresHumanReview = true;
        confidence = Math.min(confidence, 0.65);
      }
    }

    for (const specifications of factsBySource<Specification[]>(input.facts, "APPIUS.specifications")) {
      if (specifications.length === 0) {
        sections.push("Доступные спецификации не найдены.");
        facts.push("Appius вернул пустой список спецификаций для активного пользователя.");
      } else {
        sections.push(
          [
            "Доступные спецификации:",
            ...specifications.map(
              (specification) =>
                `- ${specification.name} (${specification.id}), актуальная версия ${specification.latestVersionNumber}, позиций: ${specification.positionCount}`,
            ),
          ].join("\n"),
        );
        facts.push(`Appius вернул ${specifications.length} спецификации.`);
      }
    }

    for (const version of factsBySource<SpecificationVersion>(input.facts, "APPIUS.latest-version")) {
      sections.push(
        `Актуальная версия спецификации ${version.specificationId}: ${version.versionNumber} (${version.id}), позиций: ${version.positionCount}.`,
      );
      facts.push(`Версия ${version.id} отмечена Appius как ${version.isCurrent ? "актуальная" : "неактуальная"}.`);
      if (!version.isCurrent) {
        recommendations.push("Не используйте эту версию для нового анализа; запросите актуальную версию Appius.");
        requiresHumanReview = true;
        confidence = Math.min(confidence, 0.4);
      }
    }

    for (const positions of factsBySource<Position[]>(input.facts, "APPIUS.positions")) {
      sections.push(
        positions.length === 0
          ? "В выбранной актуальной версии позиции не найдены."
          : `В актуальной версии найдено позиций: ${positions.length}. ${positions
              .slice(0, 6)
              .map((position) => `${position.internalCode} — ${position.nameRu}`)
              .join("; ")}${positions.length > 6 ? "; …" : "."}`,
      );
      facts.push(`Appius подтвердил ${positions.length} позиций в запрошенной версии.`);
    }

    for (const materials of factsBySource<SapMaterial[]>(input.facts, "SAP.material-stock")) {
      appendStockAnswer(materials, requestedQuantity, sections, facts, recommendations, () => {
        requiresHumanReview = true;
      });
    }

    for (const result of factsBySource<StockSearchResult>(input.facts, "SAP.stock-search")) {
      appendStockAnswer(result.items, requestedQuantity, sections, facts, recommendations, () => {
        requiresHumanReview = true;
      });
      if (result.items.length > 0) {
        facts.push(`Снимок SAP: ${result.snapshotAt}; всего результатов: ${result.total}.`);
      }
    }

    for (const item of factsBySource<CatalogItemWithStock | null>(input.facts, "CATALOG.item")) {
      if (!item) {
        sections.push("Позиция с указанным кодом в промышленном каталоге не найдена.");
        facts.push("По точному коду каталог вернул пустой результат.");
        continue;
      }
      const descriptors = [item.manufacturer, item.standard, item.materialGrade]
        .filter(Boolean)
        .join(", ");
      sections.push(
        `Позиция промышленного каталога ${item.itemCode} — ${item.nameRu}${descriptors ? ` (${descriptors})` : ""}. ` +
          `Суммарный доступный остаток: ${formatQuantity(item.totalAvailableQuantity)} ${item.unit} по ${item.balanceCount} складским записям` +
          `${item.latestSnapshotAt ? `, снимок ${formatDate(item.latestSnapshotAt)}` : ""}.`,
      );
      facts.push(
        `${item.itemCode}: ${item.itemKind === "ASSEMBLY" ? "сборочный узел" : "компонент"}; остаток агрегирован по всем складским записям.`,
      );
      appendCatalogDemand(
        item.itemCode,
        item.totalAvailableQuantity,
        item.unit,
        requestedQuantity,
        sections,
        facts,
        recommendations,
        () => {
          requiresHumanReview = true;
        },
      );
    }

    for (const result of factsBySource<CatalogSearchResult>(input.facts, "CATALOG.search")) {
      if (result.items.length === 0) {
        sections.push("В промышленном каталоге подтверждённые позиции по запросу не найдены.");
        facts.push("Каталог вернул пустой результат поиска.");
        continue;
      }
      sections.push(
        [
          `В промышленном каталоге найдено позиций: ${result.total}.`,
          ...result.items.slice(0, 8).map(
            (item) =>
              `- ${item.itemCode} — ${item.nameRu}: ${formatQuantity(item.totalAvailableQuantity)} ${item.unit} суммарно`,
          ),
          ...(result.total > 8 ? [`- Ещё позиций: ${result.total - 8}.`] : []),
        ].join("\n"),
      );
      facts.push(
        `Показано ${Math.min(result.items.length, 8)} из ${result.total} позиций промышленного каталога.`,
      );
    }

    for (const result of factsBySource<CatalogSubstituteResult | null>(
      input.facts,
      "CATALOG.substitutes",
    )) {
      if (!result?.family || result.items.length === 0) {
        sections.push("Подтверждённые взаимозаменяемые позиции для выбранного кода не найдены.");
        recommendations.push("Не назначайте замену без подтверждённого семейства совместимости.");
        requiresHumanReview = true;
        confidence = Math.min(confidence, 0.35);
        continue;
      }
      sections.push(
        [
          `Взаимозаменяемые позиции для ${result.sourceItemCode} из семейства «${result.family.nameRu}»:`,
          ...result.items.map(
            (item) =>
              `- ${item.itemCode} — ${item.nameRu}: ${formatQuantity(item.totalAvailableQuantity)} ${item.unit} суммарно`,
          ),
        ].join("\n"),
      );
      facts.push(
        `Показаны только подтверждённые участники одного активного семейства взаимозаменяемости; несовместимые контрольные позиции исключены.`,
      );
      recommendations.push(
        "Перед применением замены подтвердите рабочую среду и присоединительные размеры у ответственного специалиста.",
      );
      requiresHumanReview = true;
      confidence = Math.min(confidence, 0.8);
    }

    for (const bom of factsBySource<CatalogAssemblyBom | null>(input.facts, "CATALOG.bom")) {
      if (!bom) {
        sections.push("Для выбранной позиции состав сборочного узла не найден.");
        facts.push("Каталог не вернул спецификацию сборочного узла по указанному коду.");
        continue;
      }
      sections.push(
        [
          `Состав узла ${bom.assembly.itemCode} — ${bom.assembly.nameRu}:`,
          ...bom.components.map(({ positionNumber, quantity, unit, isCritical, component }) =>
            `- поз. ${positionNumber}: ${component.itemCode} — ${component.nameRu}, ${formatQuantity(quantity)} ${unit}` +
            `; доступно суммарно ${formatQuantity(component.totalAvailableQuantity)} ${component.unit}` +
            `${isCritical ? "; критический компонент" : ""}`,
          ),
        ].join("\n"),
      );
      facts.push(`Каталог подтвердил ${bom.components.length} компонентов в составе узла.`);
      const shortages = bom.components.filter(
        ({ quantity, component }) => component.totalAvailableQuantity < quantity,
      );
      if (shortages.length > 0) {
        recommendations.push(
          `Проверьте обеспечение компонентов с недостаточным остатком: ${shortages.map(({ component }) => component.itemCode).join(", ")}.`,
        );
        requiresHumanReview = true;
        confidence = Math.min(confidence, 0.7);
      }
    }

    for (const result of factsBySource<ResponsibilityFact>(input.facts, "NORMATIVE.responsibility")) {
      const rule = result.rules[0];
      if (!rule) {
        sections.push(`Для позиции ${result.position.internalCode} основание ответственности не найдено.`);
        recommendations.push("Передайте позицию на экспертную классификацию ответственности.");
        facts.push("Normative не вернул применимое демонстрационное правило.");
        requiresHumanReview = true;
        confidence = Math.min(confidence, 0.2);
      } else {
        const label = rule.responsibility === "CUSTOMER" ? "Заказчик" : "Подрядчик";
        sections.push(
          `Ответственность по позиции ${result.position.internalCode} — «${label}» по пункту ${rule.clauseId} документа ${rule.documentId}, версия ${rule.version}.`,
        );
        facts.push(`Правило ${rule.documentId}/${rule.clauseId} назначает ответственность «${label}».`);
      }
    }

    for (const result of factsBySource<AnalogueFact>(input.facts, "NORMATIVE.analogue")) {
      if (result.rules.length === 0) {
        sections.push(`Для позиции ${result.position.internalCode} нормативное основание аналога не найдено.`);
        recommendations.push("Не использовать замену без подтверждённого правила и экспертной проверки.");
        facts.push("Normative не вернул применимое демонстрационное правило аналога.");
        requiresHumanReview = true;
        confidence = Math.min(confidence, 0.15);
        continue;
      }
      if (!result.coverage || result.coverage.allocations.length === 0) {
        sections.push(
          `Для позиции ${result.position.internalCode} правило найдено, но допустимое складское покрытие не подтверждено.`,
        );
        recommendations.push("Проверьте характеристики кандидатов и доступный остаток вручную.");
        requiresHumanReview = true;
        confidence = Math.min(confidence, 0.35);
        continue;
      }

      const allocationText = result.coverage.allocations
        .map(
          (allocation) =>
            `${allocation.material.materialCode}: ${formatQuantity(allocation.allocatedQuantity)} ${allocation.material.unit}`,
        )
        .join("; ");
      sections.push(
        `Аналоговое покрытие для ${result.position.internalCode}: ${formatQuantity(result.coverage.coveredQuantity)} из ${formatQuantity(result.coverage.requiredQuantity)} ${result.coverage.unit}. ${allocationText}.`,
      );
      facts.push(
        `Покрытие ${result.coverage.complete ? "полное" : "неполное"}; расчёт выполнен только по кандидатам, разрешённым демонстрационным правилом.`,
      );
      if (!result.coverage.complete) {
        recommendations.push("Недостающее количество требует закупки или другого подтверждённого аналога.");
        requiresHumanReview = true;
        confidence = Math.min(confidence, 0.65);
      }
      if (result.coverage.allocations.some((allocation) => allocation.verdict !== "SUITABLE")) {
        recommendations.push("Кандидаты с отклонениями требуют экспертной проверки.");
        requiresHumanReview = true;
        confidence = Math.min(confidence, 0.7);
      }
    }

    for (const run of factsBySource<ScenarioRun>(input.facts, "SCENARIO.run")) {
      sections.push(
        `Запуск ${run.id}: статус «${runStatusLabel(run.status)}», прогресс ${run.progress}%, текущий шаг «${localizeKnownEnum(run.currentStep)}».`,
      );
      facts.push(`Состояние сценарного запуска получено из базы данных, версия записи ${run.version}.`);
      if (run.status === "FAILED") {
        recommendations.push(run.errorMessage ?? "Откройте безопасное описание ошибки и повторите запуск после устранения причины.");
        requiresHumanReview = true;
      }
    }

    for (const result of factsBySource<PositionAnalysisResult>(input.facts, "SCENARIO.position-result")) {
      const material = result.match.material;
      sections.push(
        `Результат позиции ${result.position.id} (${result.position.internalCode}): ${analysisStatusLabel(result.status)}; ` +
          `${material ? `${material.materialCode}, оценка совпадения ${result.match.score}` : "прямое совпадение не найдено"}.`,
      );
      facts.push(
        `Ответственность: ${result.responsibility === "CUSTOMER" ? "Заказчик" : "Подрядчик"}; ` +
          `категория совпадения: ${matchCategoryLabel(result.match.category)}.`,
      );
      if (result.requiresHumanReview) {
        recommendations.push("Результат позиции отмечен для экспертной проверки.");
        requiresHumanReview = true;
        confidence = Math.min(confidence, 0.75);
      }
    }

    for (const summary of factsBySource<ReportSummary>(input.facts, "REPORT.summary")) {
      sections.push(
        `Сводка отчёта: всего ${summary.total}; найдено ${summary.found}; вероятных совпадений ${summary.likely}; на проверку ${summary.review}; аналогов ${summary.analogues}; недостаточно ${summary.insufficient}; закупка ${summary.procurement}.`,
      );
      facts.push(
        `Ответственность: Заказчик — ${summary.customerResponsibility}, Подрядчик — ${summary.contractorResponsibility}.`,
      );
    }

    if (sections.length === 0) {
      return {
        answer:
          "Уточните объект запроса: код или название материала, идентификатор спецификации, позиции, запуска либо отчёта.",
        facts: [],
        recommendations: ["Например: «Какой остаток SAP-DEMO-0001?» или «Статус запуска run-demo-001»."],
        citations: [],
        confidence: 1,
        requiresHumanReview: false,
        toolCalls: [],
      };
    }

    return {
      answer: sections.join("\n\n"),
      facts: unique(facts),
      recommendations: unique(recommendations),
      citations: collectEnvelopeCitations(input.facts),
      confidence: clamp(confidence),
      requiresHumanReview,
      toolCalls: [],
    };
  }
}

export function createMockLLMProvider(): LLMProvider {
  return new MockLLMProvider();
}

function appendStockAnswer(
  materials: SapMaterial[],
  requestedQuantity: number | undefined,
  sections: string[],
  facts: string[],
  recommendations: string[],
  markForReview: () => void,
): void {
  if (materials.length === 0) {
    sections.push("В текущем снимке SAP подтверждённые материалы по запросу не найдены.");
    facts.push("SAP вернул пустой результат поиска.");
    return;
  }
  sections.push(
    [
      "Остатки SAP:",
      ...materials.slice(0, 8).map(
        (material) =>
          `- ${material.materialCode} — ${material.nameRu}: ${formatQuantity(material.availableQuantity)} ${material.unit}, склад ${material.storageLocation}, снимок ${formatDate(material.snapshotAt)}`,
      ),
      ...(materials.length > 8 ? [`- Ещё записей: ${materials.length - 8}.`] : []),
    ].join("\n"),
  );
  facts.push(`SAP подтвердил ${materials.length} записей остатка.`);
  if (requestedQuantity !== undefined) {
    const targetCode = materials[0].materialCode;
    const targetRows = materials.filter((material) => material.materialCode === targetCode);
    const available = targetRows.reduce((sum, material) => sum + material.availableQuantity, 0);
    const unit = targetRows[0].unit;
    if (available < requestedQuantity) {
      const deficit = requestedQuantity - available;
      sections.push(
        `Для указанной потребности ${formatQuantity(requestedQuantity)} ${unit} подтверждено ${formatQuantity(available)} ${unit}; дефицит ${formatQuantity(deficit)} ${unit}.`,
      );
      facts.push(`Вычисленный дефицит по ${targetCode}: ${formatQuantity(deficit)} ${unit}.`);
      recommendations.push("Недостающее количество требует закупки или подтверждённого аналога.");
      markForReview();
    } else {
      sections.push(
        `Указанная потребность ${formatQuantity(requestedQuantity)} ${unit} покрывается подтверждённым остатком ${formatQuantity(available)} ${unit}.`,
      );
      facts.push(`После расчётного покрытия останется ${formatQuantity(available - requestedQuantity)} ${unit}.`);
    }
  }
  if (materials.some((material) => material.availableQuantity <= 0)) {
    recommendations.push("Позиции с нулевым остатком требуют закупки или подтверждённого аналога.");
    markForReview();
  }
}

function appendCatalogDemand(
  itemCode: string,
  available: number,
  unit: string,
  requestedQuantity: number | undefined,
  sections: string[],
  facts: string[],
  recommendations: string[],
  markForReview: () => void,
): void {
  if (requestedQuantity === undefined) return;
  if (available >= requestedQuantity) {
    sections.push(
      `Потребность ${formatQuantity(requestedQuantity)} ${unit} покрывается; расчётный остаток после выдачи — ${formatQuantity(available - requestedQuantity)} ${unit}.`,
    );
    facts.push(`По ${itemCode} подтверждено полное складское покрытие потребности.`);
    return;
  }
  const deficit = requestedQuantity - available;
  sections.push(
    `Для потребности ${formatQuantity(requestedQuantity)} ${unit} не хватает ${formatQuantity(deficit)} ${unit}.`,
  );
  facts.push(`Расчётный дефицит по ${itemCode}: ${formatQuantity(deficit)} ${unit}.`);
  recommendations.push("Недостающее количество требует закупки или подтверждённой замены.");
  markForReview();
}

function extractRequestedQuantity(message: string): number | undefined {
  const withoutIdentifiers = message
    .replace(/\b(?:CAT-DEMO|SAP-DEMO)-[A-Z0-9-]+\b/giu, " ")
    .replace(/\b(?:position|spec|run|scenario-run)-[A-Z0-9-]+\b/giu, " ");
  const match =
    withoutIdentifiers.match(
      /(?:в\s+количеств\w*|количеств\w*|потребност\w*|quantity|qty)\D{0,12}(\d+(?:[.,]\d+)?)/iu,
    ) ??
    withoutIdentifiers.match(
      /(?:требуется|нужно|необходимо|required|need)\s*(\d+(?:[.,]\d+)?)/iu,
    );
  if (!match) return undefined;
  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function factsBySource<T>(facts: Fact[], source: string): T[] {
  return facts
    .filter((fact) => fact.source === source)
    .map((fact) => unwrap<T>(fact.payload).data);
}

function unwrap<T>(payload: unknown): GroundedFactEnvelope<T> {
  if (isRecord(payload) && "data" in payload) {
    return payload as unknown as GroundedFactEnvelope<T>;
  }
  return { data: payload as T };
}

function collectEnvelopeCitations(facts: Fact[]): GroundedCitation[] {
  return dedupeCitations(
    facts.flatMap((fact) => {
      const envelope = unwrap<unknown>(fact.payload);
      return Array.isArray(envelope.citations) ? envelope.citations : [];
    }),
  );
}

function dedupeCitations(citations: GroundedCitation[]): GroundedCitation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = `${citation.sourceSystem}:${citation.entityId}:${citation.versionOrSnapshot}:${citation.clauseId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function humanSystemName(system: string): string {
  if (system === "APPIUS") return "Appius PLM";
  if (system === "SAP") return "SAP S/4HANA";
  if (system === "CATALOG") return "Промышленный каталог";
  if (system === "NORMATIVE") return "Нормативное хранилище";
  if (system === "SCENARIO") return "Сценарный процесс";
  if (system === "REPORT") return "Отчёт";
  return "Источник данных";
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
