# Traceability МТР-агента-оркестратора

## Статус реализации на ветке

| Группа | Статус | Runtime evidence |
|---|---|---|
| G-01…G-19 | `РЕАЛИЗОВАНО ЛОКАЛЬНО` | Единый runtime, canonical context, scoped ports, durable `0006`, commands/cases/evidence/plans/tasks/actions/events/metrics, public projection, citation reauth и persisted observability покрыты unit/integration/E2E regressions |
| G-20 | `ЧАСТИЧНО` | Legacy `34/34`, production-shaped analytical `50/50`, learning lifecycle `17/17`, provider-boundary `20/20`, security-boundary `32/32` и scale `20/20`: всего `173/200` |
| G-21 | `ЧАСТИЧНО` | Новый desktop/mobile workspace E2E зелёный; целевая матрица ≥27 orchestrator-сценариев не набрана |
| G-22 | `ЛОКАЛЬНО PASS / PREVIEW BLOCKED` | Эквивалент полного `pnpm check`: 127 файлов/517 тестов, privacy 454, eval 34/34 + 20/20 + 17/17, build/PDF assets PASS; push, PR и exact-SHA Preview невозможны без remote/upstream/Vercel credentials |

Production не изменён. Статусы ниже сохраняют исходную gap-карту и не переписывают baseline задним числом.

## 22 подтверждённых разрыва

| ID | Требование | Текущий код / доказательство | Нужное исправление | Первый regression gate |
|---:|---|---|---|---|
| G-01 | Один runtime для chat/commands/events | Chat вызывает legacy `AgentService`; commands/events отсутствуют | `MtrAgentOrchestrator` и общий capability registry | Chat и command с одинаковым selection дают одинаковый case/evidence |
| G-02 | Canonical RBAC | Route теряет context до `userId` | Передавать `TrustedRequestContext` без клиентских claims | Подмена identity/permission в body отклоняется |
| G-03 | Многоролевой scoped доступ | Donor legacy adapter рассчитан на одного demo-user | Только canonical resolver и role/project/source scopes | Viewer/analyst/expert/manager/admin матрица |
| G-04 | Реальные личные задачи | Donor `MY_TASKS` — заглушка; canonical имеет decisions, но не task lifecycle | Task adapter/store без второго decision model | Status/priority/owner/project filters end-to-end |
| G-05 | Weekly digest из runtime data | Donor digest не подключён к полным change/KPI/task данным | Versioned inputs и completeness | Текущие/предыдущие 7 дней, DST, partial source |
| G-06 | Полный risk set | Donor runtime читает первую SAP-позицию | Scoped risk port по полному набору | Levels/object/horizon/coverage реально меняют query |
| G-07 | Proactive event insights | Нет event subscriber/outbox/durable store | Idempotent event ingress и dedup insight store | Replay не создаёт второй insight |
| G-08 | Live L2 actions | Нет durable API/UI/atomic audit | Proposal/confirm/cancel/status + reauth + idempotency | Confirm/replay/revoke/audit failure matrix |
| G-09 | Durable cases/evidence | Cases строятся из runs на лету | `0006+` case/evidence/plan lifecycle | Restart/read/revoke/cross-project |
| G-10 | KPI из versioned events | Donor использует in-memory fixture | Persisted movements/process/technical/definition events | Source kind и snapshot независимы от definition version |
| G-11 | `RISKS.levels` и `STOCKS.warehouseIds` | Donor schemas принимают, handlers игнорируют | Применять до retrieval | Port spy и SQL scope |
| G-12 | Полные SUMMARY filters | Specification/position/period не доходят до query | Typed server selection и consistency check | Несогласованная spec-position пара отклоняется |
| G-13 | Domain/UI task enum parity | Donor Zod принимает `OPEN/WAITING/MEDIUM` вне domain | Одна каноническая enum-модель | Все domain values accept, лишние reject |
| G-14 | Честный empty stock | Empty даёт confidence 0, но review false | Coverage evidence либо unknown + review | Empty AVAILABLE/UNAVAILABLE truth table |
| G-15 | Честный no-risk | Incomplete scan выдаёт confidence 1 | `COMPLETE` coverage для доказанного negative result | Partial/unavailable запрещает «рисков нет» |
| G-16 | Типизированный KPI provenance | Всё маркируется `PROCESS_EVENT` | Material/process/technical/definition source kinds | Mixed source projection test |
| G-17 | Русский публичный UI | Raw response/status/source labels | Центральная локализация и safe fallback | DOM и E2E raw-token scan |
| G-18 | Sources drill-down + reauth | Citation GET сериализует сохранённые записи | Permission/resource recheck перед показом/переходом | Revoke и cross-project возвращают 404 |
| G-19 | Полный audit/observability | Command runtime не имеет durable trace; action audit не доказан live | Received/completed/failure traces, atomic critical action | Audit failure не коммитит action |
| G-20 | 200 runtime eval | Baseline 34/34, analytical 50/50, learning 17/17, provider 20/20, security 32/32, scale 20/20 | 200 production-shaped, включая analytical, temporal, adversarial, feedback и scale | Раздельные manifests и executed runtime cases |
| G-21 | 27 E2E | Текущий smoke не покрывает новый контур | Role/task/digest/risk/action/revoke/partial/concurrency E2E | ≥27 distinct scenarios |
| G-22 | Preview/performance/clean checkout | Для feature SHA нет push/Preview credentials | Clean worktree gate и exact-SHA Preview либо внешний blocker | p50/p95, concurrency и release manifest |

## Первые 12 regression-first исправлений

| ID | Дефект | Root cause | Исправление на границе |
|---:|---|---|---|
| D-01 | Task status/priority mismatch | Schema дублирует domain literals | Schema выводится из domain enum |
| D-02 | `warehouseIds` игнорируется | Поле обрывается в handler/query | Scope передаётся в port и SQL до чтения |
| D-03 | `levels` игнорируется | Risk handler не передаёт фильтр | Typed request → risk port |
| D-04 | SUMMARY ignores spec/position/period | Selection не входит в read model calls | Server-validated selection применяется в каждом query |
| D-05 | Empty stock не требует review | UI/result policy не учитывает evidence coverage | Confidence/review вычисляются из coverage |
| D-06 | Недоказанный no-risk confidence 1 | Пустота принята за полноту | Negative assertion требует `COMPLETE` |
| D-07 | KPI source всегда process | Citation mapper hardcoded | Discriminated source mapper |
| D-08 | Snapshot подменён definition version | Provenance поля слиты | `sourceSnapshot` и `definitionVersion` раздельны |
| D-09 | Raw English в UI | Public projection без центральной локализации | Localized DTO/renderer с safe fallback |
| D-10 | Нет live command/action audit | Registry/route обходят durable audit boundary | Correlated durable trace; critical action transaction |
| D-11 | Free chat без context propagation | Route передаёт только `userId` | Полный canonical context и revalidated selection |
| D-12 | Case lookup без project/resource reauth | User-only query и schema drift по `project_id` | Project-scoped query + resource/citation reauth + 404 |

## Product-surface integration

| Surface | Agent capability | Ограничение |
|---|---|---|
| `/mtr-analysis` | Контекст позиции/спецификации/run, evidence, handoff | Не дублировать экран отчёта |
| Global widget | Chat/command в контексте текущей страницы | Очистка при role switch |
| Import | Объяснение provenance и ошибок распознавания | Только разрешённая спецификация |
| «Даблчекер МТР» | Evidence package и создание expert task | Решение принимает человек, не агент |
| Overview/analytics | Read-only summary/KPI/risk links | Synthetic данные маркируются явно |
| `/pulse` | Proactive insight/event drill-down | Audit не используется как event store |
| `/help` | Разрешённые deep links и инструкции | Не источник бизнес-фактов |
| `/admin/scenarios` | Read-only status/deep link; разрешённые L2 proposals | Без скрытого run mutation |
