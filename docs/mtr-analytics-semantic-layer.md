# Семантический слой аналитики МТР

Этот документ фиксирует значения показателей, источники, правила качества данных и публичный контракт команды `ANALYSIS`. Он относится к синтетическому прототипу. Результат не является складским распоряжением, закупочным решением или экспертным визированием.

## Что решает слой

Без единого словаря два экрана или два сервиса могут по-разному трактовать «остаток», «дефицит» и «прогноз». Семантический слой задаёт одну versioned-формулу, единицу, временную зону, приоритет источников и поведение при неизвестных данных. Детерминированные движки выполняют расчёты. МТР-агент только формирует объяснение и безопасную публичную проекцию.

Путь расчёта:

```text
TrustedRequestContext
        |
        v
project / source / catalog / warehouse scope
        |
        v
versioned analytical dataset
        |
        v
quality + freshness gate
        |
        +--> coverage / trend / forecast / root cause / scenarios
        |                                      |
        +---------------- evidence graph ------+
                                               |
                                               v
                                      deterministic verifier
                                               |
                                               v
                                     safe public projection
                                               |
                                               v
                                      human review is required
```

## Версии

| Контракт | Версия |
|---|---|
| Semantic registry | `semantic-registry-1.0.0` |
| Analytical answer | `mtr-analytical-answer-1.0.0` |
| Public command projection | `mtr-agent-command-public-v1` |
| Certified dataset ID | `g1-vertical-v1` |
| Dataset schema | `1.0.0` |
| Текущая synthetic dataset version | `1.0.0-DEMO` |
| Coverage engine | `coverage-engine-1.0.0` |
| Trend engine | `trend-anomaly-engine-1.0.0` |
| Forecast models | `forecast-<model>-1.0.0` |

Изменение формулы, единицы, временной трактовки или обязательного источника требует новой версии semantic registry. Изменение состава synthetic-когорты требует новой dataset version и checksum.

## Словарь

| Термин | Значение |
|---|---|
| Физический остаток | Количество на складе до вычета резервов и карантина. |
| Резерв | Количество, уже закреплённое за другой потребностью и недоступное для нового покрытия. |
| Карантин | Количество, которое нельзя считать доступным до снятия ограничения. |
| Доступный остаток | Физический остаток минус резерв и карантин, но не меньше нуля. |
| Подтверждённое поступление | Количество из versioned inbound-записи; не включает неподтверждённый план. |
| Прогнозный спрос | Расход на будущем горизонте, рассчитанный выбранной моделью по истории до `originAt`. |
| Остаточный дефицит | Непокрытая потребность после прямого остатка, разрешённых аналогов и подтверждённого поступления. |
| Причина | Связь с causal oracle в synthetic dataset. Без него наблюдаемая связь называется ассоциацией. |
| Сценарий | Неизменяемая расчётная альтернатива. Сценарий не меняет SAP, Appius или operational state. |
| Abstention | Явный отказ от числового вывода при недостаточных, устаревших или конфликтующих данных. |

## Реестр показателей

Все показатели используют UTC. Базовая политика актуальности: не старше 15 минут и не более 15 минут расхождения между обязательными источниками. При нарушении свежести числовой прогноз недоступен.

### Доступный остаток

```text
available = max(0, on_hand - reserved - quarantined)
```

- ключ: `AVAILABLE_QUANTITY`;
- единица: `EA`;
- обязательные источники: SAP и каталог;
- приоритет: SAP `1`, каталог `2`.

Пример: `on_hand=120`, `reserved=25`, `quarantined=5` даёт `90 EA`.

### Прогнозный доступный остаток

```text
projected_available = available + confirmed_inbound - forecast_demand
```

- ключ: `PROJECTED_AVAILABLE_QUANTITY`;
- единица: `EA`;
- обязательные источники: SAP и каталог.

Неподтверждённая поставка не входит в `confirmed_inbound`.

### Средний недельный расход

```text
average_weekly_consumption = sum(consumption_quantity) / complete_week_count
```

- ключ: `AVERAGE_WEEKLY_CONSUMPTION`;
- единица: `EA`;
- обязательный источник: SAP;
- используются полные календарные недели и только движения `CONSUMPTION`.

### Покрытие запасом

```text
stock_coverage_days = available_quantity / average_daily_consumption
```

- ключ: `STOCK_COVERAGE_DAYS`;
- единица: `DAYS`;
- если средний дневной расход равен нулю или неизвестен, результат `null`, а не бесконечность.

### Прогнозный дефицит

```text
shortage = max(0, required_quantity - projected_available_quantity)
```

- ключ: `SHORTAGE_QUANTITY`;
- единица: `EA`;
- обязательные источники: Appius, SAP и каталог;
- потребность берётся из конкретной позиции и её versioned-контекста.

### Оценка риска дефицита

```text
risk = clamp(shortage_ratio * lead_time_factor * quality_factor, 0, 1)
```

- ключ: `SHORTAGE_RISK_SCORE`;
- единица: `RATIO`;
- это нормированная аналитическая оценка, а не вероятность;
- низкое качество данных ограничивает confidence и может полностью запретить числовой вывод.

## Количественное покрытие

Coverage engine ведёт отдельный ledger по коду материала и не использует одну и ту же единицу остатка дважды.

Порядок:

1. Проверить конечные неотрицательные значения и одинаковую единицу.
2. Посчитать доступный остаток по каждой складской строке.
3. Выделить прямой материал.
4. Последовательно выделить только разрешённые аналоги.
5. Вычесть подтверждённое поступление из оставшейся потребности.

```text
residual_deficit = max(
  0,
  required - direct_coverage - analogue_coverage - confirmed_inbound
)
```

Конфликт единиц завершает расчёт ошибкой `COVERAGE_UNIT_CONFLICT`. Дробные значения сохраняются до четырёх знаков; UI не должен принудительно представлять их как целые, если предметная единица допускает дробность.

## Качество и полнота данных

Для команды `ANALYSIS` обязательны четыре источника: `APPIUS`, `CATALOG`, `SAP`, `NORMATIVE`.

| Availability | Условие | Числовой прогноз | Human review |
|---|---|---|---|
| `COMPLETE` | Все обязательные источники присутствуют, свежие и без конфликтов; completeness `1` | Разрешён | Всегда требуется для рекомендации |
| `PARTIAL` | Источник устарел, неполон или содержит конфликт | Запрещён | Да |
| `UNAVAILABLE` | Хотя бы один обязательный источник отсутствует | Запрещён | Да |

Потолок confidence:

```text
quality_penalty = sum(BLOCKING ? 0.25 : WARNING ? 0.10 : 0)
confidence_ceiling =
  availability == UNAVAILABLE
    ? 0
    : clamp(min(completeness, 1 - quality_penalty), 0, 1)
```

Пустое поле не превращается в ноль. Неизвестный stock, расход, mapping или нормативная ответственность остаются неизвестными и перечисляются в `missingData` или `limitations`.

## Прогноз и backtest

Forecast engine сравнивает три модели:

- `NAIVE_LAST`;
- `MOVING_AVERAGE_4`;
- `LINEAR_TREND`.

Для каждой модели выполняется rolling-origin backtest: модель обучается на данных до очередной точки и прогнозирует следующую. Выбирается минимальный `WAPE`, затем минимальный `MAE`, затем стабильный порядок имени модели.

| Метрика | Формула / смысл |
|---|---|
| `originCount` | Количество точек rolling-origin проверки |
| `MAE` | Средняя абсолютная ошибка |
| `WAPE` | Сумма абсолютных ошибок / сумма фактических значений; при нулевой сумме используется MAE |
| `bias` | Средняя signed error `prediction - actual` |
| Interval | `point ± 1.96 * MAE`, нижняя граница не меньше нуля |

Числовой прогноз не строится, если:

- горизонт не входит в `1..26` недель;
- меньше десяти недель истории;
- единицы различаются;
- есть отрицательное или нечисловое потребление;
- недельный ряд имеет пропуски;
- наблюдение находится после `originAt`;
- quality availability не `COMPLETE`.

Интервал отражает историческую абсолютную ошибку. Он не является статистической гарантией заданного уровня покрытия.

## Тренд и аномалия

Тренд использует median/MAD, а не среднее и стандартное отклонение. Это уменьшает влияние одиночного выброса.

```text
robust_z = 0.6745 * (current - baseline_median) / MAD
```

- `SPIKE`, если `robust_z > 3.5`;
- `DROP`, если `robust_z < -3.5`;
- направление `UP`, если изменение медианы больше `10%`;
- направление `DOWN`, если меньше `-10%`;
- иначе `STABLE`.

При менее чем восьми наблюдениях или разных единицах статус `UNAVAILABLE`.

## Причины и ассоциации

Root-cause analyzer проверяет гипотезы по изменению расхода, резервов и подтверждённых поступлений.

- `CAUSAL` ставится только при наличии causal oracle и направленного изменения.
- Без oracle подтверждённая связь получает `ASSOCIATED` и явное ограничение: корреляция не доказывает причинность.
- При недоступных данных гипотеза получает `UNKNOWN`, contribution `0`, confidence `0`.

Вклад факторов нормируется до доли от суммы положительных risk-contributions. Он объясняет расчёт текущей версии и не переносится на другой dataset без повторного анализа.

## Сценарии и рекомендация

Движок создаёт четыре типа альтернатив:

| Тип | Условие |
|---|---|
| `DIRECT` | Покрытие исходным материалом |
| `SINGLE_SUBSTITUTE` | Один свежий нормативно разрешённый аналог той же единицы |
| `COMPOSITE_SUBSTITUTE` | Комбинация свежих нормативно разрешённых аналогов без двойного выделения |
| `PROCUREMENT` | Расчётная закупка; срок больше 90 дней делает вариант infeasible |

Feasible-вариант должен полностью покрывать потребность и не иметь hard-constraint rejection. Score применяется только к feasible-вариантам:

```text
score = coverage * 100
      - min(50, max_lead_time_days) * 0.5
      - min(1, deviation_score) * 25
```

Scenario engine не выполняет действие. Verifier проверяет evidence-ссылки, арифметику, backtest и feasibility. Рекомендация появляется только для проверенного feasible-сценария и всегда имеет:

- `autonomyLevel: A2`;
- `requiresHumanReview: true`;
- действие «Передать вариант специалисту для проверки и решения».

## Сертифицированный synthetic dataset

`g1-vertical-v1` изолирован от основного browse-корпуса. Он нужен для проверяемых расчётов и не выдаётся за данные предприятия.

| Сущность | Количество |
|---|---:|
| Спецификации / позиции | 12 / 240 |
| Сборочные узлы / компоненты | 24 / 216 |
| Сквозные position → catalog → SAP mappings | 228 |
| Намеренно неполные mappings | 12 |
| Склады / stock rows | 4 / 912 |
| Movements | 47 424: 52 недели × 4 типа × 228 материалов |
| Reservation/release events | 96 |
| Inbound supplies | 48 |
| BOM links | 144 |
| Shortage cases | 48: 36 с кандидатами, 12 без кандидата |
| Responsibility outcomes | 228 resolved, 12 unknown |
| Process runs / expert tasks / future outcome oracles | 48 / 24 / 24 |
| Quality cases | 6 |

Dataset manifest закрепляет seed, `asOf`, source versions, expected counts и checksum. Весь набор воспроизводится без внешнего LLM и без изменения пользователей, RBAC, auth или Production.

## Как вызвать анализ позиции

### Требования

- `MTR_AGENT_ORCHESTRATOR_ENABLED=true`;
- действующая server-side session;
- активный проект;
- permissions `agent.chat`, `analysis.read`, `specification.read`, `catalog.read`, `stock.search`;
- позиция должна принадлежать доступному аналитическому контуру.

### HTTP-запрос

```bash
curl --fail-with-body -sS -b "$MTR_COOKIE_JAR" \
  -X POST "$MTR_BASE_URL/api/agent/commands/ANALYSIS" \
  -H 'content-type: application/json' \
  --data '{
    "context": {
      "projectId": "demo-project-001",
      "positionId": "position-portfolio-072-003"
    },
    "filters": {
      "horizonWeeks": 8,
      "demandMultiplier": 1.1,
      "deliveryDelayDays": 7
    }
  }'
```

| Поле | Тип | Ограничение / default |
|---|---|---|
| `context.projectId` | string | Должен совпасть с активным разрешённым проектом |
| `context.positionId` | string | Предпочтительный источник позиции; при наличии имеет приоритет над `filters.positionId` |
| `filters.positionId` | string | Резервный способ передать позицию, если её нет в `context` |
| `filters.horizonWeeks` | integer | `1..26`, default `8` |
| `filters.demandMultiplier` | number | `0.5..3`, default `1` |
| `filters.deliveryDelayDays` | integer | `0..180`, default `0` |

Identity, roles, permissions, authorization version, source scopes и warehouse scopes не принимаются из body. Их передаёт session boundary через `TrustedRequestContext`.

### Ответ

Route возвращает:

```json
{
  "result": {
    "schemaVersion": "mtr-agent-command-public-v1",
    "responseLabel": "Анализ позиции",
    "statusLabel": "Требуются уточнения",
    "answer": "Остаточный дефицит ...",
    "confidence": 0.9,
    "requiresHumanReview": true,
    "sources": [],
    "analysis": {
      "executiveSummary": "...",
      "facts": [],
      "findings": [],
      "drivers": [],
      "forecast": null,
      "scenarios": [],
      "recommendation": "Передать вариант специалисту для проверки и решения.",
      "limitations": [],
      "nextActions": []
    }
  }
}
```

Публичная проекция не включает `technicalTrace`, internal evidence node IDs, tool calls, chain-of-thought, raw JSON и закрытые filters. Source card пропускает только allowlisted поля и безопасную внутреннюю ссылку. Для каждого завершённого `ANALYSIS` bounded plan сохраняет отдельный case snapshot и четыре scoped evidence facts; при чтении права на Appius/SAP/catalog/normative проверяются заново.

## Ошибки

| HTTP | Код | Причина |
|---:|---|---|
| 400 | `AGENT_POSITION_CONTEXT_REQUIRED` | Не передан `positionId` |
| 400 | `VALIDATION_ERROR` | Body нарушает строгую schema или диапазон filters |
| 403 | `AGENT_PERMISSION_DENIED` / `AGENT_COMMAND_FORBIDDEN` | Недостаточно permissions или scope |
| 403 | context error | Запрошен недоступный проект или ресурс |
| 404 | `MTR_AGENT_ORCHESTRATOR_DISABLED` | Orchestrator feature flag выключен |
| 404 | `AGENT_COMMAND_NOT_REGISTERED` | Analytical capability не подключена |
| 409 | `AGENT_SELECTION_STALE` | Выбранный контекст устарел |
| 503 | `MTR_AGENT_KILL_SWITCH_ACTIVE` | Новое выполнение остановлено kill switch |

Намеренно неполная позиция не всегда является HTTP-ошибкой. Она возвращает безопасный abstention: confidence `0`, пустые forecast/scenarios/citations и инструкцию восстановить mapping.

## Ограничения текущей итерации

- Dataset является детерминированным synthetic model port, а не live SAP/Appius retrieval.
- Rich public projection сохраняется в существующем `agent_messages.structured_output` и повторно проходит fail-closed projection при чтении; новая migration для истории сообщений не требуется.
- Owner-only feedback сохраняется отдельной additive migration `0007_mtr_agent_learning` как quarantined candidate с prompt/model/rule/evidence provenance. Он не влияет на runtime автоматически; approval/promotion/revoke требуют human permissions, regression case, validation checksum и audit.
- Analytical history переиспользует durable cases/evidence/plans из `0006`: хранит dataset/semantic/forecast versions, вывод, рекомендацию и source snapshots, связывает предыдущий расчёт той же позиции и отмечает изменение вывода. Internal conclusion fingerprint остаётся только в persistence.
- Сохранённые source citations повторно авторизуются; отозванный источник скрывается и увеличивает `revokedEvidenceCount`.
- Eval gate из мастер-промпта не закрыт: выполнены 34 legacy, 50 current-runtime analytical, 17 learning lifecycle и 20 provider-boundary cases (`121/200`). Analytical pack содержит 20 отдельных root-cause/rolling-backtest/scenario-ranking oracle и 20 held-out cases; остаются adversarial/security, multi-turn и scale квоты.
- Ни один сценарий не выполняет SAP/Appius write и не принимает экспертное решение.

## Связанные документы

- [Справочник HTTP API](api-reference.md#анализ-позиции-analysis)
- [Трассируемость МТР-агента](mtr-agent-orchestrator-traceability.md)
- [Поведение МТР-аналитика](agent-behavior.md)
- [Coverage baseline](mtr-agent-data-coverage.md)
- [Scope текущей итерации](agent-intelligence-scope.md)
