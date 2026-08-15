# Корректирующая приёмка универсального чата и доказательного МТР-анализа

Статус документа: `LOCAL_CANDIDATE_VERIFIED / PREVIEW_READY / BROWSER_BLOCKED`.

Frozen test-plan сохранён в исходном виде; его SHA-256:
`7392ea973dd8374e87ed48b33f8f904edafd3a37385e8be29a428338470ddaff`.

## Идентичность проверки

| Поле | Значение |
|---|---|
| Ветка | `codex/fix-mtr-chat-runtime-path` |
| Canonical base | `1855e78f8b6206586fd417cffa27583e78c6a4f4` |
| Последний интеграционный HEAD до локальной корректировки | `b5d128f1d4e412d2d41a34d0ecb6374032318777` |
| Pull Request | [#4](https://github.com/Fedaikin/mtr-ai-demo/pull/4) |
| Branch Preview | `https://mtr-ai-demo-git-codex-fix-mtr-ch-a27402-fedaikin-7533s-projects.vercel.app` |
| Preview evidence | Vercel check для post-fix PR HEAD — `READY`, но все запросы перенаправляются на Vercel Login; продуктовый login, API и browser-сценарии недоступны без Deployment Protection bypass |
| Проверенный product SHA | `f6c2a71996712da175f3b473e72bd16da64387d1` |
| Production | не изменялась |
| Пользователи, роли и пароли | не создавались и не изменялись; reset сохраняет существующие password hashes |

## Что исправлено

### Единый chat runtime

- Литеральные `TC-CHAT-01…04` проходят через HTTP route → `MtrAgentOrchestrator` → universal capability → безопасную public projection.
- Legacy SAP intent больше не перехватывает поддерживаемые universal-запросы до маршрутизации.
- Составной запрос по статусам возвращает три независимые выборки: `ACTIVE`, `PLANNED`, `ALL`.
- Follow-up по ранее выбранному материалу использует thread memory и при неоднозначном складе задаёт ограниченный уточняющий вопрос, не выдумывая alias или остаток.
- Отказ viewer/service account возвращается как безопасный `403`, а не `500`; закрытые material/warehouse facts не сохраняются в message, citation или audit.

### Project/source authorization before retrieval

- Сценарий создаётся только после canonical `TrustedRequestContext`, `analysis.create`, активного project membership и server-side source scopes.
- Specification, position, SAP и normative retrieval выполняются по project/source scope до чтения данных; HTTP и LLM не задают доверенные scope IDs.
- Run остаётся owned инициатором, но использует общую проектную предметную базу. Manager и analyst получают одинаковый нормативный corpus; viewer и service account не могут запустить анализ.
- Перед каждым переходом runner проверяет сохранённые authorization version и membership; revoke не разрешает продолжить run с устаревшим контекстом.

### Доказательная ответственность

- Run snapshot сохраняет полный активный trusted-scope corpus, а не только правила, которые уже удалось применить.
- Manifest содержит schema, dataset version, project/source scope, число активных правил, покрытые equipment types и полный SHA-256 checksum.
- Независимый DB-oracle в integration regression повторно вычисляет `equipmentType → нормативное правило` для каждой из 24 позиций и сверяет responsibility, document, version и clause отчёта.
- Отсутствие применимого правила остаётся `INSUFFICIENT_DATA` с `null` responsibility/confidence/citation и обязательной проверкой человеком.
- `/mtr-analysis` показывает exact run ID, corpus count, dataset version и checksum; выбор последнего завершённого run детерминирован по `completedAt`, `createdAt`, затем ID.

### Безопасный reset

- Canonical reset удаляет только runtime-запуски demo-проекта и их дочерние данные перед восстановлением общих fixtures, поэтому analyst-owned run больше не блокирует FK.
- Существующие password hashes всех demo-персон сохраняются byte-for-byte.
- Исторический публичный demo-пароль отклоняется auth boundary; plaintext и hashes не публикуются.

## Локальные gates

| Gate | Результат |
|---|---|
| Lint + TypeScript | PASS |
| Vitest full | 156 files / 629 tests PASS |
| Privacy scan | 549 candidate files PASS |
| Runtime/eval | `34 + 50 + 17 + 20 + 32 + 20 + 27 + 158 = 358/358` PASS |
| Production build | PASS; PDF runtime assets 2/2 |
| Corrective desktop E2E | 6/6 PASS |
| Project/source matrix | manager + analyst PASS; viewer + service account denied |
| Scenario performance regression | PASS без повышения query caps (`drain <= 55`, `total <= 60`) |
| Frozen test-plan checksum | PASS, совпадает с исходным `a26e8da` |

## Root cause и regression evidence

| Дефект | Root cause | Исправление | Доказательство |
|---|---|---|---|
| Universal-запрос попадал в legacy SAP path | intent preemption до universal capability | удалить preemption, оставить единый orchestrator path | exact `TC-CHAT-01…04` unit/integration/E2E |
| Follow-up терял объект | universal memory не использовалась для warehouse clarification | восстановить material из thread memory, ограничить кандидатов доступными складами | literal TC-CHAT-04 |
| Analyst не видел общий corpus | scenario reads были owner-bound по `user_id` | project/source scoped repository methods и canonical context | manager/analyst parity regression |
| Manifest доказывал только применённые rules | он строился после фильтрации результата | сохранять полный active trusted-scope corpus и checksum | независимый DB-oracle для 24 позиций |
| Reset мог менять пароль и падал после analyst-run | upsert заменял hash; shared fixtures удалялись до project runtime | preserve hashes; project runtime cleanup перед fixtures | auth-session + reset scope regressions |
| Последний terminal run выбирался недетерминированно | tie-break учитывал только время завершения | `completedAt → createdAt → id` | unit regression |

## Почему прежние eval/E2E не остановили дефект

1. Service-level eval не доказывал фактическую HTTP composition и порядок intent routing.
2. Литеральный follow-up TC-CHAT-04 был заменён похожим, но иным входом.
3. Предметные repository paths оставались owner-bound, хотя UI и RBAC уже заявляли project scope.
4. Manifest проверял внутреннюю согласованность уже выбранных правил, но не полноту исходного trusted corpus.
5. Reset-тесты не создавали run от второго проектного пользователя и не сравнивали все password hashes до/после.

## Release gate

- Local implementation and regression gate: `PASS`.
- Independent read-only review: `PASS LOCAL`; подтверждённых P0/P1/P2 в product/source diff не осталось.
- Exact post-fix Preview: Vercel check `READY`; exact HEAD и deployment metadata зафиксированы в draft PR.
- Browser acceptance: `BLOCKED_BY_VERCEL_DEPLOYMENT_PROTECTION`, если новый Preview также не предоставит bypass.
- Production deployment/alias/migration: запрещены и не выполнялись.

Итоговый статус: `ГОТОВО К COMMIT И EXACT-SHA PREVIEW`, но не к merge/Production до browser evidence либо явно оформленного внешнего blocker.
