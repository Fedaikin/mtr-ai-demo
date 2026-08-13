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

- Ветка:
- Автор/ответственный:
- Назначение:
- Базовая ветка:
- Merge base:
- HEAD SHA:
- Pull Request:
- Vercel Preview URL:
- Vercel deployment ID:
- Дата проверки:
- Проверяющий:

## 2. Scope и traceability

- [ ] Цель ветки сформулирована одним проверяемым результатом.
- [ ] Прочитаны применимые `AGENTS.md`, ТЗ, ADR и документация модуля.
- [ ] Составлена связь `требование → код → тест → runtime evidence`.
- [ ] В diff нет случайных файлов, generated artifacts, локальной БД и секретов.
- [ ] Чужие незакоммиченные изменения не удалены и не перезаписаны.
- [ ] Попутный рефакторинг либо исключён, либо обоснован.
- [ ] Все заявленные функции реализованы; отсутствующие пункты перечислены явно.

Evidence / комментарий:

## 3. Git и интеграция

- [ ] Ветка основана на актуальной согласованной базе.
- [ ] Проверены новые commits и параллельные ветки, затрагивающие те же контракты.
- [ ] Конфликты разрешены по бизнес-смыслу, а не выбором одной стороны целиком.
- [ ] История не переписана force-push без отдельного разрешения.
- [ ] Commit-ы небольшие, содержательные и не смешивают несвязанные задачи.
- [ ] Перед сдачей выполнен diff против merge base.
- [ ] Заполненный review-файл входит в ветку.

Evidence / комментарий:

## 4. Архитектура и границы модулей

- [ ] Соблюдена зависимость `web → application → domain` и `application → ports ← adapters`.
- [ ] Бизнес-правила не продублированы в UI, route и prompt.
- [ ] Новый функционал переиспользует канонические сервисы и контракты.
- [ ] Отсутствуют параллельные реализации одного use case.
- [ ] Serverless state не хранится только в памяти или ephemeral filesystem.
- [ ] Длительные операции используют persisted job/state.
- [ ] Feature flags и rollback описаны и проверены.
- [ ] Ошибки dependency/runtime приводят к безопасному состоянию.

Evidence / комментарий:

## 5. RBAC и авторизация

- [ ] Identity, роли, permissions, project/source/catalog/warehouse scopes получены только сервером.
- [ ] Клиентские `user_id`, `project_id`, role, permission, scope и claims не считаются доверенными.
- [ ] Используется canonical `TrustedRequestContext` и `AuthorizationService`.
- [ ] Проверка permission выполняется в API/application layer, а не только скрытием кнопки.
- [ ] Project/source/catalog/warehouse фильтры применяются до retrieval.
- [ ] Личный объект проверяет owner; проектный объект проверяет project membership/scope.
- [ ] Системный администратор без проектной роли не получает бизнес-данные.
- [ ] Viewer не получает складские количества без `stock.search`.
- [ ] Auditor и service account не получают интерактивные mutations.
- [ ] Revoke/role switch инвалидирует прежнюю сессию и permission-aware cache.
- [ ] Direct ID, count, autocomplete, export, citation и negative result не раскрывают закрытый объект.
- [ ] Отказ авторизации fail-closed и имеет безопасный одинаковый внешний ответ.
- [ ] Решения/действия повторно авторизуются непосредственно перед side effect.

Evidence / комментарий:

## 6. Данные, SQL и миграции

- [ ] Миграция additive и имеет следующий свободный номер.
- [ ] Проверена чистая база и обновление существующей базы.
- [ ] Backfill детерминирован, повторяем и не повреждает runtime-данные.
- [ ] Constraints/indexes соответствуют доменным инвариантам.
- [ ] Enum/status/type обработаны во всех readers, writers, UI и localization mappings.
- [ ] Mutation с несколькими связанными записями выполняется транзакционно.
- [ ] Используется optimistic locking/idempotency там, где возможны повторы и гонки.
- [ ] Reset/seed не затрагивает Production и не стирает несвязанные runtime-данные.
- [ ] Общие данные проекта/каталога/источников не копируются по пользователям.
- [ ] Единицы, количества, даты, timezone и границы периода проверены.
- [ ] В Git отсутствуют локальные каталоги БД, dumps и загруженные пользовательские файлы.

Evidence / комментарий:

## 7. МТР-процессы и предметная логика

- [ ] Используется актуальная версия спецификации.
- [ ] Импорт валидирует строки, единицы, дубликаты и источник до публикации.
- [ ] Старая версия и её позиции сохраняются для аудита и сравнения.
- [ ] Запуск, retry, cancel и background drain имеют корректные переходы состояния.
- [ ] Ответственность формируется только нормативным правилом с документом/версией/пунктом.
- [ ] Аналоги имеют нормативное основание, сравнение отклонений и BOM-проверку.
- [ ] Остаток, потребность, покрытие, movements и прогноз не смешиваются.
- [ ] Экспертный Даблчек не подменяет решение человека.
- [ ] Экспертное решение требует причину и попадает в audit.
- [ ] Отчёт и экспорт сохраняют provenance и учитывают незавершённые проверки.
- [ ] Показатели и рекомендации на overview/analytics получены из данных либо явно маркированы как synthetic fixture.

Evidence / комментарий:

## 8. AI-агент и LLM trust boundary

- [ ] Agent runtime использует canonical trusted context.
- [ ] Tool registry закрытый, типизированный и permission-aware.
- [ ] LLM не вызывает произвольные функции, URL, SQL или shell.
- [ ] Tool inputs/outputs проходят schema validation.
- [ ] Факты, вычисленные выводы, рекомендации и неизвестность разделены.
- [ ] Существенный факт имеет разрешённую citation, version/snapshot и freshness.
- [ ] Fact без citation имеет confidence 0 и требует проверки человеком.
- [ ] Negative conclusion допустим только при доказанной полноте области поиска.
- [ ] Сохранённые citations повторно авторизуются после role switch/revoke.
- [ ] Prompt injection из сообщения, файла, RAG и tool result не меняет trusted context.
- [ ] Tool calls, raw JSON, prompt и chain-of-thought не показаны пользователю.
- [ ] Prompt/few-shot соответствуют реально подключённым tools.
- [ ] Action использует proposal → confirm → reauthorization → idempotent execution.
- [ ] Экспертное решение и запись в SAP/Appius недоступны из свободного чата.
- [ ] Agent audit не содержит полного личного сообщения и закрытого raw result.

Evidence / комментарий:

## 9. Role-aware UI и пользовательские сценарии

- [ ] Навигация соответствует effective permissions, а прямой URL защищён сервером.
- [ ] Active-state корректен для новых и дочерних маршрутов.
- [ ] Role switch не показывает stale данные прежней персоны.
- [ ] Overview, analytics, MTR-анализ, scenarios, reviews, pulse, help и agent widget согласованы.
- [ ] Одинаковый показатель не расходится между экраном и ответом агента.
- [ ] Статические demo-проекции не выдаются за фактические оперативные данные.
- [ ] Loading, empty, denied, stale, partial, failure, cancelled и expired состояния спроектированы.
- [ ] Пользовательские статусы и ошибки локализованы на русский язык.
- [ ] Название «МТР-агент» используется последовательно.
- [ ] Нет горизонтального скролла на mobile, кроме явно обоснованных data tables.
- [ ] Keyboard navigation, focus, labels, aria-live и contrast проверены.
- [ ] Composer/основное действие доступны без неочевидного page scroll.
- [ ] Help center и документация обновлены при изменении процесса/экрана.

Evidence / комментарий:

## 10. Privacy, security и аудит

- [ ] Контактные данные и закрытые реквизиты из исходного ТЗ отсутствуют.
- [ ] Secrets, tokens, cookies, hashes и connection strings не попали в diff/логи.
- [ ] Upload/download проверяет ownership/scope до чтения Blob/storage.
- [ ] CSRF включён для mutation routes.
- [ ] Проверены IDOR, horizontal/vertical escalation и role tampering.
- [ ] Проверены cache leakage, RAG/citation leakage и cross-thread access.
- [ ] Audit содержит actor, authorization version, project, action, outcome, correlation и retention.
- [ ] Критическое изменение и audit записываются атомарно.
- [ ] Privacy scan проходит без исключения новых файлов из проверки.
- [ ] Production credentials/data не использовались в Preview или тестах.

Evidence / комментарий:

## 11. Тесты

- [ ] Для дефекта сначала добавлен regression test.
- [ ] Unit-тесты покрывают бизнес-правила и edge cases.
- [ ] Integration-тесты проходят через БД, session, RBAC и реальные adapters/ports.
- [ ] E2E доказывает пользовательский сценарий, а не только наличие элемента.
- [ ] Negative tests проверяют запрет операции и отсутствие утечки.
- [ ] Role matrix покрыта разными реальными персонами/sessions.
- [ ] Concurrency не смешивает user/project/thread context.
- [ ] Tests не ослаблены и не помечены skip ради зелёного gate.
- [ ] Все прежние regression/eval cases сохранены.

Команды и результаты:

```text
pnpm lint:
pnpm typecheck:
pnpm test:
pnpm privacy:scan:
pnpm eval:agent:
pnpm build:
pnpm test:e2e:
```

## 12. Производительность и Vercel

- [ ] Локальный build выполнен из чистого checkout/worktree.
- [ ] Vercel Preview связан с exact HEAD SHA.
- [ ] Preview и Production используют разные credentials.
- [ ] Controlled migration применена до включения зависящего feature flag.
- [ ] Readiness/liveness подтверждены после deployment.
- [ ] Выполнен smoke основных ролей и изменённых маршрутов.
- [ ] Проверены p50/p95 и первый UI status для затронутого потока.
- [ ] В Vercel logs нет secrets и закрытых данных.
- [ ] Production deployment/alias/migration не выполнялись без отдельного разрешения.

Evidence / комментарий:

## 13. Документация и итог

- [ ] README/architecture/API/data dictionary/help/operations обновлены по фактическому коду.
- [ ] Известные ограничения перечислены честно.
- [ ] Feature flags, migration order и rollback описаны.
- [ ] Acceptance не ставит «пройдено» без runtime evidence.
- [ ] Все P0/P1 и относящиеся к ТЗ P2 исправлены.
- [ ] Оставшиеся внешние блокеры имеют владельца и одно конкретное следующее действие.

### Итоговое решение

- [ ] ГОТОВО К REVIEW
- [ ] НЕ ГОТОВО
- [ ] ЗАБЛОКИРОВАНО ВНЕШНЕЙ ЗАВИСИМОСТЬЮ

Причина решения:

Оставшиеся риски:

Rollback:

Следующее действие:
