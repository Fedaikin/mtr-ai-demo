# Scope: аналитический интеллект МТР-агента

Версия: `1.0`

Дата фиксации: `2026-08-13`
Статус: Gate G0 завершён с измеренным `FAIL`; разрешён bounded G1 remediation

## Git baseline

- Git root: `/Users/valerijmockalenko/Documents/BeSmart-mtr-agent-analytical-intelligence`.
- Ветка: `codex/mtr-agent-analytical-intelligence`.
- Baseline SHA: `70543c6c34d6778695a07a5400006742ed5e3a21`.
- Merge base с завершённым этапом оркестратора: `70543c6c34d6778695a07a5400006742ed5e3a21`.
- Remote в локальной копии не настроен; fetch, push, draft PR и Preview до появления доверенного remote/credentials считаются release-boundary, а не основанием менять Production.
- Исходный worktree `codex/feat-mtr-agent-orchestrator` содержит локальные generated-файлы и не используется для разработки этой итерации.

## Разрешённая область

- `src/application/agent-orchestrator/**` — semantic query, planning, verifier, analytical capabilities.
- `src/domain/agent/**` — versioned semantic/evidence/forecast/scenario/recommendation contracts.
- `src/ports/agent-orchestrator.ts` и новые узкие agent analytics ports.
- Новые agent-specific persistence adapters и additive migration `0007_mtr_agent_learning` только для owner feedback/curated learning history; существующие migrations остаются immutable.
- Versioned scenario dataset, generators и fixtures, не меняющие users/RBAC/auth.
- Agent widget и `/mtr-analysis` только для аналитического ответа, прогресса, scenario comparison, feedback и history.
- `evals/**`, evaluator, agent tests/E2E, acceptance, observability и документация.

## Запрещённая область

- `users`, demo-персоны, логины, пароли, количество интерактивных аккаунтов.
- Roles, permissions, hierarchy, assignments, RBAC seed и canonical authorization contracts.
- Login/session UX, auth bootstrap и существующие migrations `0000`–`0006`.
- Production, aliases, Production migrations, secrets, environment и реальные корпоративные данные.
- SAP/Appius write, экспертное решение из чата, fine-tuning и автоматическое online learning.
- Общая навигация и соседние продуктовые экраны вне agent analytics.
- Ослабление тестов, порогов, expected results и санкционированного портфеля спецификаций.

## Baseline data и версии

| Контур | Baseline |
|---|---:|
| Пользователи | 8, неизменяемый инвариант |
| Appius specifications | 83 |
| Appius current positions | 3 584 |
| Эталонный analysis scope | 3 specifications / 24 positions |
| Industrial catalogue | 4 800 items / 960 families / 7 200 balances / 2 880 BOM links |
| SAP | 30 materials / 30 balances |
| Process/scenario templates | 5 |
| Prompt | active `mtr-project-agent` `3.0.0`; rollback `1.0.0` |
| Existing agent eval | 34 golden cases |
| Migrations | `0000`–`0006` immutable; новая additive `0007_mtr_agent_learning` |

Точное покрытие и denominators зафиксированы в
[`mtr-agent-data-coverage.md`](./mtr-agent-data-coverage.md). Главный разрыв:
полная цепочка Appius → catalog → SAP равна `0/3 584`, поэтому общий корпус нельзя
объявлять сквозным аналитическим dataset.

## Активный scenario dataset

- Baseline: `BASE`, Appius portfolio `appius-portfolio-v1`, industrial catalogue `industrial-catalogue-demo-v1`, текущие SAP/normative/scenario fixtures.
- Эталонные сценарии используют явный scope исходных трёх спецификаций и 24 позиций.
- Analytical dataset `g1-vertical-v1` создан отдельно от browse-корпуса: schema `1.0.0`, dataset version `1.0.0-DEMO`, deterministic seed/checksum, 12 specifications / 240 positions, 228 сквозных position → catalog → SAP mappings, 52 недели движений, 48 shortage cases и 24 future outcome oracles.
- Semantic registry `semantic-registry-1.0.0`, quality gate, evidence graph, forecast/backtest, root-cause, scenario, verifier и public `ANALYSIS` projection реализованы в feature branch.
- Feedback lifecycle создаёт owner-only quarantined candidate и требует human approval, applicability, regression case, validation checksum, audit и rollback; automatic online learning отсутствует.
- Scenario data являются авторитетными внутри замкнутого прототипа, но не должны менять пользователей/RBAC/auth или выдаваться за данные реального предприятия вне прототипа.

Формулы и публичный контракт: [`mtr-analytics-semantic-layer.md`](./mtr-analytics-semantic-layer.md).

## Flags и provider

- `MTR_AGENT_ORCHESTRATOR_ENABLED`, `MTR_AGENT_ACTIONS_ENABLED`, `MTR_AGENT_EVENTS_ENABLED` — fail-closed: включены только значением `true`.
- `MTR_AGENT_KILL_SWITCH=true` запрещает execution.
- Provider mode baseline: server-side deterministic `MockLLMProvider`; внешний платный provider не подключается без отдельного разрешения.
- Новый prompt активируется только после сквозной реализации обещанных capabilities; rollback остаётся доступен.

## Ownership и параллельная работа

- Ведущий агент владеет branch, shared contracts, schema/migration, integration и финальный diff.
- До стабилизации semantic contracts разрешены только read-only baseline/coverage аудиты.
- Каждый подагент, если используется, получает один bounded deliverable, file allowlist и запрет менять shared contracts, users/RBAC/auth, migrations и соседние tests.
- Результаты подагентов не расширяют scope и принимаются только после review ведущим агентом.

## Rollback

- Кодовый rollback: отключить analytical capability/flag и вернуть runtime к prompt `3.0.0` без удаления historical evidence.
- Data rollback: новая additive migration не изменяет и не удаляет существующие таблицы; dataset version деактивируется, а не перезаписывается.
- Release rollback: feature branch/Preview можно удалить без изменения Production; merge в `main` запрещён до строгой приёмки владельцем.

## Gate G0 checklist

- [x] Отдельный clean worktree создан от exact baseline SHA.
- [x] Users/RBAC/auth/Production исключены из scope.
- [x] Provider mode и migration boundary зафиксированы.
- [x] Все обязательные документы и runtime boundaries прочитаны.
- [x] Baseline tests/eval/build/privacy запущены в этом clean worktree.
- [x] Coverage matrix и baseline latency измерены.
- [x] Branch review checklist обновлён фактическими evidence.

Gate G0 result: baseline технически зелёный; исходная analytical completeness `FAIL`.
G1 foundation и детерминированный G2/G3 vertical реализованы локально. Durable
analytical history/evidence и curated feedback lifecycle также работают. Следующие
обязательные шаги: outcome/backtesting learning, расширение production-shaped eval corpus,
расширенный E2E и строгая Preview-приёмка. Пользователи, RBAC/auth и Production не меняются.
