# Обязательный review checklist Git-ветки

Этот файл является каноническим шаблоном приёмки веток проекта
`Fedaikin/mtr-ai-demo`. Он применяется к изменениям приложения, данных,
AI-агента, RBAC, интерфейсов, инфраструктуры и документации.

## Как использовать

1. В начале работы создайте копию:

   ```bash
   mkdir -p docs/reviews
   cp docs/development/review-checklist.md docs/reviews/<branch-slug>.md
   ```

2. Заполните шапку и отмечайте пункты по мере выполнения.
3. Для неприменимого пункта поставьте `[x] Н/П` и кратко объясните почему.
4. Для каждого обязательного утверждения приложите evidence: test name,
   команду и результат, API response, screenshot, correlation ID, benchmark,
   Preview URL или ссылку на файл/строку.
5. Закоммитьте заполненный файл в рабочую ветку.
6. Добавьте ссылку на него в Pull Request.

Пустая отметка означает, что критерий не проверен. Наличие класса, кнопки,
TODO, описания или unit-теста изолированного helper не доказывает сквозной
пользовательский сценарий.

---

## 1. Паспорт ветки

- Ветка: `codex/salym-context-help`
- Автор/ответственный: Codex; заказчик изменения — владелец проекта.
- Назначение: только контекстные (i) на основном прототипе МТР Салым.
- Базовая ветка: origin/main.
- Merge base: `54a766607e50ba8922251a7c9a515c10a337c5ec`.
- Code HEAD SHA: `5f45094e235fe5f11d09f3b4a5e78c6ee2f936b2`; последующие изменения этого review не меняют код.
- Pull Request: https://github.com/Fedaikin/mtr-ai-demo/pull/14 (UI-only публикация по отдельной команде пользователя; ограничения ниже).
- Vercel Preview URL: https://mtr-ai-demo-7pjcgrf3y-fedaikin-7533s-projects.vercel.app
- Vercel deployment ID: Preview `dpl_4nxZraykAo1ZoSQY1ViqJvzJQVhT`, READY; production до публикации `dpl_Hf4aaj611fYJeZFbjkzEgMRszJYz`.
- Дата проверки: 2026-09-17.
- Проверяющий: Codex, локальная проверка.

## 2. Scope и traceability

- [x] Цель ветки сформулирована одним проверяемым результатом.
- [x] Прочитаны применимые `AGENTS.md`, ТЗ, ADR и документация модуля.
- [ ] Составлена связь `требование → код → тест → runtime evidence`. Частично: browser evidence ещё ожидается.
- [x] В коммит-diff нет случайных файлов, generated artifacts, локальной БД и секретов.
- [x] Чужие незакоммиченные изменения не удалены и не перезаписаны.
- [x] Попутный рефакторинг либо исключён, либо обоснован.
- [ ] Все заявленные функции реализованы; отсутствующие пункты перечислены явно. Частично: browser evidence ещё ожидается.

Evidence / комментарий:

Только InfoHint, словарь пояснений и включение кнопок у заголовков/навигации; никаких domain/application/API/schema/auth/seed/env изменений. Прочитаны AGENTS, Next server/client guide, компонент Dialog и страницы ТЗ 9–13. Независимый worktree от production main; PR13 намеренно не включён. Карта: контекстная справка ТЗ → InfoHint/context-help → unit + jsdom interaction → визуальная проверка ожидается.

## 3. Git и интеграция

- [x] Ветка основана на актуальной согласованной базе. См. evidence ниже.
- [x] Проверены новые commits и параллельные ветки, затрагивающие те же контракты. См. evidence ниже.
- [x] Конфликты разрешены по бизнес-смыслу, а не выбором одной стороны целиком. Н/П — конфликтов не было.
- [x] История не переписана force-push без отдельного разрешения. См. evidence ниже.
- [x] Commit-ы небольшие, содержательные и не смешивают несвязанные задачи. См. evidence ниже.
- [x] Перед сдачей выполнен diff против merge base. См. evidence ниже.
- [x] Заполненный review-файл входит в ветку. См. evidence ниже.

Evidence / комментарий:

База подтверждена git fetch origin main и Vercel success для 54a7666. Merge/rebase/force-push отсутствуют; чужая ветка PR13 не включена. После команды пользователя «публикуй (i)» выполнены обычный push feature-ветки и создание draft PR14. Generated tsconfig.tsbuildinfo и symlink node_modules исключены из stage. Vercel Preview и Preview Comments SUCCESS; GitHub Actions workflows в репозитории отсутствуют, результат Vercel не выдаётся за полный test-suite.

## 4. Архитектура и границы модулей

- [x] Соблюдена зависимость `web → application → domain` и `application → ports ← adapters`.
- [x] Бизнес-правила не продублированы в UI, route и prompt.
- [x] Новый функционал переиспользует канонические сервисы и контракты.
- [x] Отсутствуют параллельные реализации одного use case.
- [x] Н/П к изменению — Serverless state не хранится только в памяти или ephemeral filesystem. Бизнес/runtime слой не изменяется.
- [x] Н/П к изменению — Длительные операции используют persisted job/state. Бизнес/runtime слой не изменяется.
- [x] Н/П к изменению — Feature flags и rollback описаны и проверены. Бизнес/runtime слой не изменяется.
- [x] Ошибки dependency/runtime приводят к безопасному состоянию.

Evidence / комментарий:

PageHeader остаётся server-compatible, InfoHint — маленькая client boundary поверх существующего Dialog. Нет fetch, persistent state, бизнес-обработчиков или новых зависимостей. Неизвестный topic даёт null. Откат — revert только help-коммита; миграций/флагов нет.

## 5. RBAC и авторизация

- [x] Н/П для UI-only diff — Identity, роли, permissions, project/source/catalog/warehouse scopes получены только сервером. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Клиентские `user_id`, `project_id`, role, permission, scope и claims не считаются доверенными. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Используется canonical `TrustedRequestContext` и `AuthorizationService`. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Проверка permission выполняется в API/application layer, а не только скрытием кнопки. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Project/source/catalog/warehouse фильтры применяются до retrieval. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Личный объект проверяет owner; проектный объект проверяет project membership/scope. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Системный администратор без проектной роли не получает бизнес-данные. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Viewer не получает складские количества без `stock.search`. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Auditor и service account не получают интерактивные mutations. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Revoke/role switch инвалидирует прежнюю сессию и permission-aware cache. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Direct ID, count, autocomplete, export, citation и negative result не раскрывают закрытый объект. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Отказ авторизации fail-closed и имеет безопасный одинаковый внешний ответ. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Решения/действия повторно авторизуются непосредственно перед side effect. Без изменений; см. evidence раздела.

Evidence / комментарий:

Н/П к изменению: все guards, permission predicates, trusted context, API, queries и role switch оставлены без изменений. Словарь содержит общие описания, не данные пользователя. Полный регрессионный прогон выполняется отдельно; новых прав нет.

## 6. Данные, SQL и миграции

- [x] Н/П для UI-only diff — Миграция additive и имеет следующий свободный номер. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Проверена чистая база и обновление существующей базы. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Backfill детерминирован, повторяем и не повреждает runtime-данные. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Constraints/indexes соответствуют доменным инвариантам. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Enum/status/type обработаны во всех readers, writers, UI и localization mappings. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Mutation с несколькими связанными записями выполняется транзакционно. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Используется optimistic locking/idempotency там, где возможны повторы и гонки. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Reset/seed не затрагивает Production и не стирает несвязанные runtime-данные. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Общие данные проекта/каталога/источников не копируются по пользователям. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Единицы, количества, даты, timezone и границы периода проверены. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — В Git отсутствуют локальные каталоги БД, dumps и загруженные пользовательские файлы. Без изменений; см. evidence раздела.

Evidence / комментарий:

Н/П: SQL, схема, миграции, seed, базы, расчёты и данные не меняются. Тесты используют публичную локальную fixture и memory://, без credentials Production.

## 7. МТР-процессы и предметная логика

- [x] Н/П к изменению — Используется актуальная версия спецификации. Проверено по текстам; предметная логика без изменений. Бизнес/runtime слой не изменяется.
- [x] Н/П к изменению — Импорт валидирует строки, единицы, дубликаты и источник до публикации. Проверено по текстам; предметная логика без изменений. Бизнес/runtime слой не изменяется.
- [x] Н/П к изменению — Старая версия и её позиции сохраняются для аудита и сравнения. Проверено по текстам; предметная логика без изменений. Бизнес/runtime слой не изменяется.
- [x] Н/П к изменению — Запуск, retry, cancel и background drain имеют корректные переходы состояния. Проверено по текстам; предметная логика без изменений. Бизнес/runtime слой не изменяется.
- [x] Н/П к изменению — Ответственность формируется только нормативным правилом с документом/версией/пунктом. Проверено по текстам; предметная логика без изменений. Бизнес/runtime слой не изменяется.
- [x] Н/П к изменению — Аналоги имеют нормативное основание, сравнение отклонений и BOM-проверку. Проверено по текстам; предметная логика без изменений. Бизнес/runtime слой не изменяется.
- [x] Остаток, потребность, покрытие, movements и прогноз не смешиваются. Проверено по текстам; предметная логика без изменений.
- [x] Экспертный Даблчек не подменяет решение человека. Проверено по текстам; предметная логика без изменений.
- [x] Н/П к изменению — Экспертное решение требует причину и попадает в audit. Проверено по текстам; предметная логика без изменений. Бизнес/runtime слой не изменяется.
- [x] Н/П к изменению — Отчёт и экспорт сохраняют provenance и учитывают незавершённые проверки. Проверено по текстам; предметная логика без изменений. Бизнес/runtime слой не изменяется.
- [x] Показатели и рекомендации на overview/analytics получены из данных либо явно маркированы как synthetic fixture. Проверено по текстам; предметная логика без изменений.

Evidence / комментарий:

Изменены только пояснения к существующим процессам. В них явно различены факт/прогноз, точность/покрытие, выдача рекомендации/решение человека и текущая граница даблчека. Доменная приёмка полного ТЗ в этот UI-only change не входит.

## 8. AI-агент и LLM trust boundary

- [x] Н/П для UI-only diff — Agent runtime использует canonical trusted context. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Tool registry закрытый, типизированный и permission-aware. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — LLM не вызывает произвольные функции, URL, SQL или shell. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Tool inputs/outputs проходят schema validation. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Факты, вычисленные выводы, рекомендации и неизвестность разделены. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Существенный факт имеет разрешённую citation, version/snapshot и freshness. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Fact без citation имеет confidence 0 и требует проверки человеком. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Negative conclusion допустим только при доказанной полноте области поиска. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Сохранённые citations повторно авторизуются после role switch/revoke. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Prompt injection из сообщения, файла, RAG и tool result не меняет trusted context. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Tool calls, raw JSON, prompt и chain-of-thought не показаны пользователю. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Prompt/few-shot соответствуют реально подключённым tools. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Action использует proposal → confirm → reauthorization → idempotent execution. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Экспертное решение и запись в SAP/Appius недоступны из свободного чата. Без изменений; см. evidence раздела.
- [x] Н/П для UI-only diff — Agent audit не содержит полного личного сообщения и закрытого raw result. Без изменений; см. evidence раздела.

Evidence / комментарий:

Н/П к runtime: не меняются prompt, tool registry, LLM/provider, trusted context, tool execution и actions. Подсказки статические, не prompt и не вызовы агента. Mock/fallback и отсутствие гарантии точности обозначены.

## 9. Role-aware UI и пользовательские сценарии

- [ ] Навигация соответствует effective permissions, а прямой URL защищён сервером. RESULT: код/компонентные тесты проверены, визуальное подтверждение Chrome ещё не выполнено.
- [ ] Active-state корректен для новых и дочерних маршрутов. RESULT: код/компонентные тесты проверены, визуальное подтверждение Chrome ещё не выполнено.
- [ ] Role switch не показывает stale данные прежней персоны. RESULT: код/компонентные тесты проверены, визуальное подтверждение Chrome ещё не выполнено.
- [ ] Overview, analytics, MTR-анализ, scenarios, reviews, pulse, help и agent widget согласованы. RESULT: код/компонентные тесты проверены, визуальное подтверждение Chrome ещё не выполнено.
- [ ] Одинаковый показатель не расходится между экраном и ответом агента. RESULT: код/компонентные тесты проверены, визуальное подтверждение Chrome ещё не выполнено.
- [ ] Статические demo-проекции не выдаются за фактические оперативные данные. RESULT: код/компонентные тесты проверены, визуальное подтверждение Chrome ещё не выполнено.
- [ ] Loading, empty, denied, stale, partial, failure, cancelled и expired состояния спроектированы. RESULT: код/компонентные тесты проверены, визуальное подтверждение Chrome ещё не выполнено.
- [ ] Пользовательские статусы и ошибки локализованы на русский язык. RESULT: код/компонентные тесты проверены, визуальное подтверждение Chrome ещё не выполнено.
- [ ] Название «МТР-агент» используется последовательно. RESULT: код/компонентные тесты проверены, визуальное подтверждение Chrome ещё не выполнено.
- [ ] Нет горизонтального скролла на mobile, кроме явно обоснованных data tables. RESULT: код/компонентные тесты проверены, визуальное подтверждение Chrome ещё не выполнено.
- [ ] Keyboard navigation, focus, labels, aria-live и contrast проверены. RESULT: код/компонентные тесты проверены, визуальное подтверждение Chrome ещё не выполнено.
- [ ] Composer/основное действие доступны без неочевидного page scroll. RESULT: код/компонентные тесты проверены, визуальное подтверждение Chrome ещё не выполнено.
- [ ] Help center и документация обновлены при изменении процесса/экрана. RESULT: код/компонентные тесты проверены, визуальное подтверждение Chrome ещё не выполнено.

Evidence / комментарий:

Навигация сохраняет прежние href, active resolver и permission-filtered items. У кнопки type=button, aria-label, русские подписи. jsdom доказывает открытие/закрытие/Escape/возврат фокуса/отсутствие submit. Визуальная desktop/mobile проверка и браузерные маршруты ожидаются: Chrome заблокирован открытой панелью расширения.

## 10. Privacy, security и аудит

- [x] Контактные данные и закрытые реквизиты из исходного ТЗ отсутствуют.
- [x] Secrets, tokens, cookies, hashes и connection strings не попали в diff/логи.
- [x] Н/П к изменению — Upload/download проверяет ownership/scope до чтения Blob/storage. Бизнес/runtime слой не изменяется.
- [x] Н/П к изменению — CSRF включён для mutation routes. Бизнес/runtime слой не изменяется.
- [x] Н/П к изменению — Проверены IDOR, horizontal/vertical escalation и role tampering. Бизнес/runtime слой не изменяется.
- [x] Н/П к изменению — Проверены cache leakage, RAG/citation leakage и cross-thread access. Бизнес/runtime слой не изменяется.
- [x] Н/П к изменению — Audit содержит actor, authorization version, project, action, outcome, correlation и retention. Бизнес/runtime слой не изменяется.
- [x] Н/П к изменению — Критическое изменение и audit записываются атомарно. Бизнес/runtime слой не изменяется.
- [x] Privacy scan проходит без исключения новых файлов из проверки.
- [x] Production credentials/data не использовались в Preview или тестах.

Evidence / комментарий:

Privacy scan: PASS, 616 файлов на финальном прогоне. Секретов в новых текстах нет, production env не копировался. Local setup использует только test fixture, database env удаляются tests/setup.ts. Новые upload/mutation/security endpoints отсутствуют.

## 11. Тесты

- [x] Н/П к UI-only scope — Для дефекта сначала добавлен regression test. Доменные сценарии не меняются; регрессионный результат указан ниже.
- [x] Н/П к UI-only scope — Unit-тесты покрывают бизнес-правила и edge cases. Доменные сценарии не меняются; регрессионный результат указан ниже.
- [ ] Integration-тесты проходят через БД, session, RBAC и реальные adapters/ports. RESULT: 752 PASS / 3 исходных FAIL; baseline-повтор подтверждён, детали ниже.
- [ ] E2E доказывает пользовательский сценарий, а не только наличие элемента. BLOCKED: настоящая browser E2E ожидает закрытия панели расширения; jsdom не заменяет E2E.
- [x] Н/П к UI-only scope — Negative tests проверяют запрет операции и отсутствие утечки. Доменные сценарии не меняются; регрессионный результат указан ниже.
- [x] Н/П к UI-only scope — Role matrix покрыта разными реальными персонами/sessions. Доменные сценарии не меняются; регрессионный результат указан ниже.
- [x] Н/П к UI-only scope — Concurrency не смешивает user/project/thread context. Доменные сценарии не меняются; регрессионный результат указан ниже.
- [x] Tests не ослаблены и не помечены skip ради зелёного gate. Старые тесты/expectations не изменены.
- [x] Все прежние regression/eval cases сохранены. Старые тесты/expectations не изменены.

Команды и результаты:

```text
Использованы локальные Node entrypoints, без pnpm auto-install и изменения dependencies.
lint: PASS — node node_modules/eslint/bin/eslint.js . --max-warnings=0
typecheck: PASS — next typegen + tsc --noEmit; повторно TypeScript в final build
test: 752 PASS / 3 FAIL, 755 tests, 176 files (/tmp/salym-context-help-tests.json)
baseline: те же 3 FAIL на 54a7666, 8 PASS (/tmp/salym-main-baseline-tests.json)
targeted: 24 PASS, 6 files (context-help, dialog, navigation, app-shell navigation, chat hydration/surface)
privacy:scan: PASS — 616 files
eval:agent: Н/П, агент/промпты/алгоритмы не менялись; это не официальный FastGate
build: PASS — next build --webpack + verify-pdf-runtime-assets, 2 font assets
test:e2e: BLOCKED — Chrome extension UI, нужен возврат управления пользователем
```

## 12. Производительность и Vercel

- [x] Локальный build выполнен из чистого checkout/worktree. См. evidence.
- [x] Vercel Preview связан с code SHA `5f45094e235fe5f11d09f3b4a5e78c6ee2f936b2`; текущий follow-up меняет только этот review.
- [ ] Preview и Production используют разные credentials. BLOCKED/NOT RUN: публикация и визуальный smoke ещё не выполнены.
- [x] Н/П — Controlled migration применена до включения зависящего feature flag. Миграций/feature flags нет.
- [ ] Readiness/liveness подтверждены после deployment. BLOCKED/NOT RUN: публикация и визуальный smoke ещё не выполнены.
- [ ] Выполнен smoke основных ролей и изменённых маршрутов. BLOCKED/NOT RUN: публикация и визуальный smoke ещё не выполнены.
- [ ] Проверены p50/p95 и первый UI status для затронутого потока. BLOCKED/NOT RUN: публикация и визуальный smoke ещё не выполнены.
- [ ] В Vercel logs нет secrets и закрытых данных. BLOCKED/NOT RUN: публикация и визуальный smoke ещё не выполнены.
- [x] Production deployment/alias/migration не выполнялись без отдельного разрешения. См. evidence.

Evidence / комментарий:

Свежий изолированный worktree, source build --webpack PASS; symlink на существующие node_modules без изменения зависимостей. Prod credentials/data не использованы. Preview READY для code SHA 5f45094; Preview закрыт существующей Vercel-защитой, она не отключалась. Пользователь отдельно разрешил публикацию «публикуй (i)» после отчёта о baseline FAIL и Chrome-блокировке. Chrome открыл локальную страницу входа, но снова запретил нажатия из-за панели расширения: интерактивный smoke пока NOT RUN. До публикации /login вернул 200 за 0,63 с, /api/health?check=live вернул ok, readiness — 503 seed mismatch (users=9), database=ok. Это состояние исходного production, health/data/auth не исправляются в UI-only scope.

## 13. Документация и итог

- [x] README/architecture/API/data dictionary/help/operations обновлены по фактическому коду. Добавлен словарь контекстной справки; API/процессы/operations не изменяются.
- [x] Известные ограничения перечислены честно. См. ограничения и следующее действие.
- [x] Feature flags, migration order и rollback описаны. См. ограничения и следующее действие.
- [x] Acceptance не ставит «пройдено» без runtime evidence. См. ограничения и следующее действие.
- [ ] Все P0/P1 и относящиеся к ТЗ P2 исправлены.
- [x] Оставшиеся внешние блокеры имеют владельца и одно конкретное следующее действие. См. ограничения и следующее действие.

### Итоговое решение

- [x] ГОТОВО К REVIEW ограниченного UI-diff; публикация отдельно подтверждена пользователем после раскрытия baseline FAIL и отсутствия browser evidence.
- [x] НЕ ГОТОВО к заявлению о полной приёмке продукта и прохождении browser E2E.
- [x] Визуальная проверка ЗАБЛОКИРОВАНА ВНЕШНЕЙ ЗАВИСИМОСТЬЮ (панель Chrome).

Причина решения: только поясняющий UI, 24 профильных теста PASS, lint/typecheck/build/privacy PASS, Vercel Preview SUCCESS. Изменений исполняемой предметной логики нет. Пользователь после отчёта о 3 baseline FAIL и Chrome-блокировке дал отдельную прямую команду «публикуй (i)». Это не утверждение, что весь suite зелёный, и не обход failing CI: опубликованные checks Vercel и Preview Comments SUCCESS. Неизменённые source/auth/schema/env/data и отсутствие PR13 повторно проверены по Git diff.

Оставшиеся риски: необследованный браузерный layout. Три исходных FAIL в forecast/KPI/legacy-seed воспроизводятся без UI-изменений и не исправлены (вне scope). Исходный production readiness также сообщает seed mismatch; БД и liveness исправны. Полная приёмка продукта не заявляется.

Rollback: revert отдельного help-коммита/возврат предыдущего Vercel deployment; БД и env не затронуты.

Следующее действие: публикация только PR14 по полученной команде и non-mutating post-deploy checks. Интерактивный browser smoke остаётся отдельным незавершённым пунктом до закрытия панели расширения; не маркировать его PASS без наблюдения.
