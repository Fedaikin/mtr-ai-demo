# Чек-лист ревью ветки

## Границы изменения

- [x] Ветка создана от актуального `origin/main`.
- [x] Production, реальные корпоративные данные и старые миграции не изменены.
- [x] В коммитах нет случайных generated-файлов, секретов и закрытых контактов.
- [x] Новая схема данных добавляется только следующей свободной миграцией.

## Архитектура и доверие

- [x] Chat, command и event используют один `MtrAgentOrchestrator`.
- [x] В runtime передаётся серверный `TrustedRequestContext`, а не только `userId`.
- [x] Project/source/catalog/warehouse ограничения применяются до retrieval.
- [x] Сохранённые cases, evidence и citations повторно авторизуются при чтении.
- [x] Action confirm повторно проверяет permission и `authorizationVersion`.
- [x] Экспертное решение и SAP/Appius write недоступны из чата.

## Данные, аудит и ошибки

- [x] Cases/evidence/plans/tasks/actions/events хранятся durable.
- [x] Action и обязательный audit сохраняются атомарно.
- [x] Idempotency исключает повторный side effect.
- [x] Partial/unknown не превращаются в подтверждённый факт.
- [x] Технические журналы не содержат сообщения, raw tool results, prompts и secrets.
- [x] Feature flags и kill switch имеют безопасное значение по умолчанию и rollback.

## Пользовательский контур

- [x] Виджет и `/mtr-analysis` используют общий runtime; отдельный `/agent` не восстановлен.
- [x] Смена роли очищает прежний thread/citation context.
- [x] Быстрые команды применяют все выбранные фильтры.
- [x] Все публичные статусы и источники локализованы.
- [x] Источники открываются только после повторной проверки доступа.
- [x] Mobile не имеет горизонтального скролла; composer доступен без page scroll.

## Проверка

- [x] Есть RED/GREEN regressions для 12 первичных и интеграционных пробелов.
- [x] Runtime eval содержит 350 уникальных случаев, включая 150 новых universal-chat current-runtime cases.
- [ ] API/runtime/DB покрыты не менее чем 30 новыми integration-сценариями.
- [x] E2E содержит 65 уникальных business-сценариев, включая 25 новых universal-chat flows.
- [x] Public projection, citation reauthorization, attachment/RBAC safety и bounded universal eval пройдены локально.
- [ ] Полный quality gate и полный desktop/mobile Playwright повторно пройдены на финальном clean HEAD.
- [x] Preview связан с exact commit SHA либо записан внешний blocker.

## Релиз

- [x] Документация описывает фактический код, migration, flags и rollback.
- [x] Acceptance-таблица содержит persisted-runtime eval и браузерные evidence, а не только unit-тесты.
- [ ] Все P0/P1 и относящиеся к ТЗ P2 устранены либо релиз остановлен.
- [x] Production не изменён.
- [ ] Live OpenAI provider доказан на exact Preview SHA; локальная SDK boundary-проверка не засчитывается вместо live вызова.
- [ ] Draft PR и exact-SHA Preview созданы после появления authenticated remote/Vercel linkage.
