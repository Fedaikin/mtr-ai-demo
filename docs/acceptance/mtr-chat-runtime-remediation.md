# Корректирующая приёмка универсального чата и МТР-анализа

Статус документа: `LOCAL_FIX_VERIFIED / PREVIEW_BLOCKED`. Frozen G0 oracle сохранён без изменения.

## Идентичность проверки

| Поле | Значение |
|---|---|
| Корректирующая ветка | `codex/fix-mtr-chat-runtime-path` |
| Provisional base SHA | `0e17f74e5c94ffc3bf2b47a83eb32d647727a093` |
| Universal source SHA | `e6271da0c3279454f35f5e0895d10d8fc9e2c0be` |
| Последний обнаруженный Preview deployment | `5902965882` |
| Preview URL | `https://mtr-ai-demo-ppe1gtel0-fedaikin-7533s-projects.vercel.app` |
| Preview Git SHA | `0e17f74e5c94ffc3bf2b47a83eb32d647727a093` |
| Preview browser evidence | Заблокировано Vercel Deployment Protection; приложение перенаправляет на Vercel Login |
| Defect base verdict | `PROVISIONAL_BASE_SHA`; до штатного browser login нельзя повышать до `DEFECT_BASE_SHA` |
| Database isolation | `PREVIEW_DB_ISOLATION_UNPROVEN`; миграции и reset запрещены |
| Dataset oracle | `universal-chat-v1@1.0.0-DEMO`, manifest checksum `54b72aa2d0dbd46aa8c2b696ccafcc91641be23359215a68cc3ab9ec27128a6b` |
| Local fix SHA | `b4363fa3ecea402adae58907ef41ce86c3549472` |

## Локальный результат корректировки

- Literal chat path: `TC-CHAT-01…04` проходят через HTTP route → единый orchestrator → universal capability → public projection; generic legacy fallback не используется.
- Ответ «Покажи активные проекты» содержит фактические 22 `ACTIVE` project rows текущего RBAC scope. `PLANNED` возвращает доказанное пустое множество, `ALL` — те же 22 доступных записи.
- Полное имя шкафа разрешается в `SAP-CATALOG-ASM-ELC-0001`; несуществующий alias «второй склад» не выдумывается и приводит к targeted clarification только между `WH-DEMO-CENTRAL` и `WH-DEMO-SOUTH`. Явный central warehouse даёт 4 EA.
- Two-thread/two-scope regression: analyst получает stock evidence; viewer без `stock.search` получает `UNIVERSAL_CAPABILITY_FORBIDDEN`; в его messages/citations/audit нет material code, warehouse ID или количества.
- Responsibility decision теперь явный: `RESOLVED`, `REVIEW_REQUIRED` или `INSUFFICIENT_DATA`. Отсутствие применимого trusted-scope rule сохраняется как `null/null/null`, не попадает в суммы заказчика/подрядчика и не маскируется `45% / UNRESOLVED`.
- Additive migration `0010_responsibility_decision_state` необходима, потому что прежняя таблица делала responsibility/confidence/citation обязательными и не могла сохранить честный no-rule результат без выдуманного подрядчика. Старые строки не переписываются; migration regression фиксирует byte-for-byte сохранность legacy row.
- Run provenance содержит `responsibility-rule-manifest-v1`, dataset `normative-base-v1@1.0.0`, project/source scope, документы/пункты и SHA-256 manifest.
- `/mtr-analysis` выбирает последний завершённый immutable run, а не новый незавершённый запуск.

### Локальные gates

| Gate | Результат |
|---|---|
| Drizzle check | PASS |
| Lint + TypeScript | PASS |
| Vitest full | 154 files / 617 tests PASS |
| Privacy scan | 544 files PASS |
| Runtime/eval | 34 + 50 + 17 + 20 + 32 + 20 + 27 + 158 = 358/358 PASS |
| Production build | PASS; PDF runtime assets 2/2 |
| Corrective business E2E | 6/6 PASS desktop |
| Mobile overflow regressions | 3/3 PASS after shared header fix |
| Previously interrupted navigation checks | 4/4 PASS on isolated rerun |
| Full Playwright first pass | 84 PASS / 53 expected SKIP / 5 FAIL; all 5 failures separately reproduced/retested as above |

## Root Cause

| Boundary | Expected | Actual | Evidence | Root cause | Fix |
|---|---|---|---|---|---|
| Deploy SHA | universal runtime integrated | Preview SHA `0e17f74e…` не содержит universal branch `e6271da…` | GitHub deployment metadata и Git ancestry | Universal runtime остался в отдельной ветке и не вошёл в deploy line | Контролируемо интегрировать dependency chain в ветку от Preview SHA |
| Feature policy | universal on | Нельзя подтвердить на защищённом Preview; base composition создаёт legacy provider | `src/app/api/agent/_shared.ts` на base SHA | Deploy выполнен до интеграции universal feature composition | Интегрировать fail-closed universal policy и проверить exact-SHA Preview |
| Request route | `UNIVERSAL` | Base route вызывает legacy `AgentService` | HTTP route/composition code на base SHA | Route не получает universal capability/runtime | Провести chat через единый orchestrator с полным trusted context |
| Project capability | `project.list` | На base отсутствует universal project read path | base source; universal source содержит capability | Capability существовала только в недеплоенной ветке | Интегрировать RBAC-filtered project capability и status filter |
| Inventory resolution | полное имя/код + warehouse | Legacy keyword intent и общий fallback; universal source не имеет versioned warehouse alias directory | base provider; universal dataset/read port audit | Нет единого object-first material + warehouse resolver на фактическом route | Добавить pure resolver с приоритетом полного объекта и честным targeted clarification |
| Provider | live либо grounded deterministic fallback | Base всегда оборачивает deterministic legacy mock provider | base `_shared.ts` | Provider composition не связана с universal route | Сохранить universal deterministic fallback, live planner только при валидной конфигурации |
| Confidence | отражает качество понимания и evidence | Общий fallback может возвращать `confidence=1`, `requiresHumanReview=false` | base mock provider/UI | Confidence описывала успешность шаблона, а не понимание запроса | Для неизвестного/неоднозначного запроса confidence не выше clarification confidence; без ложного «100%» |
| UI runtime label | пользовательский продукт | Статическая метка «Детерминированный mock» | base `agent-chat.tsx`; screenshot из исходного запроса | Техническая identity попала в public UI | Удалить техническую метку из public UI; оставить identity только в admin logs |
| Responsibility rules | versioned rules в trusted scope | Правила существуют, но no-rule path не отличим от решения | normative fixture и `responsibility.ts` | Domain model не имеет явного decision state | Ввести `RESOLVED / REVIEW_REQUIRED / INSUFFICIENT_DATA` и rule manifest |
| Responsibility model | ответственность только при применимом правиле | No-rule подставляет `CONTRACTOR`, `0.45`, `UNRESOLVED` | `src/domain/responsibility.ts` на universal SHA | Fail-safe был реализован ложным бизнес-решением | No-rule: ответственность `null`, confidence `null`, `INSUFFICIENT_DATA` |
| Analysis UI | decision state, а не `confidence === 1` | Любая confidence ниже 1 отображается как «Требуется решение» | `src/app/mtr-analysis/page.tsx` на universal SHA | UI смешивает confidence и workflow state | Рендерить явный decision state; 0.92–0.98 может быть `RESOLVED` |
| Run selection | новый immutable terminal run | Preview run нельзя проверить; source page выбирает latest report без закреплённой immutable analysis version | protected Preview + source audit | Browser gate не связывает UI, run ID и persisted version | Создать новый run после fix и сверять ID/time/result version; старые результаты не обновлять |

## Почему прежние 350 eval и 65 E2E не остановили дефект

1. Corpus находился на universal source SHA, а обнаруженный Preview собран из другой линии — `0e17f74e…`.
2. Значительная часть eval проверяет service/runtime напрямую и не доказывает HTTP route, composition и public UI.
3. Не было буквальных кейсов «Покажи активные проекты» и «Есть ли на втором складке шкаф управления электродвигателем № 0001?» на exact deployment SHA.
4. Все 22 business projects в `universal-chat-v1` имеют `ACTIVE`, поэтому прежний positive test не мог выявить смешение status semantics.
5. Responsibility tests закрепляли ложный no-rule fallback, а UI tests не проверяли независимость decision state от `confidence === 1`.
6. Приёмка не связывала одновременно response schema, audit correlation ID и deployment Git SHA.

## Baseline union

| Corpus | Defect base | Universal source | Union | Manifest checksum |
|---|---:|---:|---:|---|
| Runtime eval | 34 | 350 | 350 | `a6f1b9448308f351dfd4771f9fc94ff74a3cc45286071a916e888f84c6a580f0` |
| Analysis unit/integration | 58 | 64 | 64 | `6eda553f263baf81264514eda29bd53443b9aa7f96c2c110d94b616ba7b88a9b` |
| Browser business E2E | 23 | 65 | 65 | `d4d161a00b8a3b3a3b4b3fb8b5db5862b357160db4197ec18c64cf9b45587240` |

E2E case «canonical reset» имеет один stable case ID и два source-oracle: 24 позиции в provisional base и 83 спецификации в universal source. Он отмечен `BASELINE_ORACLE_CONFLICT` и не увеличивает union. После integration выполняется актуальный versioned dataset oracle на 83 спецификации; старое доказательство сохраняется в Git history.

## Universal dependency map

| Группа | Решение |
|---|---|
| Orchestrator foundation и canonical RBAC consumption | Обязательно; интегрировать до chat route |
| Universal dataset/schema/read ports | Обязательно; миграции только как уже versioned repository artifacts, без применения к неизвестной Preview DB |
| Universal service, public projection, provider fallback | Обязательно |
| OpenAI Responses planner | Интегрировать, но live mode включается только при валидной server configuration |
| Attachments и privileged proposals | Сохранить как dependencies общего runtime; не расширять корректирующий scope |
| Analytical intelligence corpus | Сохранить, не ослаблять; изменения только для decision-state regressions |
| Docs-only commits | Не являются runtime fix, переносить только актуальные сведения |
| Два UI commits после `origin/main` на provisional base | Сохранить; конфликты разрешать по текущему dialog-close behavior, не заменять целые файлы |

## Gate verdict

- G0 source identity: `PARTIAL` — exact provisional Preview SHA найден, browser reproduction защищён Vercel Login.
- G0 baseline/test oracle: `PASS LOCAL`.
- Product fix: `PASS LOCAL` на SHA `b4363fa3ecea402adae58907ef41ce86c3549472`.
- Production/user/RBAC mutation: не выполнялась.
- Release status: `НЕ ЗАВЕРШЕНО: EXACT_SHA_PREVIEW_AND_INDEPENDENT_REVIEW_PENDING`.
