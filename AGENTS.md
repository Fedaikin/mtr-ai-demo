<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Обязательная приёмка каждой Git-ветки

Перед тем как объявить ветку готовой, скопируйте
`docs/development/review-checklist.md` в
`docs/reviews/<branch-slug>.md`, заполните все применимые пункты и
закоммитьте этот файл вместе с изменениями. Для каждого пункта нужен результат
проверки или отметка `Н/П` с объяснением; наличие кода, TODO или unit-теста
не заменяет runtime evidence.

В Pull Request укажите ссылку на заполненный review-файл, exact commit SHA,
результаты проверок и Vercel Preview, если изменения затрагивают runtime/UI.
Нельзя переводить PR в ready-for-review, пока обязательные пункты не заполнены,
а критические дефекты, утечки данных и нарушения RBAC не устранены.
