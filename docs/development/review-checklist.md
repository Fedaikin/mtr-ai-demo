# Чек-лист ревью ветки

## Границы изменения

- [ ] Ветка создана от актуального `origin/main`.
- [ ] Production, реальные корпоративные данные и старые миграции не изменены.
- [ ] В коммитах нет случайных generated-файлов, секретов и закрытых контактов.
- [ ] Новая схема данных добавляется только следующей свободной миграцией.

## Архитектура и доверие

- [ ] Chat, command и event используют один `MtrAgentOrchestrator`.
- [ ] В runtime передаётся серверный `TrustedRequestContext`, а не только `userId`.
- [ ] Project/source/catalog/warehouse ограничения применяются до retrieval.
- [ ] Сохранённые cases, evidence и citations повторно авторизуются при чтении.
- [ ] Action confirm повторно проверяет permission и `authorizationVersion`.
- [ ] Экспертное решение и SAP/Appius write недоступны из чата.

## Данные, аудит и ошибки

- [ ] Cases/evidence/plans/tasks/actions/events хранятся durable.
- [ ] Action и обязательный audit сохраняются атомарно.
- [ ] Idempotency исключает повторный side effect.
- [ ] Partial/unknown не превращаются в подтверждённый факт.
- [ ] Технические журналы не содержат сообщения, raw tool results, prompts и secrets.
- [ ] Feature flags и kill switch имеют безопасное значение по умолчанию и rollback.

## Пользовательский контур

- [ ] Виджет и `/mtr-analysis` используют общий runtime; отдельный `/agent` не восстановлен.
- [ ] Смена роли очищает прежний thread/citation context.
- [ ] Быстрые команды применяют все выбранные фильтры.
- [ ] Все публичные статусы и источники локализованы.
- [ ] Источники открываются только после повторной проверки доступа.
- [ ] Mobile не имеет горизонтального скролла; composer доступен без page scroll.

## Проверка

- [ ] Есть RED/GREEN regressions для 12 первичных и 10 интеграционных пробелов.
- [ ] Runtime eval содержит не менее 100 случаев, из них не менее 40 новых orchestrator cases.
- [ ] API/runtime/DB покрыты не менее чем 30 новыми integration-сценариями.
- [ ] E2E содержит не менее 27 различных пользовательских сценариев.
- [ ] Security, concurrency и performance gates пройдены.
- [ ] Полный quality gate пройден из clean checkout.
- [ ] Preview связан с exact commit SHA либо записан внешний blocker.

## Релиз

- [ ] Документация описывает фактический код, migration, flags и rollback.
- [ ] Acceptance-таблица содержит runtime evidence, а не только unit-тесты.
- [ ] Все P0/P1 и относящиеся к ТЗ P2 устранены либо релиз остановлен.
- [ ] Production не изменён.
