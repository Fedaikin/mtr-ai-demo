# Review: codex/reorder-general-analytics

## 1. Паспорт ветки

- Ветка: `codex/reorder-general-analytics`
- Назначение: переместить «Общую аналитику» в предпоследнюю позицию рабочего меню, непосредственно перед «Справкой».
- База / merge base: `origin/main` / `1855e78f8b6206586fd417cffa27583e78c6a4f4`
- Проверяемый source / exact deployed SHA: `703e2c21d7e87852be507bc3fbd6f2041c7b9884`
- Pull Request: [#3](https://github.com/Fedaikin/mtr-ai-demo/pull/3), draft
- Vercel Preview: `https://mtr-ai-demo-6zrv9vbyj-fedaikin-7533s-projects.vercel.app`
- Vercel deployment ID: `dpl_FesKAbu6ovHFAHKFKe9Qv7fZVwCR`
- Дата проверки: 13.08.2026
- Проверяющий: Codex

## 2. Scope и traceability

- [x] Требование → `USER_NAVIGATION` → regression test → Vercel Preview.
- [x] Прочитаны `AGENTS.md` и канонический `docs/development/review-checklist.md`; вложенных инструкций для изменённых путей нет.
- [x] Изменение ограничено порядком рабочего меню, regression test и evidence-файлом; попутного рефакторинга нет.
- [x] Чужие изменения не удалялись; работа ведётся в отдельном checkout и отдельной ветке.

## 3. Git и интеграция

- [x] Ветка создана от актуального `origin/main`; поскольку PR #1 не слит, commit `e944c16` перенесён cherry-pick-ом только в текущую ветку.
- [x] Cherry-pick и изменение выполнены без конфликтов; `main`, чужие ветки и Production не менялись, force-push не использовался.
- [x] `git diff --check` пройден; финальный diff и clean status повторно проверяются после этого evidence-коммита.

## 4. Архитектура, RBAC и данные

- [x] Архитектурные границы: Н/П — меняется только декларативный порядок существующих navigation items.
- [x] RBAC: сохранён — `visibleItems` продолжает фильтровать те же пункты по тем же permissions; новые права и маршруты не добавлялись.
- [x] Данные/SQL/миграции: Н/П — schema, readers/writers, seed и runtime-данные не менялись.
- [x] МТР-процессы и AI trust boundary: Н/П — предметная логика, агент, tools и prompts не менялись.

## 5. Role-aware UI и пользовательский сценарий

- [x] Для любой роли, которой доступны оба пункта, последние два видимых пункта рабочего меню имеют порядок «Общая аналитика» → «Справка».
- [x] Permission filtering, active-state, direct URL protection и responsive layout не изменены.
- [x] Loading/error/localization/accessibility: Н/П — новые состояния и элементы управления не добавлялись; русские названия сохранены.

## 6. Privacy и security

- [x] `privacy:scan` пройден: 318 candidate files; секретов, контактов, credentials и закрытых данных в diff нет.
- [x] CSRF/IDOR/escalation/cache/audit: Н/П — API, mutations, storage и authorization contracts не менялись.
- [x] Production credentials/data не использовались.

## 7. Тесты и build evidence

- [x] Новый regression test `tests/unit/app-shell-navigation.regression.test.ts` проверяет точный хвост меню `[«Общая аналитика», «Справка»]`.
- [x] Точечные тесты: 2 файла, 14/14 passed.
- [x] Полный Vitest: 80 файлов, 327/327 passed.
- [x] Lint: passed, warnings 0.
- [x] Typecheck: Next route typegen и `tsc --noEmit` passed.
- [x] Agent eval: 34/34 passed.
- [x] Production build: `next build --webpack` passed, 23/23 static generation steps; PDF assets 2/2 verified.
- [x] Первые sandbox-запуски `tsx` упёрлись в инфраструктурный `listen EPERM`; обязательные privacy/eval/PDF команды повторены с разрешённым IPC и прошли.
- [x] E2E/performance: Н/П — маршруты, layout CSS, данные и runtime flow не менялись; порядок защищён regression test и будет подтверждён Preview.

## 8. Preview, риски и итог

- [x] Exact SHA `703e2c2…` привязан Vercel metadata к deployment `dpl_FesK…`; статус Preview `READY`, build и deploy outputs завершены успешно.
- [x] Runtime UI smoke дошёл до защищённого `/login`; сервер отклонил устаревший публичный demo-пароль после длительной инициализации. Менять или раскрывать ротированные credentials не требовалось; фактический порядок UI доказан regression test, полным build и exact-SHA deployment.
- [x] Миграции/feature flags: Н/П. Rollback: обычный revert веточного commit либо закрытие PR до merge.
- [x] P0/P1 и относящиеся к задаче P2 по локальному diff не выявлены.
- [x] Production deployment/alias/migration не выполнялись.

### Итоговое решение

- [x] ГОТОВО К REVIEW — после финального documentation-only evidence commit и push; PR остаётся draft.
- [x] Н/П — НЕ ГОТОВО: обязательные локальные и deployment evidence получены.
- [x] Н/П — внешнего блокера нет.

Оставшийся риск: интерактивный скриншот защищённого меню не получен из-за ротированного Preview-пароля; риск порядка закрыт детерминированным regression test. Production не затронут.

Следующее действие: review draft PR #3; merge и Production остаются отдельными решениями владельца.
