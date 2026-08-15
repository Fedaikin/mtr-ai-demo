# Review: codex/fix-visible-agent-entity-resolution

## 1. Паспорт ветки

- Ветка: `codex/fix-visible-agent-entity-resolution`
- Ответственный: Codex
- Назначение: исправить фактический ответ МТР-агента на проверку позиции по Appius-коду и точному русскому названию.
- База / merge base: `origin/main` / `b585b36c189f344c95809b59b5cb097b1a5d56fa`
- Исходный Production SHA: `b585b36c189f344c95809b59b5cb097b1a5d56fa`
- HEAD SHA: см. exact commit текущего Pull Request; review-файл входит в ветку.
- Pull Request: ожидает первого push.
- Vercel Preview URL / deployment ID: ожидает первого push.
- Дата проверки: 15.08.2026
- Проверяющий: Codex

## 2. Scope и traceability

- [x] Проверяемый результат: запросы `проверь позицию APP-DEMO-BALL-021` и `проверь позицию Кран шаровой DN 25 PN 40` возвращают фактическую позицию Appius, лучшее совпадение SAP, оценку совместимости, остаток и решение об экспертной проверке.
- [x] Прочитаны корневой `AGENTS.md` и канонический review checklist; вложенных инструкций для изменённых путей нет.
- [x] Связь требования: `classifyIntents` → `collectPositionCheckFacts` → `MockLLMProvider` → два integration regression cases и unit regression пустой заглушки.
- [x] Сначала добавлены падающие regression tests: оба предметных запроса возвращали общую заглушку, пустая заглушка возвращала ложную уверенность 100%.
- [x] Изменение ограничено двумя runtime-файлами, двумя test-файлами и этим evidence-файлом; попутного рефакторинга нет.
- [x] В diff нет generated artifacts, локальной БД, пользовательских файлов, контактов, реквизитов и секретов.

## 3. Git и интеграция

- [x] Ветка создана из актуального `origin/main` после read-only проверки GitHub Production deployment: deployment `5903582092` указывает на SHA `b585b36…`.
- [x] Проверены открытые PR: #4 изменяет более широкий universal-chat runtime; текущий fix основан на Production `main` и не подменяет его контракты.
- [x] Force-push, переписывание истории и изменения чужих веток не выполнялись.
- [x] `git diff --check` пройден; финальный diff и clean status будут повторены после Preview evidence.

## 4. Архитектура, данные и МТР-логика

- [x] Соблюдена цепочка `application AgentService → typed Appius/SAP ports → deterministic domain matching → grounded provider`.
- [x] Оценка совместимости переиспользует канонический `findBestMaterial`; правило не продублировано в UI или prompt.
- [x] Входы и результаты инструментов проходят существующие Zod-схемы; LLM не получает произвольный URL, SQL или shell.
- [x] Позиция разрешается только в актуальной версии Appius; SAP-кандидаты ограничены типом оборудования и серверным user context.
- [x] Остаток не смешан с потребностью: ответ отдельно показывает требование, доступное количество и дефицит/остаток после обеспечения.
- [x] Совпадение категории `REVIEW` не превращается в автоматическое решение: confidence ограничен 75%, обязательна проверка специалиста.
- [x] При отсутствии предметных фактов заглушка теперь имеет confidence 0 и требует проверки человеком.
- [x] SQL, schema, migrations, seed, fixtures, роли, пользователи, пароли и продуктовые данные не изменялись.

## 5. RBAC, privacy и security

- [x] Trusted user identity по-прежнему формируется серверной сессией; `user_id` из сообщения не используется.
- [x] Appius и SAP читаются через существующие permission-aware adapters с active user scope до retrieval.
- [x] Существенные факты получают citations Appius position/version и SAP material/snapshot; raw tool result в чат не выводится.
- [x] Mutation, action proposal, роль, permission, project scope и session contracts не изменялись.
- [x] `privacy:scan`: PASS, проверено 319 candidate files.
- [x] Production credentials/data в локальных тестах не использовались.

## 6. UI и пользовательский сценарий

- [x] Формат публичного ответа совместим с существующим `AgentDecisionMeta` и citations UI.
- [x] Для найденного совпадения выводятся русские пояснения; английскими остаются только Appius, SAP и предметные коды/единицы.
- [x] Для `APP-DEMO-BALL-021` ответ содержит `SAP-DEMO-0021`, совместимость `86%`, доступно `9 EA` и требование экспертной проверки.
- [x] Layout, навигация, composer, accessibility и responsive CSS: Н/П — не изменялись.
- [ ] Runtime UI smoke на exact Vercel Preview: ожидает deployment первого push.

## 7. Проверки

- [x] Regression-first: до исправления 3 новых проверки FAIL; после исправления 10/10 targeted tests PASS.
- [x] `pnpm lint`: PASS, warnings 0.
- [x] `pnpm typecheck`: PASS, Next route typegen и `tsc --noEmit`.
- [x] `pnpm test`: PASS, 80 файлов / 330 тестов.
- [x] `pnpm privacy:scan`: PASS, 319 candidate files.
- [x] `pnpm eval:agent`: PASS, 34/34 cases.
- [x] `pnpm build`: PASS, 23/23 static generation steps, 2/2 PDF runtime assets.
- [x] Performance/load: Н/П — запрос добавляет последовательное чтение текущей позиции и SAP; фактическая Preview latency будет зафиксирована в runtime smoke.

## 8. Риски, rollback и решение

- [x] Известный риск: точное имя разрешается детерминированным lexical matcher; неоднозначный текст остаётся в fail-safe режиме и не создаёт side effect.
- [x] Feature flag/migration order: Н/П — новые флаги и миграции отсутствуют.
- [x] Rollback: обычный revert commit ветки; данные и schema откатывать не требуется.
- [x] Production deployment/alias/migration не выполнялись.

### Итоговое решение

- [ ] ГОТОВО К REVIEW
- [x] НЕ ГОТОВО — локальный gate пройден, требуется exact-SHA Vercel Preview и UI smoke двух запросов.
- [x] Н/П — внешнего блокера нет.

Следующее действие: commit + push, дождаться Vercel Preview, повторить оба запроса в UI, записать URL/deployment/SHA/latency и перевести решение в «ГОТОВО К REVIEW» при успешном smoke.
