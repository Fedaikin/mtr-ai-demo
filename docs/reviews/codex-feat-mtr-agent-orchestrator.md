# Ревью `codex/feat-mtr-agent-orchestrator`

Статус: `ЛОКАЛЬНО ГОТОВО / PREVIEW BLOCKED`

## База

- Канонический репозиторий: `https://github.com/Fedaikin/mtr-ai-demo.git`.
- Фактический `origin/main` и base SHA на старте: `1855e78f8b6206586fd417cffa27583e78c6a4f4`.
- Ветка: `codex/feat-mtr-agent-orchestrator`.
- Product app: корень репозитория, Next.js App Router.
- Зарезервированные миграции: `0004_product_iteration`, `0005_scoped_rbac`.
- Миграция агента: additive `0006_mtr_agent_orchestrator`; `0004` и `0005` не изменены.

## Preflight

- [x] Remote `main` получен и совпал с base SHA ветки.
- [x] Исходное ТЗ, мастер-промпт, RBAC-ТЗ и donor acceptance прочитаны полностью.
- [x] Исходный DOCX отрендерен и проверен без переноса контактных данных.
- [x] Canonical RBAC и product surfaces сопоставлены с требованиями.
- [x] Baseline quality gate: lint, typecheck, 326 tests, privacy scan, 34/34 eval и production build прошли.
- [x] Подтверждено отсутствие configured Git upstream и Preview credentials.

## Архитектурное решение

Единственная точка входа должна иметь контракт:

```ts
MtrAgentOrchestrator.handle(
  input: ChatInput | CommandInput | EventInput,
  context: TrustedRequestContext,
): Promise<MtrAgentResult>
```

HTTP принимает только сообщение и selection hints. Identity, permissions, active project, source/catalog scopes и authorization version строятся на сервере. Legacy `AgentService` допускается только как capability и rollback под feature flag, но не как параллельный runtime.

## Trust-boundary findings

1. Chat route получает canonical session, но передаёт runtime только `userId`.
2. Быстрые команды отсутствуют в канонической ветке и в donor существуют отдельным runtime island.
3. Repository agent paths в основном user-scoped и не доказывают project/source/catalog/warehouse pre-filtering.
4. Saved citations сериализуются без повторной авторизации.
5. Typed Drizzle schema не отражает часть уже применённых `project_id` из `0005`.
6. Durable case/evidence/plan/action/event lifecycle отсутствует.

Все шесть baseline findings закрыты на feature-ветке: route передаёт canonical context, chat/commands/events входят в один runtime, scoped ports фильтруют до retrieval, citations повторно авторизуются, typed schema отражает scoped columns, а `0006` сохраняет полный lifecycle.

## Итоговый локальный gate

- `pnpm check`: PASS;
- ESLint и TypeScript: PASS;
- Vitest: 112 файлов / 473 теста PASS;
- privacy scan: 407 файлов PASS;
- agent eval: 34/34 PASS;
- production build и 2 PDF runtime assets: PASS;
- отдельный desktop/mobile E2E рабочего пространства: PASS, без horizontal overflow.

Открытые acceptance-долги: отдельный orchestrator eval manifest ≥100, матрица ≥27 orchestrator E2E, clean-checkout повтор и exact-SHA Preview. Они не маскируются локальными unit-тестами.

## Чек-лист

Используется [канонический чек-лист](../development/review-checklist.md). Заполняется после каждого этапа. Финальный статус `ГОТОВО` запрещён без clean-checkout gate и exact-SHA Preview evidence либо зафиксированного внешнего blocker.

## Внешний blocker

На старте в worktree нет Git remote/upstream, Vercel linkage, Vercel CLI и Preview credentials. Локальная реализация и commit history доступны; push, PR и новый Preview exact SHA потребуют внешней аутентификации. Production запрещён независимо от наличия credentials.
