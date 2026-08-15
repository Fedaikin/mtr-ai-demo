import type {
  AnalogueSearchDecision,
  AnalogueVerdict,
  IntegrationSystem,
  IntegrationStatus,
  MatchCategory,
  ScenarioRunStatus,
  UserRole,
} from "@/domain/models";

type Responsibility = "CUSTOMER" | "CONTRACTOR";
type AnalysisStatus = "FOUND" | "NOT_FOUND" | "ANALOGUES" | "INSUFFICIENT";
type StepOutcome = "STARTED" | "COMPLETED" | "FAILED" | "CANCELLED";
type AuditOutcome = "SUCCESS" | "FAILURE";
type SpecificationVersionStatus = "ACTIVE" | "SUPERSEDED";
type AnalogueSearchOutcome = AnalogueSearchDecision["outcome"];

export const ENUM_LABELS = {
  runStatus: {
    QUEUED: "В очереди",
    LOADING_APPIUS: "Загрузка данных из Appius PLM",
    SYNCING_SAP: "Синхронизация с SAP S/4HANA",
    CLASSIFYING_RESPONSIBILITY: "Определение ответственности",
    MATCHING_STOCK: "Поиск на складе",
    FINDING_ANALOGUES: "Поиск аналогов",
    GENERATING_REPORT: "Формирование отчёта",
    COMPLETED: "Завершено",
    FAILED: "Ошибка",
    CANCELLED: "Отменено",
  } satisfies Record<ScenarioRunStatus, string>,
  integrationStatus: {
    AVAILABLE: "Доступно",
    UNAVAILABLE: "Недоступно",
    SLOW: "Замедленная работа",
    ACCESS_DENIED: "Доступ запрещён",
    STALE_VERSION: "Версия устарела",
    STALE: "Данные устарели",
    RATE_LIMITED: "Превышен лимит запросов",
    MALFORMED_RESPONSE: "Некорректный ответ",
  } satisfies Record<IntegrationStatus, string>,
  responsibility: {
    CUSTOMER: "Заказчик",
    CONTRACTOR: "Подрядчик",
  } satisfies Record<Responsibility, string>,
  matchCategory: {
    EXACT: "Точное совпадение",
    LIKELY: "Вероятное совпадение",
    REVIEW: "Требуется проверка",
    NO_MATCH: "Не найдено",
  } satisfies Record<MatchCategory, string>,
  analogueVerdict: {
    SUITABLE: "Подходит",
    REVIEW: "Требуется экспертная проверка",
    NOT_RECOMMENDED: "Не рекомендуется",
  } satisfies Record<AnalogueVerdict, string>,
  analogueSearchOutcome: {
    ALLOCATED: "Аналог распределён",
    NO_APPLICABLE_RULE: "Нет применимого нормативного правила",
    NO_ELIGIBLE_CANDIDATE: "Допустимый аналог не найден",
  } satisfies Record<AnalogueSearchOutcome, string>,
  analysisStatus: {
    FOUND: "Найдено на складе",
    NOT_FOUND: "Не найдено",
    ANALOGUES: "Покрыто аналогами",
    INSUFFICIENT: "Недостаточное количество",
  } satisfies Record<AnalysisStatus, string>,
  stepOutcome: {
    STARTED: "Выполняется",
    COMPLETED: "Завершено",
    FAILED: "Ошибка",
    CANCELLED: "Отменено",
  } satisfies Record<StepOutcome, string>,
  auditOutcome: {
    SUCCESS: "Успешно",
    FAILURE: "Ошибка",
  } satisfies Record<AuditOutcome, string>,
  specificationVersionStatus: {
    ACTIVE: "Действующая",
    SUPERSEDED: "Заменена новой версией",
  } satisfies Record<SpecificationVersionStatus, string>,
  role: {
    USER: "Пользователь",
    ADMIN: "Администратор",
  } satisfies Record<UserRole, string>,
  runMode: {
    NORMAL: "Обычный режим",
    DRY_RUN: "Проверочный запуск",
  },
  scenarioKind: {
    FULL: "Полный анализ",
    STOCK_ONLY: "Только складские остатки",
    SAP_FAILURE: "Отказ SAP S/4HANA",
    APPIUS_NEW_VERSION: "Новая версия Appius PLM",
    COMPOSITE_ANALOGUE: "Составное покрытие аналогами",
  },
  scenarioId: {
    "scenario-full-analysis": "Полный анализ спецификации",
    "scenario-stock-search-only": "Только поиск по складу",
    "scenario-sap-failure-manual-import": "Отказ SAP S/4HANA и ручной импорт",
    "scenario-appius-new-version": "Новая версия Appius PLM",
    "scenario-insufficient-and-composite-analogues": "Недостаточный остаток и составные аналоги",
  },
  integrationSystem: {
    APPIUS: "Appius PLM",
    SAP: "SAP S/4HANA",
    RAG: "Нормативный поиск RAG",
    LLM: "Mock LLM",
  } satisfies Record<IntegrationSystem, string>,
  specificationScope: {
    ALL_CURRENT: "Все актуальные спецификации",
    ALL_CURRENT_SPECIFICATIONS: "Все актуальные спецификации",
    SINGLE: "Одна спецификация",
  },
  versionResolutionPolicy: {
    LATEST: "Последняя актуальная версия",
    LATEST_AT_RUN_START: "Актуальная на момент запуска",
  },
  seedSet: {
    BASE: "Базовый набор",
  },
  parseStatus: {
    PARSED: "Обработано",
    REVIEW_REQUIRED: "Требуется проверка",
  },
  recommendationKind: {
    PRIMARY: "Основной план покрытия",
    ALTERNATIVE: "Альтернативный план покрытия",
  },
  equipmentType: {
    PIPE: "Труба",
    ELBOW: "Отвод",
    FLANGE: "Фланец",
    GATE_VALVE: "Задвижка",
    VALVE: "Клапан",
    CHECK_VALVE: "Обратный клапан",
    BALL_VALVE: "Шаровой кран",
    GASKET: "Прокладка",
    FASTENER: "Крепёж",
    CABLE: "Кабель",
    CABLE_TRAY: "Кабельный лоток",
    PUMP: "Насос",
    ELECTRIC_MOTOR: "Электродвигатель",
    PRESSURE_GAUGE: "Манометр",
    FITTING: "Фитинг",
    REDUCER: "Переход",
    TEE: "Тройник",
  },
  criticality: {
    LOW: "Низкая",
    MEDIUM: "Средняя",
    HIGH: "Высокая",
    CRITICAL: "Критическая",
  },
} as const;

export const AGENT_LOG_UI_LABELS = {
  errorTypePlaceholder: "Например: недоступность SAP",
  citations: "Источники",
} as const;

export const AUDIT_UI_LABELS = {
  action: {
    SCENARIO_RUN_CREATED: "Запуск сценария создан",
    SCENARIO_STEP_COMPLETED: "Шаг сценария завершён",
    SCENARIO_STEP_FAILED: "Шаг сценария завершился ошибкой",
    SCENARIO_RUN_CANCELLED: "Запуск сценария отменён",
    SCENARIO_RUN_RETRIED: "Повторный запуск сценария создан",
    SCENARIO_MANUAL_SAP_IMPORT_ATTACHED: "Ручной импорт SAP прикреплён к сценарию",
    SCENARIO_MANUAL_APPIUS_IMPORT_ATTACHED: "Ручной импорт Appius прикреплён к сценарию",
    SCENARIO_SAP_STALE_SNAPSHOT_USED: "Использован устаревший снимок SAP",
    SCENARIO_DRAIN_YIELDED: "Фоновое выполнение сценария приостановлено",
    SCENARIO_DRAIN_FAILED: "Фоновое выполнение сценария завершилось ошибкой",
    FILE_UPLOADED_AND_PARSED: "Файл загружен и обработан",
    MANUAL_SPECIFICATION_IMPORT_VALIDATED: "Ручной импорт спецификации проверен",
    MANUAL_SAP_IMPORT_VALIDATED: "Ручной импорт SAP проверен",
    POSITION_RESPONSIBILITY_OVERRIDDEN: "Ответственность по позиции скорректирована",
    ADMIN_INTEGRATION_STATE_UPDATED: "Состояние интеграции изменено",
    ADMIN_DEMO_DATA_RESET: "Демонстрационные данные восстановлены",
    ADMIN_DICTIONARY_UPDATED: "Словарь обновлён",
    ADMIN_SCENARIO_ENABLED_UPDATED: "Доступность сценария изменена",
    ADMIN_PROMPT_VERSION_CREATED: "Версия промпта создана",
    ADMIN_PROMPT_VERSION_ACTIVATED: "Версия промпта активирована",
    AUTH_LOGIN_SUCCEEDED: "Вход выполнен",
    AUTH_LOGIN_FAILED: "Неудачная попытка входа",
    AUTH_LOGOUT_SUCCEEDED: "Выход выполнен",
    AUTH_LOGOUT_FAILED: "Неудачная попытка выхода",
    REPORT_EXPORT_SUCCEEDED: "Отчёт экспортирован",
    REPORT_EXPORT_FAILED: "Экспорт отчёта завершился ошибкой",
    "agent.thread.created": "Диалог AI-агента создан",
    "agent.request.received": "Запрос AI-агента получен",
    "agent.tool.request": "Инструмент AI-агента вызван",
    "agent.tool.result": "Результат инструмента AI-агента получен",
    "agent.response.completed": "Ответ AI-агента сформирован",
    "agent.security.prompt_injection_blocked": "Попытка подмены инструкций заблокирована",
    "agent.security.user_id_override_ignored": "Попытка подмены пользователя отклонена",
    "agent.config.dictionary.loaded": "Словарь AI-агента загружен",
    "appius.new_version.promoted": "Новая версия Appius активирована",
    "appius.stale_version.rejected": "Устаревшая версия Appius отклонена",
    "integration.appius.state.updated": "Состояние Appius изменено",
    "integration.sap.state.updated": "Состояние SAP изменено",
    "integration.sap.seed.reset": "Базовые данные SAP восстановлены",
  },
  entityType: {
    AUTHENTICATION: "Аутентификация",
    AUTH_SESSION: "Сеанс пользователя",
    DEMO_DATASET: "Демонстрационный набор данных",
    DICTIONARY: "Словарь",
    INTEGRATION: "Интеграция",
    POSITION_ANALYSIS_RESULT: "Результат анализа позиции",
    PROMPT_VERSION: "Версия промпта",
    REPORT_EXPORT: "Экспорт отчёта",
    SCENARIO: "Сценарий",
    SCENARIO_RUN: "Запуск сценария",
    UPLOADED_FILE: "Загруженный файл",
    agent_thread: "Диалог AI-агента",
    agent_tool_call: "Вызов инструмента AI-агента",
    dictionary: "Словарь AI-агента",
    integration_state: "Состояние интеграции",
    specification: "Спецификация",
    specification_version: "Версия спецификации",
  },
  detailCode: {
    DEMO_CREDENTIALS: "Демонстрационные учётные данные",
    INVALID_CREDENTIALS: "Неверные учётные данные",
    SESSION_NOT_FOUND: "Сеанс не найден",
    VALIDATION_ERROR: "Ошибка проверки данных",
    INTERNAL_ERROR: "Внутренняя ошибка",
    STALE_VERSION_REJECTED: "Устаревшая версия отклонена",
    NEW_VERSION_PROMOTED: "Новая версия активирована",
    BACKGROUND_DRAIN_FAILED: "Ошибка фонового выполнения",
    DICTIONARY_UNAVAILABLE: "Словарь недоступен",
    APPIUS_UNAVAILABLE: "Appius PLM недоступен",
    APPIUS_ACCESS_DENIED: "Доступ к Appius PLM запрещён",
    APPIUS_STALE_VERSION: "Версия Appius PLM устарела",
    SAP_UNAVAILABLE: "SAP S/4HANA недоступена",
    SAP_STALE_SNAPSHOT_REQUIRED: "Требуется актуальный снимок SAP",
    NORMATIVE_UNAVAILABLE: "Нормативный поиск недоступен",
    LLM_UNAVAILABLE: "Mock LLM недоступен",
    LLM_PROVIDER_UNAVAILABLE: "Провайдер Mock LLM недоступен",
    CONTACT_ADMIN: "Обратиться к администратору",
    MANUAL_IMPORT: "Выполнить ручной импорт",
    HISTORY_VIEW_ONLY: "Только просмотр истории",
    LAST_KNOWN_SNAPSHOT: "Последний известный снимок",
    TIME_LIMIT: "Достигнут лимит времени",
    ATTEMPT_LIMIT: "Достигнут лимит попыток",
    TRANSITION_LIMIT: "Достигнут лимит переходов",
    TERMINAL: "Запуск завершён",
    TypeError: "Ошибка типа данных",
    SyntaxError: "Синтаксическая ошибка",
    RangeError: "Ошибка диапазона",
    UnknownError: "Неизвестная ошибка",
    MOCK_OPERATIONAL_DATA: "Моковые оперативные данные",
    SAP_MOCK_ODATA: "Моковые данные SAP OData",
    FILE_STORAGE: "Файловое хранилище",
    APPIUS_MANUAL_IMPORT: "Ручной импорт Appius PLM",
    SAP_MANUAL_IMPORT: "Ручной импорт SAP S/4HANA",
    APPIUS: "Appius PLM",
    SAP: "SAP S/4HANA",
    RAG: "Нормативный поиск RAG",
    LLM: "Mock LLM",
    "scenario-full-analysis": "Полный анализ спецификации",
    "scenario-stock-search-only": "Только поиск по складу",
    "scenario-sap-failure-manual-import": "Отказ SAP и ручной импорт",
    "scenario-appius-new-version": "Новая версия Appius PLM",
    "scenario-insufficient-and-composite-analogues": "Недостаточный остаток и составные аналоги",
    array: "Массив",
    object: "Объект",
  },
  detailKey: {
    activeEntryCount: "Активных записей",
    activated: "Активирован",
    after: "После изменения",
    appius: "Appius PLM",
    appiusVersions: "Версии Appius PLM",
    arguments: "Аргументы",
    attemptedUserOverride: "Попытка подмены пользователя",
    attempts: "Попытки",
    auditCode: "Код аудита",
    authenticationMethod: "Способ аутентификации",
    before: "До изменения",
    blocked: "Заблокировано",
    canonicalPositions: "Канонические позиции",
    checksum: "Контрольная сумма",
    checksumSha256: "Контрольная сумма SHA-256",
    citationCount: "Количество источников",
    citations: "Источники",
    clauseId: "Пункт документа",
    conflicts: "Конфликты версий",
    conversationId: "Идентификатор диалога",
    correlationId: "Идентификатор корреляции",
    currentVersionId: "Идентификатор текущей версии",
    delayMs: "Задержка, мс",
    dictionaryType: "Тип словаря",
    durationMs: "Длительность, мс",
    enabled: "Доступен",
    entityId: "Идентификатор объекта",
    errorCode: "Код ошибки",
    errorMessage: "Сообщение об ошибке",
    errorType: "Тип ошибки",
    eventId: "Идентификатор события",
    extension: "Расширение файла",
    factCount: "Количество фактов",
    fallbackPolicy: "Резервная политика",
    format: "Формат",
    freshness: "Актуальность",
    ignored: "Проигнорировано",
    id: "Идентификатор",
    intent: "Намерение запроса",
    kind: "Тип результата",
    key: "Ключ",
    messageLength: "Длина сообщения",
    mode: "Режим",
    model: "Модель",
    name: "Название",
    next: "Следующий шаг",
    parseStatus: "Статус обработки",
    positionCount: "Количество позиций",
    previousVersionId: "Идентификатор предыдущей версии",
    promptVersion: "Версия промпта",
    provider: "Провайдер",
    purpose: "Назначение",
    recommendedAction: "Рекомендуемое действие",
    reportGeneratedAt: "Отчёт сформирован",
    reportSchemaVersion: "Версия схемы отчёта",
    requestedVersionId: "Идентификатор запрошенной версии",
    requiresHumanReview: "Требуется проверка экспертом",
    result: "Результат",
    retryOfRunId: "Исходный запуск повтора",
    rowCount: "Количество строк",
    runId: "Идентификатор запуска",
    sapBalances: "Остатки SAP",
    sapMaterials: "Материалы SAP",
    scenarioId: "Идентификатор сценария",
    sessionRevoked: "Сеанс отозван",
    sizeBytes: "Размер, байт",
    snapshotAt: "Время снимка",
    snapshotId: "Идентификатор снимка",
    sourceKind: "Тип источника",
    sourceSystem: "Исходная система",
    sourceVersions: "Версии источников",
    specificationId: "Идентификатор спецификации",
    specificationScope: "Область спецификаций",
    state: "Состояние",
    status: "Статус",
    step: "Шаг",
    stopReason: "Причина остановки",
    system: "Система",
    titleLength: "Длина заголовка",
    tool: "Инструмент",
    toolCallCount: "Количество вызовов инструментов",
    total: "Всего",
    transitions: "Переходы",
    uploadedFileId: "Идентификатор загруженного файла",
    valueCount: "Количество значений",
    version: "Версия",
    versionAfter: "Версия после изменения",
    versionBefore: "Версия до изменения",
    versionId: "Идентификатор версии",
    versionNumber: "Номер версии",
    versionOrSnapshot: "Версия или снимок",
    count: "Количество",
  },
  tool: {
    "appius.getLatestVersion": "Получить актуальную версию Appius PLM",
    "appius.getPositions": "Получить позиции Appius PLM",
    "appius.getState": "Получить состояние Appius PLM",
    "appius.listSpecifications": "Получить спецификации Appius PLM",
    "llm.respond": "Сформировать ответ Mock LLM",
    "report.getSummary": "Получить сводку отчёта",
    "sap.getMaterialStock": "Получить остаток материала SAP S/4HANA",
    "sap.getState": "Получить состояние SAP S/4HANA",
    "sap.searchMaterialStock": "Найти материалы в SAP S/4HANA",
    "scenario.getPositionResult": "Получить результат позиции",
    "scenario.getRun": "Получить запуск сценария",
  },
  actionPlaceholder: "Например: запуск сценария создан",
  entityTypePlaceholder: "Например: запуск сценария",
} as const;

export const CHARACTERISTIC_LABELS: Readonly<Record<string, string>> = {
  standard: "Стандарт",
  materialGrade: "Марка материала",
  manufacturer: "Производитель",
  accuracyClass: "Класс точности",
  angleDeg: "Угол, °",
  branchDiameterMm: "Диаметр отвода, мм",
  connectionDnMm: "Присоединительный диаметр, мм",
  coreCount: "Количество жил",
  coreSectionMm2: "Сечение жилы, мм²",
  dialDiameterMm: "Диаметр циферблата, мм",
  flowM3h: "Подача, м³/ч",
  headM: "Напор, м",
  heightMm: "Высота, мм",
  inletDiameterMm: "Входной диаметр, мм",
  lengthMm: "Длина, мм",
  nominalDiameterMm: "Номинальный диаметр, мм",
  outletDiameterMm: "Выходной диаметр, мм",
  powerKw: "Мощность, кВт",
  pressureClassBar: "Класс давления, бар",
  pressureMaxMpa: "Максимальное давление, МПа",
  pressureMinMpa: "Минимальное давление, МПа",
  protectionClass: "Класс защиты",
  runDiameterMm: "Диаметр прохода, мм",
  speedRpm: "Частота вращения, об/мин",
  thicknessMm: "Толщина, мм",
  thread: "Резьба",
  voltageV: "Напряжение, В",
  wallThicknessMm: "Толщина стенки, мм",
  widthMm: "Ширина, мм",
};

export function runStatusLabel(value: ScenarioRunStatus): string {
  return ENUM_LABELS.runStatus[value];
}

export function integrationStatusLabel(value: IntegrationStatus): string {
  return ENUM_LABELS.integrationStatus[value];
}

export function integrationSystemLabel(value: IntegrationSystem): string {
  return ENUM_LABELS.integrationSystem[value];
}

export function responsibilityLabel(value: Responsibility | null): string {
  return value === null ? "Не определена" : ENUM_LABELS.responsibility[value];
}

export function matchCategoryLabel(value: MatchCategory): string {
  return ENUM_LABELS.matchCategory[value];
}

export function analogueVerdictLabel(value: AnalogueVerdict): string {
  return ENUM_LABELS.analogueVerdict[value];
}

export function analogueSearchOutcomeLabel(value: AnalogueSearchOutcome): string {
  return ENUM_LABELS.analogueSearchOutcome[value];
}

export function analysisStatusLabel(value: AnalysisStatus): string {
  return ENUM_LABELS.analysisStatus[value];
}

export function stepOutcomeLabel(value: StepOutcome): string {
  return ENUM_LABELS.stepOutcome[value];
}

export function auditOutcomeLabel(value: AuditOutcome): string {
  return ENUM_LABELS.auditOutcome[value];
}

export function specificationVersionStatusLabel(value: SpecificationVersionStatus): string {
  return ENUM_LABELS.specificationVersionStatus[value];
}

export function roleLabel(value: UserRole): string {
  return ENUM_LABELS.role[value];
}

export function recommendationKindLabel(value: "PRIMARY" | "ALTERNATIVE"): string {
  return ENUM_LABELS.recommendationKind[value];
}

export function scenarioLabel(value: string): string {
  return ENUM_LABELS.scenarioId[value as keyof typeof ENUM_LABELS.scenarioId] ?? value;
}

export function equipmentTypeLabel(value: string): string {
  return ENUM_LABELS.equipmentType[value as keyof typeof ENUM_LABELS.equipmentType] ?? value;
}

export function characteristicLabel(value: string): string {
  return CHARACTERISTIC_LABELS[value] ?? value;
}

const AUDIT_ACTION_BY_LABEL = reverseLabels(AUDIT_UI_LABELS.action);
const AUDIT_ENTITY_TYPE_BY_LABEL = reverseLabels(AUDIT_UI_LABELS.entityType);

export function auditActionLabel(value: string): string {
  return AUDIT_UI_LABELS.action[value as keyof typeof AUDIT_UI_LABELS.action] ?? value;
}

export function auditEntityTypeLabel(value: string): string {
  return AUDIT_UI_LABELS.entityType[value as keyof typeof AUDIT_UI_LABELS.entityType] ?? value;
}

export function auditActionCode(value: string): string {
  const normalized = value.trim();
  return AUDIT_ACTION_BY_LABEL[normalized.toLocaleLowerCase("ru-RU")] ?? normalized;
}

export function auditEntityTypeCode(value: string): string {
  const normalized = value.trim();
  return AUDIT_ENTITY_TYPE_BY_LABEL[normalized.toLocaleLowerCase("ru-RU")] ?? normalized;
}

export function localizeAuditDetails(value: unknown, parentKey?: string): unknown {
  if (typeof value === "string") return localizeAuditDetailValue(value, parentKey);
  if (Array.isArray(value)) return value.map((entry) => localizeAuditDetails(entry, parentKey));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        auditDetailKeyLabel(key),
        localizeAuditDetails(entry, key),
      ]),
    );
  }
  return value;
}

const IDENTIFIER_ONLY_GROUPS = new Set(["integrationSystem", "scenarioId"]);

const FLAT_ENUM_LABELS: Readonly<Record<string, string>> = Object.freeze(
  Object.assign(
    {},
    ...Object.entries(ENUM_LABELS)
      .filter(([group]) => !IDENTIFIER_ONLY_GROUPS.has(group))
      .map(([, labels]) => labels),
  ),
);

const RAW_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze(Object.assign(
  {},
  ENUM_LABELS.runStatus,
  ENUM_LABELS.integrationStatus,
  ENUM_LABELS.responsibility,
  ENUM_LABELS.matchCategory,
  ENUM_LABELS.analogueVerdict,
  ENUM_LABELS.analogueSearchOutcome,
  ENUM_LABELS.analysisStatus,
  ENUM_LABELS.stepOutcome,
  ENUM_LABELS.auditOutcome,
  ENUM_LABELS.specificationVersionStatus,
  ENUM_LABELS.role,
  ENUM_LABELS.runMode,
  ENUM_LABELS.scenarioKind,
  ENUM_LABELS.parseStatus,
  ENUM_LABELS.recommendationKind,
));

export const RAW_USER_ENUMS = Object.freeze(
  Object.keys(RAW_STATUS_LABELS).toSorted((left, right) => right.length - left.length),
);

const RAW_USER_ENUM_PATTERN = enumTokenPattern(RAW_USER_ENUMS);
const KNOWN_ENUM_PATTERN = enumTokenPattern(Object.keys(FLAT_ENUM_LABELS));

export function localizeKnownEnum(value: string): string {
  return FLAT_ENUM_LABELS[value] ?? value;
}

export function localizeKnownEnumsInText(value: string): string {
  return value.replace(KNOWN_ENUM_PATTERN, (raw) => localizeKnownEnum(raw));
}

export function findRawUserEnums(value: string): string[] {
  return [...new Set(value.match(RAW_USER_ENUM_PATTERN) ?? [])];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function enumTokenPattern(values: readonly string[]): RegExp {
  const alternatives = values
    .toSorted((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|");
  return new RegExp(
    `(?<![\\p{L}\\p{N}_-])(?<![A-Z0-9]\\.)(?:${alternatives})(?![\\p{L}\\p{N}_-])`,
    "gu",
  );
}

function localizeAuditDetailValue(value: string, parentKey?: string): string {
  if (parentKey === "tool") {
    return AUDIT_UI_LABELS.tool[value as keyof typeof AUDIT_UI_LABELS.tool] ?? "Системный инструмент";
  }
  const auditLabel = AUDIT_UI_LABELS.detailCode[value as keyof typeof AUDIT_UI_LABELS.detailCode];
  if (auditLabel) return auditLabel;
  const localized = localizeKnownEnumsInText(value);
  if (localized !== value) return localized;
  return /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/u.test(value) ? "Системное значение" : value;
}

function reverseLabels(labels: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(
    Object.entries(labels).map(([raw, label]) => [label.toLocaleLowerCase("ru-RU"), raw]),
  ));
}

function auditDetailKeyLabel(value: string): string {
  return AUDIT_UI_LABELS.detailKey[value as keyof typeof AUDIT_UI_LABELS.detailKey] ?? "Системное поле";
}
