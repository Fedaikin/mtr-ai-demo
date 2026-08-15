# Покрытие данных и eval МТР-агента

Дата среза: `2026-08-13`

Baseline SHA: `70543c6c34d6778695a07a5400006742ed5e3a21`

Статус Gate G0: `FAIL — ожидаемо, переход к bounded G1 remediation`

Gate G0 не является выпускной приёмкой. Его цель — до разработки измерить, какие
аналитические выводы действительно поддержаны связанными данными, а какие пока
нельзя честно показывать пользователю.

## Результат baseline gate

В clean worktree прошли:

- lint и TypeScript;
- `113` test files / `476` tests;
- privacy scan по `411` файлам;
- legacy agent eval `34/34`;
- production build и проверка PDF runtime assets.

Это подтверждает технически зелёную базу. Аналитическая готовность не подтверждена:
полная цепочка Appius → каталог → SAP сейчас не имеет ни одной связанной позиции.

## Матрица покрытия

| Проверяемая связь | Числитель / знаменатель | Покрытие | Вывод |
|---|---:|---:|---|
| Текущие Appius-позиции | 3 584 / 3 584 | 100% | Базовый объектный объём |
| Portfolio Appius → каталог | 3 560 / 3 560 | 100% | Отдельная catalog-ветвь |
| Все Appius → каталог | 3 560 / 3 584 | 99,33% | Golden 24 не связаны с catalog codes |
| Golden Appius → SAP | 24 / 24 | 100% | Отдельная SAP-ветвь |
| Все Appius → SAP | 24 / 3 584 | 0,67% | Недостаточно для портфельной аналитики |
| Portfolio Appius → SAP | 0 / 3 560 | 0% | Сквозной SAP-анализ невозможен |
| SAP material → catalog item | 0 / 30 | 0% | Ветки не пересекаются |
| Appius → catalog → SAP | 0 / 3 584 | 0% | Блокирующий разрыв G1 |
| Position → movement history | 24 / 3 584 | 0,67% | Portfolio history отсутствует |
| Position → reservation/inbound | 0 / 3 584 | 0% | Нельзя считать projected availability |
| Responsibility rule | 1 112 / 3 584 | 31,03% | Остальное требует `UNKNOWN`/review |
| Фактически применимый analogue | 4 / 3 584 | 0,11% | Только golden; portfolio 0 |
| Portfolio components in BOM | 2 670 / 3 560 | 75% | Но Appius assembly positions = 0 |
| Appius assembly → BOM explosion | 0 / 3 584 | 0% | Сборочный анализ не доказан |

## Фактические временные данные

- `360` движений: `30` SAP-материалов × `12` недель;
- период движений — `77` дней, тип только `CONSUMPTION`;
- `36` агрегированных process events за те же `12` недель;
- reservations, inbound supplies и lead time отсутствуют;
- process events не содержат `specificationId`, `runId` или `taskId`;
- task store пуст, хотя aggregate fixture содержит `30` назначений эксперту.

Следовательно, текущая история пригодна только для ограниченной демонстрации
простого среднего. Она не является основанием для I3 forecast, rolling backtest,
causal claims или производственной рекомендации.

## Eval inventory

| Gate | Фактически | Требование | Разрыв |
|---|---:|---:|---:|
| Все agent eval | 34 legacy | 200 | +166 |
| Current-orchestrator runtime eval | 0 strict | 140 | +140 |
| Analytical I2–I4 | 0 | 50 | +50 |
| Adversarial/security classified | 0 | 50 | +50 |
| Temporal/backtesting | 0 | 30 | +30 |
| Backtested forecast | 0 | 20 | +20 |
| Root-cause oracle | 0 | 20 | +20 |
| Scenario/ranking oracle | 0 | 20 | +20 |
| Scale eval | 0 | 20 | +20 |
| Distinct E2E test bodies | 25 | 40 | +15 raw |
| Покрытые analytical E2E scenarios | 5 | 40 | +35 content |

Существующие `34` кейса выполняют legacy `AgentService`, а не текущий
`MtrAgentOrchestrator`; общие `476` Vitest-тестов не засчитываются как eval corpus.
Desktop/mobile Playwright projects также не считаются разными бизнес-сценариями.

## Подтверждённые runtime gaps

1. Legacy CHAT теряет полный `TrustedRequestContext` внутри capability.
2. Public command projection не показывает typed items, metrics, risks и missing data.
3. Command case не сохраняет полный evidence/result chain.
4. Citation reauthorization не единообразна для SAP composite IDs и сохранённых facts.
5. Forecast использует только среднее: нет model selection, interval и backtest.
6. Historical stock coverage использует current stock snapshot (temporal leakage).
7. Нет versioned semantic registry, data-quality analyzer, evidence graph,
   hypothesis lifecycle, scenario ranker и recommendation verifier.
8. Global summary ограничен первыми `200` позициями без честного partial marker.

## Сертифицированная вертикаль G1

Чтобы не выдавать весь демонстрационный корпус за аналитически полный, G1 создаёт
отдельную versioned когорту `g1-vertical-v1`:

- `240` текущих позиций максимум из `12` спецификаций: `24` сборки и `216` компонентов;
- `228/240` (95%) явных position → catalog mappings и `12` намеренных negative/review;
- `228/228` catalog → SAP crosswalk;
- минимум `13` недель движений `CONSUMPTION`, `RECEIPT`, `TRANSFER`, `ADJUSTMENT`;
- минимум `4` склада, числовые available/reserved/quarantined;
- inbound/PO и lead-time для каждого проектного дефицита;
- `24 × 6 = 144` валидных BOM-связи;
- не менее 95% нормативного покрытия ответственности;
- `48` контролируемых дефицитов: `36` positive analogue cases и `12` no-candidate;
- реальные связанные runs/events/tasks и минимум `20` causal/future-outcome oracles;
- manifest фиксирует dataset/schema/source versions, as-of cutoff, seed, checksum,
  expected counts, coverage denominators и intentional negatives.

Полный корпус из 83 спецификаций остаётся доступен для browse/scale тестов. Только
сертифицированная когорта может использоваться для заявлений о сквозном покрытии.

## Решение Gate G0

`FAIL` относится к аналитической полноте данных, а не к исправности baseline.
Разработка продолжается только через bounded G1 remediation. До его прохождения:

- числовой forecast и recommendation должны abstain либо явно маркироваться demo/partial;
- отсутствие результата нельзя интерпретировать как отсутствие риска;
- неизвестные responsibility/analogue/inbound/reservation значения не заменяются нулями;
- пользователи, RBAC/auth, существующие migrations и Production остаются неизменными.
