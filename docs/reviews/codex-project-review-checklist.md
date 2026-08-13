# Review: codex/project-review-checklist

## Паспорт

- Ветка: `codex/project-review-checklist`
- Ответственный: Codex
- Назначение: единый обязательный review checklist и PR template
- База: `main`
- Merge base: `80f61ee3a981a2023af53b19b2370eb70dfb9b7e`
- HEAD SHA: см. exact commit текущего Pull Request; review-файл входит в тот же commit
- Vercel Preview: Н/П — изменение только документации и GitHub template
- Дата: 13.08.2026

## Scope

- [x] Добавлена каноническая форма проверки ветки.
- [x] Добавлено обязательное правило в `AGENTS.md`.
- [x] Добавлен Pull Request template.
- [x] Runtime, schema, dependencies и Production не изменены.
- [x] В diff отсутствуют секреты, контакты и generated artifacts.

## Применимость

- [x] Git/traceability/documentation: применимо, проверено.
- [x] RBAC/data/AI/UI/migrations/runtime: Н/П — код этих контуров не изменялся.
- [x] Unit/integration/E2E/performance: Н/П — исполняемый код не изменялся.
- [x] Vercel Preview: Н/П — documentation-only PR.

## Проверки

- [x] `git diff --check`
- [x] Проверены относительные пути и имена файлов.
- [x] Проверено, что инструкция не требует редактировать один общий файл в каждой ветке: каждая ветка создаёт собственный `docs/reviews/<branch-slug>.md`.
- [x] Проверено, что PR template ссылается на канонический шаблон.

## Решение

- [x] ГОТОВО К REVIEW

Риски: без branch protection GitHub не может технически запретить слияние
незаполненного PR; процесс обеспечивается `AGENTS.md`, PR template и review.

Rollback: удалить три добавленных файла и новый раздел `AGENTS.md` отдельным
revert commit.
