# Review: универсальный МТР-агент и единый чат

Дата: 2026-08-13.
Ветка: `codex/mtr-agent-universal-chat`.
Scope: изменения от baseline `96436a9320a29f6f778007a36e587df6f2154114`.

## Проверенный пользовательский результат

- вопросы по проекту и материалу разрешаются по названиям/кодам без внутренних ID;
- сохранённый структурированный ответ после reload показывает факты, таблицы, риски, совместимость, рекомендации и ограничения;
- публичная проекция не содержит provider/tool payload и повторно авторизует citations;
- project balance, reorder, compatibility и reliability рассчитываются версиями доменных правил;
- вложение показывает preview и требует явной команды для публикации;
- RBAC-команда создаёт proposal и не меняет состояние до отдельного подтверждения;
- mobile chat сохраняет доступный composer без горизонтального overflow.

## Исправления hardening-цикла

1. Структурированный universal output ранее терялся при HTTP serialization/reload. Добавлена отдельная allowlist public schema и доступный renderer.
2. Business-project citation ошибочно проходила через обычную Appius-specification reauthorization. Добавлена отдельная project/resource проверка.
3. Явный неизвестный material code мог попадать в generic project intent. Exact material routing теперь выполняется до проектной эвристики.
4. Пустые deadline/intake/portfolio scopes могли звучать как доказанное отсутствие проблем. Теперь это missing-data, confidence 0 и human review.
5. Формулировки «Какие ближайшие сроки?» и «Что осталось обработать?» не распознавались из-за порядка слов. Router принимает обе естественные формы без project-name special cases.
6. Проверки последнего администратора и руководителя проекта выполнялись до транзакции. Теперь конкурентные изменения сериализуются блокировкой канонической строки роли/проекта, а RBAC-аудит сохраняет фактического инициатора.
7. Повторная авторизация ссылки на бизнес-проект ошибочно требовала совпадения с создателем записи. Теперь она проверяет активное членство в access-project и tenant scope, поэтому разрешённый участник проекта не теряет источник после reload.
8. Два Next route-модуля экспортировали вспомогательные обработчики ошибок. Обработчик cases вынесен в отдельный модуль, локальный digest helper больше не экспортируется; production webpack build подтверждает корректный route contract.

## Локальные доказательства

- 150/150 новый `universal-chat-v1` current-runtime eval;
- 350/350 общий corpus;
- 602/602 Vitest;
- 25 новых business E2E, включая desktop и mobile; 65 уникальных business сценариев всего;
- полный Playwright: 83 PASS / 47 ожидаемых profile skips;
- все стадии `pnpm check` до build: PASS; default Turbopack build на финальном запуске заблокирован локальной OS sandbox (`binding to a port`), при этом production webpack build и проверка PDF runtime assets на том же снимке: PASS.

## Открытые внешние гейты

- отсутствуют `OPENAI_API_KEY` и закреплённый `OPENAI_MODEL` для Preview;
- у worktree нет git remote/upstream и Vercel linkage/credentials;
- поэтому live provider, draft PR и exact-SHA Preview не могут быть подтверждены локальной проверкой.

Это не замещается mock-ответом и не является основанием затрагивать Production.
