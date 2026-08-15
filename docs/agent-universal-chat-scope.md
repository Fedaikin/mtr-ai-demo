# Scope: универсальный МТР-агент и единый чат

Статус: `G0_BASELINE_LOCKED`

Дата фиксации: 2026-08-13 (Europe/Moscow).

## Git baseline

- Рабочий каталог: `/Users/valerijmockalenko/Documents/BeSmart-mtr-agent-universal-chat`.
- Ветка: `codex/mtr-agent-universal-chat`.
- Base и исходный HEAD: `96436a9320a29f6f778007a36e587df6f2154114`.
- Источник: чистый финальный HEAD ветки `codex/mtr-agent-analytical-intelligence`.
- Merge base с предыдущим этапом: тот же exact SHA.
- Remote и upstream в локальном репозитории не настроены; push, draft PR и Preview пока являются внешними release-блокерами.
- Production, Production alias и Production database не входят в scope.

## Зафиксированный baseline

| Контур | Исходное значение |
| --- | ---: |
| Предустановленные субъекты | 8 |
| Спецификации Appius | 83 current |
| Версии спецификаций | 88 |
| Текущие позиции Appius | 3 584 |
| Позиции промышленного каталога | 4 800 |
| Семейства взаимозаменяемости | 960 |
| Балансы промышленного каталога | 7 200 |
| BOM-связи | 2 880 |
| Материалы / балансы исходного SAP-контура | 30 / 30 |
| Сертифицированная аналитическая когорта | 12 спецификаций / 240 позиций |
| Уникальные agent eval | 200 |
| Уникальные business E2E-сценарии | 40 |
| Последняя migration | `0007_mtr_agent_learning.sql` |

Baseline eval повторно выполнен в новом worktree: `34 + 50 + 17 + 20 + 32 + 20 + 27 = 200/200 PASS`. Предыдущий этап также передал полный локальный gate: 526 Vitest, desktop/mobile Playwright и `pnpm check` — PASS на exact base SHA.

## Версии и модельная реальность

- Новый dataset: планируется `universal-chat-v1`; он расширяет, но не переписывает предыдущие fixtures.
- Аналитический dataset: `g1-vertical-v1`, schema `1.0.0`, dataset `1.0.0-DEMO`.
- Источники аналитической когорты: Appius `appius-portfolio-v1`, catalog `1.0.0-DEMO`, SAP `sap-g1-vertical-v1`, normative `normative-g1-vertical-v1`, process `process-g1-vertical-v1`.
- Текущий system prompt: `mtr-project-agent` version `3.0.0`; rollback version `1.0.0`.
- Текущий deterministic provider boundary: `OFFLINE_DETERMINISTIC / mtr-grounded-demo / 1.0.0`.
- Provider eval: `provider-conformance-1.0.0`.
- `OPENAI_API_KEY` в локальном окружении отсутствует. Официальный OpenAI Responses provider, model benchmark и live Preview gate нельзя объявлять закрытыми без серверного секрета и фактического evidence.
- Все данные прототипа остаются синтетическими и versioned. В публичном ответе агент описывает источник и ограничения предметно, без постоянного технического ярлыка `mock`.

## Разрешённые изменения

- `docs/**`, кроме изменения смысла immutable acceptance evidence предыдущих этапов.
- Новые versioned fixtures, manifests, evals и безопасные seed/bootstrap extensions для `universal-chat-v1`.
- `src/domain/agent/**`, `src/application/agent-orchestrator/**`, `src/ports/**` — typed contracts, ScenarioClock, capability registry, planner, verifier, entity resolution и четыре независимых показателя.
- Scoped adapters в `src/adapters/**` для чтения/записи только через канонический trusted context.
- `src/app/api/agent/**` и agent-specific UI/components для единого чата, attachments, preview/confirmation и безопасной публичной проекции.
- Тесты, eval manifests/runners, scripts и локальная документация, необходимые для gates G0–G6.
- Additive schema migration только после regression-first контракта и только с номером `0008` или следующим свободным номером, если baseline изменится до её создания.
- Официальная серверная OpenAI SDK/Responses integration с secrets только в server environment и с deterministic failover.

## Запрещённые контуры

- Количество предустановленных пользователей/субъектов, их логины, пароли, имена и demo-персоны.
- Смысл существующих permission keys, role bundles, hierarchy и SoD-правил; скрытые роли или права.
- Обход canonical session/RBAC, доверие к identity/permissions/scopes из текста, body, файла или LLM output.
- Generic SQL, shell, unrestricted repository tool и прямые записи LLM в БД.
- Ослабление last-admin/last-manager, self-block/self-escalation, session-revoke или confirmation protections.
- Изменение migration `0000`–`0007`, их snapshots или исторического SQL.
- Реальные закрытые контакты/реквизиты, secrets, cookies, пароли, токены и лишние персональные поля во внешнем provider, логах или клиенте.
- Production deploy/promotion, Production alias/database и merge в `main` без отдельного решения владельца.
- Ослабление тестов, oracle, verifier, thresholds или failure paths ради зелёного gate.

## Планируемая migration

- Зарезервирован следующий additive слот: `0008_universal_chat`.
- Предварительный состав: `business_projects`, project/spec/position operational links, specification intake lifecycle, project deadlines/allocations/reservations/inbound/reliability facts, chat attachments и typed action metadata, если существующие `0006`/`0007` таблицы не покрывают контракт.
- До генерации migration будет зафиксирован schema regression. `0008` не должна изменять либо удалять существующие строки и не должна запускать reset.
- Migration применится только в изолированной/Preview базе отдельным контролируемым шагом. Production migration запрещена.

## File ownership

- Ведущий и единственный исполнитель текущего этапа: `/root`.
- Подагенты не используются.
- Ведущий единолично владеет shared schema, action contracts, capability registry, provider integration и финальным acceptance.
- Чужие worktrees и dirty-файлы в `/Users/valerijmockalenko/Documents/BeSmart` не читаются как рабочий diff и не изменяются.

## Rollback

1. Новые runtime-contours включаются отдельными server feature flags; безопасное исходное состояние — выключено, deterministic previous-stage runtime остаётся доступен.
2. Provider failure/timeout/schema error не приводит к выдуманному ответу: typed deterministic path возвращает подтверждённую часть, ограничения и human-review requirement.
3. До Preview каждый gate фиксируется отдельным commit; rollback к `96436a9` не требует изменения пользователей, RBAC bundles или migrations `0000`–`0007`.
4. После применения additive `0008` rollback приложения выполняется feature flags/revert commit. Удаление новых таблиц — только отдельная согласованная DB-операция; автоматического destructive down/reset нет.
5. Typed action подтверждение привязано к subject/project/authorizationVersion/payload hash/TTL/idempotency key; смена контекста инвалидирует proposal.

## Gate order

Работа идёт строго `G0 → G1 → G2 → G3 → G4 → G5 → G6`. Следующий gate не объявляется закрытым, пока regression-first тесты текущего gate не проходят. Live LLM и Preview evidence отмечаются внешним blocker, если серверный OpenAI secret, Git remote или Vercel linkage не предоставлены.
