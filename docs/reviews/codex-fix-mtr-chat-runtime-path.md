# Review: `codex/fix-mtr-chat-runtime-path`

Заполненная копия канонического [review checklist](../development/review-checklist.md).

## 1. Паспорт ветки

- Назначение: восстановить единый universal chat path и доказательный project/source-scoped МТР-анализ без изменения Production, ролей или реквизитов.
- База: `main` / `1855e78f8b6206586fd417cffa27583e78c6a4f4`.
- Интеграционный HEAD до текущей локальной корректировки: `b5d128f1d4e412d2d41a34d0ecb6374032318777`.
- Проверенный product SHA: `f6c2a71996712da175f3b473e72bd16da64387d1`.
- Pull Request: [#4](https://github.com/Fedaikin/mtr-ai-demo/pull/4), draft.
- Branch Preview: `https://mtr-ai-demo-git-codex-fix-mtr-ch-a27402-fedaikin-7533s-projects.vercel.app`; exact deployment metadata ведётся в draft PR.
- Дата проверки: 2026-08-14.
- Проверяющие: OpenAI Codex; независимый read-only reviewer.

## 2. Scope и traceability

- [x] Цель сформулирована одним проверяемым результатом: literal chat → единый runtime; analysis → полный trusted corpus.
- [x] Корректирующий промпт, `AGENTS.md`, RBAC и universal-chat документы прочитаны.
- [x] Frozen test-plan не используется как изменяемый журнал; исходный SHA-256 восстановлен.
- [x] Generated Playwright/Next/TypeScript artifacts исключены из product diff.
- [x] Production, пользователи, роли, assignments и пароли не изменялись.
- [x] Попутный refactor ограничен repository/application seams, необходимыми для project/source authorization.

Evidence: [acceptance report](../acceptance/mtr-chat-runtime-remediation.md), exact TC tests в `tests/e2e/mtr-chat-runtime-remediation.spec.ts` и `tests/integration/responsibility-trusted-scope.regression.test.ts`.

## 3. Git и интеграция

- [x] Ветка основана на согласованном `main`; PR bot merge зафиксирован как `b5d128f1…`.
- [x] История не переписывалась и force-push не применялся.
- [x] Diff проверен против merge base; conflict resolution сделан по domain/trust-boundary смыслу.
- [x] Заполненный review-файл входит в кандидат.
- [x] Product SHA зафиксирован после независимого review и полного gate.

## 4. Архитектура и runtime

- [x] Сохранена граница `route → orchestrator/application → ports → adapters`.
- [x] CHAT проходит через один `MtrAgentOrchestrator`; поддерживаемый stock intent больше не перехватывается legacy path.
- [x] Serverless memory не является источником project/source authorization.
- [x] Runner сохраняет trusted scope snapshot и повторно проверяет auth version/membership.
- [x] Dependency/authorization errors дают безопасный отказ, не generic 500 с leakage.

## 5. RBAC и авторизация

- [x] Identity, permission, project и source scopes берутся только из canonical `TrustedRequestContext`.
- [x] `analysis.create` и active project membership проверяются до retrieval.
- [x] Specification/position/SAP/normative filters применяются до чтения.
- [x] Manager и analyst читают общие project fixtures, но run остаётся owned инициатором.
- [x] Viewer и service account не запускают анализ; viewer не читает складские количества.
- [x] Route-level denial одинаково безопасен и не сохраняет закрытый material/warehouse fact.
- [x] Stale authorization version блокирует дальнейший runner transition.

Evidence: `responsibility-trusted-scope.regression.test.ts`, `mtr-chat-http-route-remediation.regression.test.ts`.

## 6. Данные, reset и миграции

- [x] Schema/migration в текущем corrective diff не менялись.
- [x] Reset demo-проекта сначала удаляет runtime children/runs, затем восстанавливает shared fixtures.
- [x] Reset сохраняет все существующие password hashes byte-for-byte.
- [x] Старый публичный demo-пароль отвергается auth boundary.
- [x] Reset regression после analyst-owned run возвращает 8 пользователей, 83 спецификации и 0 runs.
- [x] Локальные DB dumps и upload artifacts в Git отсутствуют.

## 7. МТР-процесс и предметная логика

- [x] Используется текущая версия project specification.
- [x] Responsibility создаётся только из нормативного правила с document/version/clause.
- [x] No-rule остаётся `INSUFFICIENT_DATA`, а не подставным CONTRACTOR.
- [x] Полный active corpus хранится в run snapshot и manifest.
- [x] Manifest содержит corpus count, covered equipment types и полный SHA-256 checksum.
- [x] Независимый DB-oracle проверяет каждую из 24 report positions.
- [x] Latest terminal run выбирается детерминированно и отображается exact run ID.

## 8. AI-agent trust boundary

- [x] Runtime получает canonical trusted context.
- [x] Universal capabilities закрыты и permission-aware.
- [x] LLM/HTTP не задают доверенные project/source IDs.
- [x] Unknown warehouse приводит к ограниченному clarification, не к выдуманному alias/stock.
- [x] Public route не выдаёт raw tool/provider payload или internal error.
- [x] Сохранённые facts/citations отсутствуют при отказе до retrieval.

## 9. UI и пользовательские сценарии

- [x] Exact TC-CHAT-01…04 проверены на desktop через реальный HTTP/UI flow.
- [x] Составной status-запрос показывает независимые ACTIVE/PLANNED/ALL таблицы.
- [x] `/mtr-analysis` показывает run ID, corpus count, dataset version и checksum.
- [x] Public UI не показывает пароли, hashes или технический raw payload.
- [ ] Exact-SHA Preview browser run недоступен из-за Vercel Deployment Protection.

## 10. Privacy, security и аудит

- [x] Privacy scan: 549 candidate files PASS.
- [x] No secret/token/hash/plaintext credential добавлен в diff.
- [x] Horizontal project/source denial проверен manager/analyst/viewer/service matrix.
- [x] Forbidden route не раскрывает material code, warehouse ID или quantity в persisted output.
- [x] Production credentials/data не использовались.

## 11. Тесты

- [x] Regression-first tests покрывают literal routing, project/source scope, manifest completeness, reset/password preservation и deterministic latest run.
- [x] Unit/integration full suite: 156 files / 629 tests PASS.
- [x] Runtime eval: 358/358 PASS.
- [x] Corrective E2E desktop: 6/6 PASS.
- [x] Scenario query-cap regression: PASS без ослабления `drain <= 55`, `total <= 60`.
- [x] Production build: PASS; PDF runtime assets 2/2.

```text
pnpm check: PASS
pnpm playwright test tests/e2e/mtr-chat-runtime-remediation.spec.ts --project=chromium-desktop: 6/6 PASS
```

## 12. Производительность и Vercel

- [x] Локальный production build выполнен.
- [x] Repository query caps не повышены.
- [x] Production deployment/alias/migration не выполнялись.
- [x] Vercel Preview check для post-fix PR HEAD завершён `READY`.
- [ ] Readiness/login/browser smoke на Preview заблокирован Deployment Protection.

Внешний blocker: владелец Vercel должен выдать безопасный Preview bypass или снять protection только для branch Preview. Production для этого не требуется.

## 13. Документация и итог

- [x] Acceptance report обновлён по фактическому коду и gates.
- [x] README eval counts синхронизированы: universal 158, total 358.
- [x] Ограничение exact-SHA Preview указано честно.
- [x] Rollback не требует data rollback: выключить `MTR_AGENT_UNIVERSAL_CHAT_ENABLED` и вернуть предыдущий application commit.
- [x] Independent reviewer verdict: `PASS LOCAL`, подтверждённых P0/P1/P2 не осталось.

### Итоговое решение

- [x] ГОТОВО К REVIEW
- [x] НЕ ГОТОВО К MERGE
- [x] ЗАБЛОКИРОВАНО ВНЕШНЕЙ ЗАВИСИМОСТЬЮ — только browser acceptance Preview.

Причина: локальные обязательные gates зелёные, но release нельзя объявить завершённым до независимого PASS и browser evidence exact post-fix Preview SHA.

Следующее действие: push, дождаться exact-SHA Preview и выполнить protected browser smoke с manager/analyst/viewer/service matrix.
