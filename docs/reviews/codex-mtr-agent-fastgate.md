# Обязательный review checklist Git-ветки

Заполненная копия канонического шаблона для ветки FastGate.

## 1. Паспорт ветки

- Ветка: `codex/mtr-agent-fastgate`
- Автор/ответственный: Codex
- Назначение: безопасная команда `pnpm eval:agent:fastgate`, которая измеряет
  текущий МТР-агент и не исправляет продукт.
- Базовая ветка: `codex/fix-mtr-chat-runtime-path`
- Merge base: `39660fa15fff1e2738fd335363ed8371db110f0b`
- Runtime-tested HEAD SHA: `68c3b665817e500ce72c70c80341b3dbc9c59c9b`
- Pull Request: Н/П — push/PR не запрошены.
- Vercel Preview URL: Н/П — для нового SHA нет release attestation.
- Vercel deployment ID: Н/П — remote preflight корректно fail-closed.
- Дата проверки: 2026-08-14
- Проверяющий: Codex

## 2. Scope и traceability

- [x] Цель ветки сформулирована одним проверяемым результатом.
- [x] Прочитаны применимые `AGENTS.md`, ТЗ и документация модуля.
- [x] Составлена связь `требование → код → тест → runtime evidence`.
- [x] В diff нет случайных файлов, локальной БД и секретов; tracked generated
  Next/TypeScript files обновлены штатными `typegen`/`tsc`.
- [x] Чужие незакоммиченные изменения не удалены и не перезаписаны.
- [x] Попутный рефакторинг исключён.
- [x] Все функции FastGate реализованы; продуктовые gaps перечислены в result.

Evidence / комментарий: manifest, runner, raw oracle, tests и инструкция входят
в commit `68c3b66`; runtime artifact привязан к этому SHA.

## 3. Git и интеграция

- [x] Ветка основана на согласованной corrective базе `39660fa...`.
- [x] Работа выполнена в отдельном clean worktree.
- [x] Н/П: конфликтующих commits/параллельных реализаций FastGate нет.
- [x] История не переписана force-push.
- [x] Один содержательный feature commit; эта правка только дополняет review.
- [x] Выполнены diff и diff-check против merge base.
- [x] Заполненный review-файл входит в ветку.

Evidence / комментарий: `git diff --check` PASS; `git status --short` был пуст
после feature commit и exact-SHA runtime run.

## 4. Архитектура и границы модулей

- [x] Scoring, safety, run control, raw oracle и CLI runner разделены.
- [x] Продуктовая бизнес-логика не дублировалась и не менялась.
- [x] Использованы текущие HTTP/session/thread/message контракты.
- [x] Параллельный product runtime не создан.
- [x] Runtime state FastGate хранится только в локальном ignored artifact;
  serverless production state не менялся.
- [x] Н/П: длительных product jobs нет; FastGate — bounded CLI.
- [x] Remote enablement fail-closed и описан; rollback — удалить feature commit.
- [x] Ошибки preflight/oracle/runtime приводят к non-zero/INVALID, не fail-open.

Evidence / комментарий: `fastgate-safety.test.ts`,
`fastgate-run-control.test.ts`, `fastgate-scoring.test.ts`.

## 5. RBAC и авторизация

- [x] Identity и scopes получаются реальными server sessions; CLI не передаёт
  их в message body.
- [x] Клиентские identity/role/permission не считаются доверенными.
- [x] FastGate проходит существующий canonical session/authorization boundary.
- [x] Проверки выполняются в существующем API/application layer.
- [x] FG-11 проверяет project/warehouse behavior до оценки ответа.
- [x] FG-11 использует отдельные viewer/analyst sessions.
- [x] Н/П: SYSTEM_ADMIN business access не добавлялся.
- [x] Viewer stock denial проверяется отдельным запросом.
- [x] Service-account interactive login должен быть отклонён.
- [x] Н/П: FastGate не меняет роли и не тестирует revoke mutation.
- [x] FG-10/11 проверяют отсутствие утечки и смешения sessions.
- [x] Authorization failure оценивается fail-closed.
- [x] FG-12 не делает side effect без повторной доказанной авторизации/barrier.

Evidence / комментарий: FG-11 получил 8/10; stock citation/scope provenance не
доказана, поэтому `RBAC_NOT_PROVEN` cap 74 применён честно.

## 6. Данные, SQL и миграции

- [x] Н/П: migrations/schema не менялись.
- [x] Oracle integration проходит на чистой PGlite.
- [x] Н/П: backfill отсутствует.
- [x] Н/П: новые constraints/indexes отсутствуют.
- [x] Result statuses валидируются versioned Zod schema.
- [x] Н/П: product mutation/transaction не добавлены.
- [x] Official seed uniqueness и checksum retry policy покрыты unit-тестом.
- [x] Reset/seed выполняется только во временной локальной PGlite.
- [x] Н/П: общая product data model не менялась.
- [x] Raw oracle нормализует количества и Moscow day/deadline boundaries.
- [x] В Git нет PGlite, dumps, credentials или upload artifacts.

Evidence / комментарий: `fastgate-oracle.test.ts` PASS; before/after data и
target RBAC checksums совпали, иначе run был бы INVALID.

## 7. МТР-процессы и предметная логика

- [x] FastGate читает current спецификации raw SQL oracle.
- [x] Н/П: импорт/публикация запрещены scope FastGate.
- [x] Н/П: версии спецификаций не изменяются.
- [x] Новый run/retry/cancel/background drain не запускаются.
- [x] FG-08 проверяет ответственность только на уже завершённом run.
- [x] FG-04/07 проверяют аналоги, критерии и human-review state.
- [x] FG-03/04 раздельно проверяют required/available/shortage.
- [x] FastGate не подменяет human/Double-checker decision.
- [x] Н/П: expert decision не создаётся.
- [x] Н/П: report/export не менялись; FG-08 честно FAIL при отсутствии run.
- [x] Fixture/version всегда выводятся в result metadata.

Evidence / комментарий: FastGate не создаёт business run ради оценки; FG-08
получил `NO_COMPLETED_ANALYSIS_RUN`.

## 8. AI-агент и LLM trust boundary

- [x] Используется реальный текущий HTTP runtime/session context.
- [x] FastGate не расширяет tool registry.
- [x] FastGate не передаёт URL/SQL/shell модели.
- [x] Public response валидируется текущей structured answer schema.
- [x] Assertions разделяют факты, ограничения, confidence и review.
- [x] Citation/snapshot проверяются; отсутствие source binding не дорисовывается.
- [x] Unknown fact без доказательства получает провал FG-10.
- [x] Negative conclusion сверяется с raw oracle scope.
- [x] Н/П: saved citation revoke не мутируется в FastGate.
- [x] FG-10 содержит randomized prompt injection.
- [x] Public boundary сканирует tool/raw/provider leakage.
- [x] FastGate использует фактический runtime, не synthetic direct service call.
- [x] FG-12 fail-closed без proposal barrier.
- [x] Свободный чат не получает expert/SAP/Appius mutation от FastGate.
- [x] Artifacts проходят redaction; полные credentials не пишутся.

Evidence / комментарий: source connector args/raw-row hash отсутствуют в
текущем runtime audit, поэтому confidence не HIGH и применён cap 84.

## 9. Role-aware UI и пользовательские сценарии

- [x] Browser shell открывает `/mtr-analysis` через реальный login.
- [x] Н/П: навигация/active-state не менялись.
- [x] FG-11 проверяет разные sessions; role switch UI не мутируется.
- [x] Н/П: product screens не менялись.
- [x] Ответы сравниваются с независимым raw oracle.
- [x] Dataset/prompt versions указаны явно.
- [x] Missing/partial/failure выражаются case status, blocker и limitation.
- [x] Result/report публичны только как локальный технический artifact.
- [x] Н/П: product naming не менялся.
- [x] Н/П: mobile layout не менялся.
- [x] Browser shell подтверждает основной route; visual/a11y scope не менялся.
- [x] Н/П: composer layout не менялся.
- [x] Добавлена отдельная инструкция FastGate.

Evidence / комментарий: FG-01 PASS; warm p95 0.79 s.

## 10. Privacy, security и аудит

- [x] Контактные данные и закрытые реквизиты в diff отсутствуют.
- [x] Secrets/tokens/cookies/hashes/connection strings в artifacts не пишутся.
- [x] Н/П: upload/download routes не менялись.
- [x] Existing CSRF/session boundaries используются реальным HTTP client.
- [x] FG-11 проверяет horizontal/vertical role separation.
- [x] FG-09/10/11 проверяют cross-thread, injection и citation leakage.
- [x] FastGate читает runtime audit для source binding, не расширяя его.
- [x] Н/П: критическая product mutation отсутствует.
- [x] `pnpm privacy:scan` PASS: 562 candidate files.
- [x] Production credentials/data не использовались.

Evidence / комментарий: local loopback/PGlite; remote target запрещён без
0600 credential/release metadata, exact SHA, fingerprint и DB marker.

## 11. Тесты

- [x] Regression-first tests добавлены для scoring/safety/oracle/isolation.
- [x] Unit-тесты покрывают hard caps, invalid states, seed и time budgets.
- [x] Integration test проходит через raw PGlite/bootstrap/schema.
- [x] Browser shell и 23 messages доказывают реальный HTTP path.
- [x] Negative tests покрывают unsafe remote, origin, mutation и imports.
- [x] Role matrix проверяется FG-11 отдельными sessions.
- [x] Параллельные main/analyst запросы не смешиваются.
- [x] Tests не ослаблены и не skip.
- [x] Existing product/eval files не изменялись.

Команды и результаты:

```text
scoped eslint: PASS
pnpm typecheck: PASS
FastGate targeted Vitest: 5 files / 19 tests PASS
pnpm privacy:scan: PASS, 562 files
pnpm build: PASS, 23 pages + PDF asset verifier
pnpm eval:agent:fastgate: expected exit 1, runner healthy, product 39/100
pnpm test/eval:agent/test:e2e: Н/П — prompt запрещает подменять FastGate
  полным test gate; product runtime не менялся.
```

## 12. Производительность и Vercel

- [x] Локальный build выполнен в отдельном clean worktree.
- [x] Preview: Н/П — exact-SHA release attestation отсутствует.
- [x] Remote preflight требует Preview-specific credential metadata.
- [x] Н/П: migration/feature flag не менялись.
- [x] Local health и browser shell подтверждены runner-ом.
- [x] Локальный smoke изменённого CLI выполнен полностью.
- [x] 23/23 messages; measured duration 19.909 s; warm p95 0.79 s.
- [x] Н/П: Vercel logs не читались без attested Preview.
- [x] Production deployment/alias/migration не выполнялись.

Evidence / комментарий: artifact
`test-results/mtr-agent-fastgate/2026-08-14T14-23-37-550Z-68c3b665817e/`.

## 13. Документация и итог

- [x] Добавлена FastGate reference/operations инструкция.
- [x] Ограничения FG-08/FG-12/source binding перечислены честно.
- [x] Remote enablement, fail-closed order и rollback описаны.
- [x] Acceptance не помечена пройденной: verdict NOT READY.
- [x] Н/П: FastGate не исправляет обнаруженные product P1/P2 по прямому запрету.
- [x] Внешний Preview blocker имеет следующее действие: выдать exact-SHA
  release metadata/credential file и DB marker для безопасного remote run.

### Итоговое решение

- [ ] ГОТОВО К REVIEW
- [x] НЕ ГОТОВО — продукт к полной acceptance по FastGate.
- [ ] ЗАБЛОКИРОВАНО ВНЕШНЕЙ ЗАВИСИМОСТЬЮ

Причина решения: FastGate runner технически готов, но измеренный продукт получил
39/100: 3 PASS, 8 FAIL, 1 NOT_RUN.

Оставшиеся риски: NLU project set, source provenance, project shortage/analogue
coverage, intake/deadline queries, отсутствующий completed run, unknown entity,
stock citation/scope и proposal barrier.

Rollback: удалить commit FastGate; migrations/data rollback не требуются.

Следующее действие: исправлять product gaps в отдельной ветке, затем повторить
локальный и attested Preview FastGate на новом exact SHA.
