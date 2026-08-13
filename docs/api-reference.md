# Справочник HTTP API прототипа МТР

Справочник описывает текущие Next.js Route Handlers из `src/app/api/**/route.ts`: 54 файла и 65 операций «HTTP-метод + путь». Псевдонимы `:id`, `:runId`, `:positionId` и `:materialCode` ниже означают URL-encoded path parameters.

Для первого прохода используйте [демонстрацию за 7–10 минут](demo-guide.md). Команды диагностики, reset и ручного импорта приведены в [operations.md](operations.md).

## Базовый адрес и аутентификация

Локальный базовый адрес по умолчанию:

```text
http://localhost:3000
```

Все пользовательские и административные маршруты требуют persistent HttpOnly-сессию. Demo-контур содержит восемь синтетических субъектов: семь интерактивных персон и одну сервисную учётную запись. Пример безопасной проекции активной персоны:

```json
{
  "id": "demo-user-001",
  "displayName": "Демо-пользователь 1",
  "roles": ["USER"],
  "locale": "ru-RU"
}
```

Вход выполняется на `/login`; реквизиты выдаются приватно и не отображаются в UI/документации. БД хранит только scrypt-хеш пароля, а cookie содержит opaque token, SHA-256-хеш которого сохранён в `auth_sessions`. Сервер строит `TrustedRequestContext` из действующей session, memberships, assignments и scopes. Значения identity/permissions из body, query или headers не заменяют trusted context. Preview дополнительно закрывается Deployment Protection.

## Общие соглашения

- JSON-запросы используют `Content-Type: application/json`.
- Upload использует `multipart/form-data`.
- Даты и snapshots передаются строками с часовым поясом.
- Обычный успешный ответ имеет статус `200`; создание thread, run, message pair или upload возвращает `201`.
- Большинство ответов возвращают объект напрямую, без общей оболочки `data`.
- User-scoped чтения выполняются по trusted `session.user.id`.
- Agent thread/message projection намеренно не содержит `userId` и `createdBy`. Некоторые mock/domain endpoints возвращают `userId: "demo-user-001"` как поле текущей синтетической сущности.
- Для thread list и message list установлен `Cache-Control: no-store`; export имеет `private, no-store`.

### Формат ошибки

Предметная ошибка:

```json
{
  "error": {
    "code": "AGENT_THREAD_NOT_FOUND",
    "message": "Диалог агента не найден",
    "details": null
  }
}
```

Ошибка Zod-валидации имеет HTTP `400`, код `VALIDATION_ERROR` и `details.issues`. Некорректный JSON возвращает `400 INVALID_JSON`. Необработанная ошибка возвращает `500 INTERNAL_ERROR` и безопасный `requestId`; stack trace и connection string клиенту не передаются.

Типовые статусы:

| HTTP | Значение |
|---:|---|
| `200` | Чтение или мутация выполнены |
| `201` | Создана сущность или пара сообщений |
| `400` | Некорректный JSON, path/query/header или schema |
| `401` | Нет действующей сессии |
| `403` | Недостаточная роль, access denied или reset выключен |
| `404` | Сущность отсутствует либо недоступна trusted user |
| `409` | Устаревшая версия, несовместимое состояние или report не готов |
| `413` | Upload больше 10 МБ или пустой |
| `429` | Управляемое состояние SAP `RATE_LIMITED` |
| `500` | Безопасная внутренняя ошибка |
| `503` | Управляемая недоступность Appius/SAP |

## Индекс операций

### Service

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `GET` | `/api/health` | Без session | Liveness либо readiness БД и canonical seed |

### Аутентификация

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `POST` | `/api/auth/login` | Без session | Проверить demo-реквизиты, создать opaque session и HttpOnly cookie |
| `POST` | `/api/auth/logout` | Без session | Отозвать текущую session и очистить cookie |

### User и agent

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `GET` | `/api/agent/threads` | USER | Список persisted-диалогов |
| `POST` | `/api/agent/threads` | USER | Создать диалог |
| `GET` | `/api/agent/threads/:id/messages` | USER | История принадлежащего user диалога |
| `POST` | `/api/agent/threads/:id/messages` | USER | Сохранить вопрос, вызвать агента, сохранить ответ |
| `POST` | `/api/agent/messages/:id/feedback` | `agent.chat`, владелец ответа | Идемпотентно сохранить тип отзыва как quarantined learning candidate |
| `POST` | `/api/agent/commands/:commandKey` | `agent.chat` + permissions команды | Выполнить `SUMMARY`, `RISKS`, `STOCKS`, `KPI`, `MY_TASKS` или `ANALYSIS` через единый runtime |
| `GET`, `POST` | `/api/agent/cases` | `agent.chat` | Список личных кейсов или создание scoped кейса |
| `GET`, `DELETE` | `/api/agent/cases/:id` | `agent.chat` | Получить повторно авторизованный кейс или закрыть его |
| `GET` | `/api/agent/digest` | `agent.chat` | Недельная сводка текущей и предыдущей календарной недели |
| `GET` | `/api/agent/insights` | `agent.chat` | Активные proactive-сигналы доступного проекта |
| `GET`, `POST` | `/api/agent/actions` | `agent.chat` + permission действия | Список личных предложений или создать proposal |
| `GET` | `/api/agent/actions/:id` | `agent.chat` | Получить доступное предложение без закрытых параметров |
| `POST` | `/api/agent/actions/:id/confirm` | permission действия | Повторно авторизовать и идемпотентно выполнить proposal |
| `POST` | `/api/agent/actions/:id/cancel` | владелец | Отменить ещё не выполненное предложение |
| `POST` | `/api/agent/events` | service secret | Идемпотентно принять и обработать platform event |
| `POST` | `/api/agent/events/process` | service secret | Обработать следующий сохранённый event проекта |
| `POST` | `/api/uploads` | USER | Загрузить и разобрать файл |
| `POST` | `/api/manual-imports/specification` | USER | Валидировать upload как draft спецификации |
| `POST` | `/api/manual-imports/sap` | USER | Валидировать upload как SAP snapshot |

### Сценарии и отчёты

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `GET` | `/api/scenario-runs` | USER | Последние 100 запусков |
| `POST` | `/api/scenario-runs` | ADMIN | Создать `QUEUED` run и запланировать серверное выполнение |
| `GET` | `/api/scenario-runs/:id` | USER | Получить run, snapshots и steps; незавершённый run server-side перепланируется |
| `POST` | `/api/scenario-runs/:id/advance` | ADMIN | Совместимый диагностический API: исполнить не более одного шага |
| `POST` | `/api/scenario-runs/:id/cancel` | ADMIN | Отменить активный run |
| `POST` | `/api/scenario-runs/:id/retry` | ADMIN | Создать новый run из snapshot исходного |
| `POST` | `/api/scenario-runs/:id/manual-import` | ADMIN | Возобновить допустимый Appius/SAP failure с валидированными строками upload |
| `GET` | `/api/reports/:runId` | USER | Получить готовую report model |
| `GET` | `/api/reports/:runId/export` | USER | Скачать JSON, XLSX или PDF |
| `PATCH` | `/api/reports/:runId/results/:positionId` | ADMIN | Сохранить версионное решение эксперта по ответственности |

### Appius и SAP mock facade

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `GET` | `/api/mock/appius/specifications` | USER session | Спецификации и состояние Appius |
| `GET` | `/api/mock/appius/specifications/:id/versions` | USER session | Все версии спецификации |
| `GET` | `/api/mock/appius/specifications/:id/positions` | USER session | Позиции latest либо явно выбранной версии |
| `POST` | `/api/mock/appius/events/new-version` | ADMIN | Обработать synthetic new-version event |
| `GET` | `/api/mock/sap/materials/:materialCode` | USER session | Карточка материала и balances |
| `GET` | `/api/mock/sap/odata/sap/API_MATERIAL_STOCK_SRV/A_MaterialStock` | USER session | OData v2-like список остатков |
| `GET` | `/api/mock/admin/integrations/appius/state` | ADMIN | Состояние Appius mock |
| `POST` | `/api/mock/admin/integrations/appius/state` | ADMIN | Изменить состояние Appius mock |
| `GET` | `/api/mock/admin/integrations/sap/state` | ADMIN | Состояние SAP mock |
| `POST` | `/api/mock/admin/integrations/sap/state` | ADMIN | Изменить состояние SAP mock |
| `POST` | `/api/mock/admin/integrations/sap/reset` | ADMIN | Восстановить весь canonical demo-набор |

### Администрирование

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| `GET` | `/api/admin/integrations` | ADMIN | Публичная конфигурация интеграций без secrets |
| `PATCH` | `/api/admin/integrations` | ADMIN | Изменить состояние любой интеграции |
| `GET` | `/api/admin/prompts` | ADMIN | Версии prompt |
| `POST` | `/api/admin/prompts` | ADMIN | Создать версию prompt |
| `POST` | `/api/admin/prompts/:id/activate` | ADMIN | Активировать существующую версию |
| `GET` | `/api/admin/dictionaries` | ADMIN | Список или поиск словарей |
| `PATCH` | `/api/admin/dictionaries/:id` | ADMIN | Изменить values/active с optimistic version |
| `PATCH` | `/api/admin/scenarios/:id` | ADMIN | Включить или выключить scenario |
| `GET` | `/api/admin/audit` | ADMIN | Фильтруемый журнал с redaction |
| `POST` | `/api/admin/reset` | ADMIN | Восстановить canonical demo-набор 24/30 |

## Основные модели ответа

### `ScenarioRun`

| Поле | Тип | Примечание |
|---|---|---|
| `id` | string | Генерируется как `run-<uuid>` |
| `userId` | string | Всегда trusted `demo-user-001` |
| `scenarioId` | string | ID одного из пяти seeded scenarios |
| `specificationId` | string | FK-якорь; полный scope хранится в `inputSnapshot.specificationIds` |
| `status` | enum | `QUEUED`, шесть рабочих состояний, `COMPLETED`, `FAILED`, `CANCELLED` |
| `currentStep` | string | Текущее состояние либо terminal status |
| `progress` | integer | `0..100` |
| `mode` | enum | `NORMAL` или `DRY_RUN` |
| `seed` | string | Детерминированный seed запроса |
| `version` | positive integer | Optimistic concurrency token |
| `retryOfRunId` | string? | Ссылка нового retry на исходный run |
| `inputSnapshot` | object | Immutable request/source policy snapshot |
| `outputSnapshot` | object | Накопленные Appius/SAP/results/report/failure snapshots |
| `errorCode`, `errorMessage` | string? | Безопасная ошибка terminal/failed run |
| `steps` | array | Persisted `ScenarioRunStep[]` по времени |
| `createdAt`, `updatedAt`, `startedAt`, `completedAt` | string | Timestamp с часовым поясом; последние два optional |

Рабочие статусы и progress:

| Статус | Progress |
|---|---:|
| `QUEUED` | 0 |
| `LOADING_APPIUS` | 12 |
| `SYNCING_SAP` | 27 |
| `CLASSIFYING_RESPONSIBILITY` | 43 |
| `MATCHING_STOCK` | 62 |
| `FINDING_ANALOGUES` | 78 |
| `GENERATING_REPORT` | 92 |
| `COMPLETED`, `CANCELLED` | 100 |
| `FAILED` | Progress отказавшего шага; например, `SYNCING_SAP` = 27 |

### Agent citation и публичный output

```json
{
  "sourceSystem": "APPIUS|SAP|NORMATIVE|SCENARIO|REPORT",
  "entityId": "точный ID источника",
  "versionOrSnapshot": "версия или timestamp",
  "clauseId": "пункт правила либо null"
}
```

Публичная проекция assistant message намеренно содержит только итоговый текст, citations и метаданные решения:

```json
{
  "content": "Ответ на русском",
  "structuredOutput": {
    "confidence": 1,
    "requiresHumanReview": false
  },
  "citations": []
}
```

Внутренний `GroundedAgentOutput` дополнительно содержит facts, recommendations и фактические tool calls, но эта структура не сериализуется в пользовательский HTTP-контракт. Операции доступны только ADMIN в `/admin/agent-logs`; citations сохраняются отдельными rows и возвращаются в `message.citations`.

### Report summary

```json
{
  "total": 24,
  "exact": 8,
  "found": 17,
  "likely": 8,
  "review": 5,
  "noMatch": 3,
  "analogues": 3,
  "insufficient": 5,
  "procurement": 5,
  "customerResponsibility": 7,
  "contractorResponsibility": 17
}
```

Поля кроме golden `total/exact/likely/review/noMatch` зависят от выбранного scenario/scope. Не используйте пример как фиксированное значение для каждого запуска.

## Auth API

### `POST /api/auth/login`

Body строго ограничен полями `login` и `password`:

```json
{ "login": "demo", "password": "<приватно выданный пароль>" }
```

Успех `200` возвращает безопасную проекцию пользователя и `expiresAt`, а также устанавливает cookie `mtr_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, срок 12 часов; `Secure` обязателен на Vercel. В БД сохраняется только SHA-256-хеш случайного 256-битного token. Ошибочные реквизиты дают `401 INVALID_CREDENTIALS`, cross-origin browser request — `403 INVALID_ORIGIN`.

### `POST /api/auth/logout`

Body не требуется. Действующая session отзывается по хешу token, cookie очищается, ответ — `204`. Операция идемпотентна для отсутствующей или уже отозванной session; cross-origin browser request получает безопасный `403 INVALID_ORIGIN`.

Все защищённые `POST`, `PATCH`, `PUT` и `DELETE` проходят тот же central Origin gate до выполнения handler. Браузерный `Origin` обязан совпасть с `Host` или доверенным `X-Forwarded-Host`; запрос без `Origin` сохраняется для CLI/health automation, но всё равно требует действующую session и роль маршрута. `GET` и `OPTIONS` этим gate не блокируются.

## Health API

### `GET /api/health`

Endpoint не использует demo-session и предназначен для probes платформы. Query `check` принимает только `live` или `ready`; default `ready`. Все ответы имеют `Cache-Control: no-store, max-age=0`.

Liveness не обращается к БД:

```bash
curl --fail-with-body -sS 'http://localhost:3000/api/health?check=live'
```

Ответ `200`:

```json
{ "status": "ok", "check": "liveness", "service": "mtr-ai-demo" }
```

Readiness открывает БД без применения DDL, одним точным немутирующим запросом проверяет ровно 8/24/30/30:

```json
{
  "status": "ok",
  "check": "readiness",
  "service": "mtr-ai-demo",
  "database": { "status": "ok", "kind": "pglite" },
  "seed": {
    "status": "ok",
    "counts": {
      "users": 8,
      "canonicalPositions": 3584,
      "sapMaterials": 30,
      "sapBalances": 30
    }
  },
  "durationMs": 4.2
}
```

При несовпадении canonical counts ответ имеет HTTP `503`, `status: "not_ready"`, `seed.status: "mismatch"`. Ошибка соединения или отсутствующая/несовместимая schema даёт `503 unavailable` с безопасным `requestId`; endpoint не пытается выполнить migration или seed. Другое значение query возвращает `400 INVALID_HEALTH_CHECK`.

## Agent API

### `GET /api/agent/threads`

Ответ `200`:

```json
{
  "items": [
    {
      "id": "thread-...",
      "title": "Проверка остатка",
      "createdAt": "2026-08-11T20:00:00.000Z",
      "updatedAt": "2026-08-11T20:01:00.000Z",
      "version": 3
    }
  ]
}
```

Сортировка: `updatedAt` по убыванию.

### `POST /api/agent/threads`

Строгий body:

| Поле | Тип | Ограничение |
|---|---|---|
| `title` | string? | После trim `1..120`; default `Новый диалог` |

Ответ `201`: `{ "thread": AgentThread }`. `userId` в body отклоняется как неизвестное поле.

### `GET /api/agent/threads/:id/messages`

Path `id`: после trim `1..200`. Сначала проверяется принадлежность thread trusted user.

Ответ `200`: `{ "items": AgentMessage[] }`, сортировка по `createdAt`, затем `id`.

`AgentMessage`:

| Поле | Тип |
|---|---|
| `id`, `threadId`, `role`, `content`, `createdAt` | string |
| `structuredOutput` | object или `null` |
| `citations` | `GroundedCitation[]` |

Отсутствующий или чужой thread: `404 AGENT_THREAD_NOT_FOUND`.

### `POST /api/agent/threads/:id/messages`

Строгий body:

| Поле | Тип | Ограничение |
|---|---|---|
| `message` | string | После trim `1..4000` |
| `threadId` | string | `1..160`, обязателен в HTTP route и должен точно совпадать с `:id` |

Ответ `201`:

```json
{
  "items": [
    { "role": "user", "content": "...", "citations": [] },
    {
      "role": "assistant",
      "content": "...",
      "structuredOutput": { "confidence": 1, "requiresHumanReview": false },
      "citations": []
    }
  ]
}
```

Несовпадение path/body: `400 AGENT_THREAD_MISMATCH`. Сервис получает identity только вторым trusted аргументом. Prompt injection возвращает сохранённый безопасный ответ без раскрытия prompt; поле `userId` в body возвращает `400 VALIDATION_ERROR`.

Проверенный пример:

```bash
THREAD_ID=$(curl --fail-with-body -sS \
  -X POST http://localhost:3000/api/agent/threads \
  -H 'content-type: application/json' \
  --data '{"title":"Проверка API"}' \
  | jq -r '.thread.id')

curl --fail-with-body -sS \
  -X POST "http://localhost:3000/api/agent/threads/${THREAD_ID}/messages" \
  -H 'content-type: application/json' \
  --data "{\"threadId\":\"${THREAD_ID}\",\"message\":\"Какой остаток материала SAP-DEMO-0001?\"}"
```

### `POST /api/agent/messages/:id/feedback`

Path `id` — идентификатор сохранённого assistant message текущего пользователя. Чужой, пользовательский или отсутствующий message возвращает `404 AGENT_FEEDBACK_ACCESS_DENIED` без раскрытия существования.

Строгий body:

```json
{
  "feedbackKind": "INCORRECT_FORECAST",
  "summary": "Прогноз не учитывает ожидаемую поставку."
}
```

`feedbackKind` принимает `USEFUL`, `INCORRECT_FACT`, `INCORRECT_CAUSE`, `MISSING_FACTOR`, `INCORRECT_FORECAST`, `UNSUITABLE_RECOMMENDATION`, `MISSING_SOURCE`, `MISUNDERSTOOD_QUESTION` или `UNSAFE_ACTION`. `summary` необязателен, `1..500`, проходит redaction и не используется runtime как инструкция.

Ответ `201`:

```json
{
  "feedback": {
    "candidateId": "learning-...",
    "feedbackKind": "INCORRECT_FORECAST",
    "status": "QUARANTINED",
    "message": "Отзыв сохранён для проверки специалистом и не изменяет работу агента автоматически."
  }
}
```

Повтор владельца для того же assistant message возвращает тот же кандидат и не создаёт второй audit. Promotion не выполняется этим endpoint: отдельный curator lifecycle требует human approval, applicability, regression case, validation checksum и разрешение активации.

### Orchestrator commands, cases, digest, insights и actions

Новые endpoints fail-closed: без `MTR_AGENT_ORCHESTRATOR_ENABLED=true` возвращается `404`, при `MTR_AGENT_KILL_SWITCH=true` новое выполнение возвращает `503`. Actions и events дополнительно требуют собственные feature flags. Все ответы имеют `Cache-Control: private, no-store` там, где возвращают пользовательское состояние.

Команда использует строгий body `{ context, filters? }`; identity, роли, permissions, authorization version и scopes в schema отсутствуют. `context` может содержать только выбранные `projectId`, `specificationId`, `positionId`, `runId` и период. Filters зависят от ключа команды и реально применяются до retrieval. Пример:

```bash
curl --fail-with-body -sS -b "$MTR_COOKIE_JAR" \
  -X POST "$MTR_BASE_URL/api/agent/commands/STOCKS" \
  -H 'content-type: application/json' \
  --data '{"context":{"projectId":"demo-project-001"},"filters":{"materialCode":"SAP-DEMO-0001","warehouseIds":["WH-DEMO-01"]}}'
```

Успех возвращает `{ "result": PublicAgentCommandResult }`: русскую safe projection, correlation ID, confidence, `requiresHumanReview`, citations и missing-data summary без tool names, raw JSON и закрытых фильтров. Каждая команда сохраняет bounded plan из трёх шагов и correlated audit.

#### Анализ позиции `ANALYSIS`

Команда объясняет ожидаемый дефицит, строит deterministic forecast с rolling-origin backtest, сравнивает прямой остаток, одиночный/композитный аналог и закупку, затем пропускает результат через verifier. Команда read-only и всегда оставляет решение человеку.

Требуемые permissions: `agent.chat`, `analysis.read`, `specification.read`, `catalog.read`, `stock.search`.

```bash
curl --fail-with-body -sS -b "$MTR_COOKIE_JAR" \
  -X POST "$MTR_BASE_URL/api/agent/commands/ANALYSIS" \
  -H 'content-type: application/json' \
  --data '{
    "context":{"projectId":"demo-project-001","positionId":"position-portfolio-072-003"},
    "filters":{"horizonWeeks":8,"demandMultiplier":1.1,"deliveryDelayDays":7}
  }'
```

| Поле | Тип | Ограничение / default |
|---|---|---|
| `context.positionId` или `filters.positionId` | string | Требуется позиция текущего проекта; отсутствие даёт `400 AGENT_POSITION_CONTEXT_REQUIRED` |
| `filters.horizonWeeks` | integer | `1..26`, default `8` |
| `filters.demandMultiplier` | number | `0.5..3`, default `1` |
| `filters.deliveryDelayDays` | integer | `0..180`, default `0` |

`result.analysis` содержит только публичные facts/findings/drivers, forecast model и backtest metrics, не более трёх сценариев, recommendation text, limitations и next actions. `technicalTrace`, internal evidence IDs и raw engine payload отсекаются. Полные формулы, source priorities, quality gate и ограничения описаны в [семантическом слое аналитики МТР](mtr-analytics-semantic-layer.md).

`GET /api/agent/cases` возвращает только кейсы владельца в активном проекте. Завершённый `ANALYSIS` добавляет в `contextSnapshot.analysisHistory` безопасный versioned summary: dataset/semantic/forecast versions, рекомендацию, число доступных источников, ссылку на предыдущий case и признак изменения вывода. Внутренний fingerprint не сериализуется. `GET /api/agent/cases/:id` повторно проверяет resource и каждый Appius/SAP/catalog/normative evidence fact; отозванный источник скрывается, а чужой case даёт `404` без existence leak. `GET /api/agent/digest?timezone=Europe/Moscow` строит две полные календарные недели из persisted tasks, metrics и events. `GET /api/agent/insights` возвращает только активные сигналы разрешённого проекта.

Actions работают по схеме `proposal → явное confirm → повторная авторизация → идемпотентное выполнение → audit`. `POST /api/agent/actions` принимает `caseId`, allowlisted `actionType`, resource descriptor текущего проекта, безопасные summary/consequences, scalar parameters и `requestKey`. Подтверждение с изменившимся `authorizationVersion`, permission, resource status или scope отклоняется; чат сам не принимает экспертное решение.

Event ingress не использует browser session. Требуются `MTR_AGENT_EVENTS_ENABLED=true` и точное значение `x-mtr-event-secret`, совпадающее с `MTR_AGENT_EVENT_INGRESS_SECRET` длиной не менее 32 символов. Payload ограничен scalar/короткими string-array значениями, сохраняется после redaction, а `(sourceSystem, sourceEventId)` и idempotency key не позволяют создать повторный insight.

## Scenario API

### `GET /api/scenario-runs`

Ответ `200`: `{ "items": ScenarioRun[] }`. Возвращаются не более 100 последних runs trusted user. До четырёх последних незавершённых runs opportunistically планируются на сервере для восстановления после прерванного invocation.

### `POST /api/scenario-runs`

Body:

| Поле | Тип | Ограничение / default |
|---|---|---|
| `scenarioId` | string | Обязательный, `1..100` |
| `specificationId` | string? | `1..100`; seeded special value `ALL_CURRENT_SPECIFICATIONS` |
| `mode` | enum? | `NORMAL` или `DRY_RUN`; default `NORMAL` |
| `seed` | string? | `1..100`; default `BASE` |

Ответ `201`: прямой `ScenarioRun` в состоянии `QUEUED`. После отправки ответа Route Handler планирует bounded server drain через `after()`; браузер не управляет шагами. Один drain ограничен восемью успешными переходами, 24 CAS-попытками и 20 секундами, а route — `maxDuration=30`. Каждый переход и результат сохраняются до следующего.

Seeded scenario IDs:

| ID | Scope по умолчанию |
|---|---|
| `scenario-full-analysis` | Эталонные 24 актуальные позиции из трёх базовых спецификаций |
| `scenario-stock-search-only` | Все 24, сокращённая последовательность |
| `scenario-sap-failure-manual-import` | `spec-demo-piping-001`, управляемый SAP failure |
| `scenario-appius-new-version` | `spec-demo-piping-001`, транзакционное переключение current `v3 → v4`, перенос 8 позиций и аудит `NEW_VERSION_PROMOTED` |
| `scenario-insufficient-and-composite-analogues` | `spec-demo-equipment-003`, позиции аналогов |

Отключённый или неизвестный scenario: `404 SCENARIO_NOT_FOUND`; неизвестная specification: `404 SPECIFICATION_NOT_FOUND`.

### `GET /api/scenario-runs/:id`

Ответ `200`: прямой `ScenarioRun`. Незавершённый run opportunistically планируется на сервере; это self-heal после прерванного serverless invocation. Отсутствующий run: `404 RUN_NOT_FOUND`.

### `POST /api/scenario-runs/:id/advance`

Body не требуется. Optional header:

```http
If-Match: 3
```

Значение должно быть положительным safe integer. Один вызов выполняет максимум один configured step, сохраняет step, result/audit и возвращает новый `ScenarioRun`. Endpoint оставлен для ADMIN-диагностики и обратной совместимости; штатные UI-клиенты его не вызывают. Устаревшая version: `409 OPTIMISTIC_LOCK_CONFLICT`. Terminal run возвращается без новых steps.

### `POST /api/scenario-runs/:id/cancel`

Body не требуется. Активный run получает `CANCELLED`, progress `100` и persisted cancel step. Повтор terminal-aware и не добавляет новый step.

### `POST /api/scenario-runs/:id/retry`

Body не требуется. Ответ `201`: новый `QUEUED` run с другим `id`, полем `retryOfRunId` и копией immutable input snapshot; новый run немедленно планируется для server drain.

### `POST /api/scenario-runs/:id/manual-import`

Body: `{ "uploadedFileId": "upload-..." }`, длина ID `1..160`. Optional header `If-Match` содержит текущую положительную integer `version` запуска.

Разрешено только когда:

- upload принадлежит trusted user;
- `parseStatus` равен `PARSED`;
- строки повторно проходят ту же канонизацию, что validation endpoint;
- `errorCode` запуска входит в разрешённый список для источника.

| Источник | Разрешённые `errorCode` | Статус после продолжения |
|---|---|---|
| SAP | `SAP_UNAVAILABLE`, `SAP_RATE_LIMITED`, `SAP_MALFORMED_RESPONSE` | `SYNCING_SAP` |
| Appius | `APPIUS_UNAVAILABLE`, `APPIUS_STALE_VERSION` | `LOADING_APPIUS` |

`APPIUS_ACCESS_DENIED` не разрешает ручное продолжение: файл не должен обходить запрет доступа. Сервер очищает failure, атомарно увеличивает `version`, записывает audit и сохраняет канонические строки в `outputSnapshot.manualSapImport` либо `outputSnapshot.manualAppiusImport`. После ответа server drain продолжает run; именно эти строки становятся snapshot источника с `state: MANUAL_IMPORT` и `sourceKind: UPLOADED_FILE`, canonical seed вместо файла не подставляется.

Ошибки: `400 MANUAL_IMPORT_NOT_READY` или один из кодов валидации строк ниже; `409 MANUAL_IMPORT_NOT_REQUIRED`, `SPECIFICATION_NOT_FOUND` либо `OPTIMISTIC_LOCK_CONFLICT`.

## Report API

### `GET /api/reports/:runId`

Доступен только для `COMPLETED` run с корректным `outputSnapshot.report`. Ответ `200`:

| Поле | Тип |
|---|---|
| `schemaVersion` | string, сейчас `1.1.0` |
| `runId`, `scenarioId`, `generatedAt` | string |
| `user` | `Демо-пользователь 1` |
| `status` | literal `COMPLETED` |
| `summary` | `ReportSummary` |
| `results` | `PositionAnalysisResult[]` |
| `provenance` | object с Appius/SAP timestamps и normative version marker |
| `isSyntheticDemo` | literal `true` |

Базовый report snapshot создаётся последним шагом run. При каждом чтении сервис накладывает текущие persisted position results, пересчитывает summary и добавляет в provenance `latestResultVersion` и число `manualResponsibilityOverrides`. Поэтому ручное решение эксперта сразу попадает в UI и последующие exports, не стирая исходный snapshot.

Каждый позиционный результат может дополнительно содержать:

| Поле | Тип | Значение |
|---|---|---|
| `analysisVersion` | positive integer | Текущая persisted version результата |
| `manualResponsibilityOverrides` | array | История `before`, `after`, `reason`, `actor`, `occurredAt` |

`analogueCoverage` разделяет план покрытия и его совместно необходимые компоненты:

| Поле | Значение |
|---|---|
| `requiredQuantity`, `unit` | Потребность позиции |
| `primaryPlan` | Основной детерминированный план `{ coveredQuantity, complete, allocations[] }` |
| `alternativePlans` | До трёх контрфактических планов из тех же нормативно допустимых SAP-кандидатов |
| `allocations[]` | Компоненты одного плана; второй компонент составного покрытия не является альтернативой |
| top-level `coveredQuantity`, `complete`, `allocations` | Backward-compatible aliases основного плана для старых persisted reports |

Только основной план расходует run-local reservation ledger. Альтернативы рассчитываются на исходном snapshot, не меняют остатки и явно показывают неполное покрытие. UI и JSON/XLSX/PDF exports отображают иерархию «план → компоненты», характеристики, различия, количество, склад и нормативную citation.

Неготовый report: `409 REPORT_NOT_READY`.

### `GET /api/reports/:runId/export?format=...`

`format`: `json` по умолчанию, `xlsx` или `pdf`. Другие значения: `400 UNSUPPORTED_EXPORT_FORMAT`.

| Format | Content-Type | Filename |
|---|---|---|
| `json` | `application/json; charset=utf-8` | `mtr-report-<safe-run-id>.json` |
| `xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `mtr-report-<safe-run-id>.xlsx` |
| `pdf` | `application/pdf` | `mtr-report-<safe-run-id>.pdf` |

Ответ содержит `Content-Disposition: attachment`, `Cache-Control: private, no-store` и `X-Content-Type-Options: nosniff`.

### `PATCH /api/reports/:runId/results/:positionId`

Сохраняет ручное решение эксперта по ответственности в транзакции с audit event. Строгий body:

| Поле | Тип | Ограничение |
|---|---|---|
| `responsibility` | enum | `CUSTOMER` или `CONTRACTOR`; должно отличаться от текущего значения |
| `reason` | string | После trim `10..500`; используйте только синтетическую причину без ПДн |
| `expectedVersion` | positive integer? | Optional optimistic concurrency token из `analysisVersion` |

Пример:

```bash
curl --fail-with-body -sS \
  -X PATCH "http://localhost:3000/api/reports/${RUN_ID}/results/position-007" \
  -H 'content-type: application/json' \
  --data '{"responsibility":"CONTRACTOR","reason":"Синтетическая экспертная проверка результата.","expectedVersion":1}'
```

Ответ `200`:

```json
{
  "result": {
    "responsibility": "CONTRACTOR",
    "analysisVersion": 2,
    "manualResponsibilityOverrides": [
      {
        "before": "CUSTOMER",
        "after": "CONTRACTOR",
        "reason": "Синтетическая экспертная проверка результата.",
        "actor": "Демо-пользователь 1",
        "occurredAt": "2026-08-11T20:10:00.000Z"
      }
    ]
  },
  "version": 2,
  "updatedAt": "2026-08-11T20:10:00.000Z"
}
```

`result` содержит полный `PositionAnalysisResult`, а массив override включает новую запись. Возможные ошибки: `404 RESULT_NOT_FOUND`, `409 RESULT_VERSION_CONFLICT`, `409 RESULT_UNCHANGED`, `400 VALIDATION_ERROR`. Actor всегда берётся из trusted session; audit action: `POSITION_RESPONSIBILITY_OVERRIDDEN`, retention не менее одного календарного года.

## Upload и manual import API

### `POST /api/uploads`

Multipart fields:

| Поле | Тип | Ограничение |
|---|---|---|
| `file` | File | Обязателен, размер `1..10 MiB` |
| `purpose` | string? | Default `GENERAL`, сохраняются первые 80 символов в audit |

Разрешённые extensions общего upload endpoint: `.csv`, `.xlsx`, `.xls`, `.txt`, `.pdf`, `.docx`, `.png`, `.jpg`, `.jpeg`, `.tiff`. Возможность загрузить файл ещё не означает, что его можно применить к любому источнику:

| Назначение | Поддерживаемый контракт |
|---|---|
| Appius manual import | CSV/XLS/XLSX; размеченный `ключ: значение` текст; позиционные TXT/DOCX/PDF с текстовым слоем; известный hash-bound demo OCR image |
| SAP manual import | Только табличные CSV/XLS/XLSX |
| Неизвестное изображение или PDF без текстового слоя | `REVIEW_REQUIRED`; файл нельзя прикрепить к run до ручной проверки/преобразования в поддерживаемый формат |

Лимиты parser:

- CSV/XLS/XLSX: максимум 500 rows;
- PDF: максимум 100 pages;
- извлечённый текст: максимум 100 000 characters;
- формулы CSV, начинающиеся с `=`, `+`, `@` или опасного `-`, экранируются;
- два hash-bound PNG fixtures с SHA-256 `4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6` и `7ffa93f63abeed157b9d4eef41847fb041fe5aaad45b923fff4f0d5334cac098` получают `PARSED`, `kind: OCR_DEMO` и одну фиксированную синтетическую позицию;
- любое другое изображение получает `REVIEW_REQUIRED`: неизвестному хэшу OCR-текст не генерируется.

Ответ `201`:

```json
{
  "id": "upload-...",
  "parseStatus": "PARSED|REVIEW_REQUIRED",
  "normalizedData": {},
  "warnings": []
}
```

Локально original пишется в `.data/uploads`; при `VERCEL` требуется `BLOB_READ_WRITE_TOKEN`.

### `POST /api/manual-imports/specification`

Body: `{ "uploadedFileId": "upload-..." }`, ID `1..160`.

Ответ `200`:

```json
{
  "uploadedFileId": "upload-...",
  "draftId": "manual-appius-<16 chars SHA-256>",
  "positionCount": 8,
  "warnings": [],
  "sourceKind": "UPLOADED_FILE"
}
```

### `POST /api/manual-imports/sap`

Body: `{ "uploadedFileId": "upload-..." }`, ID `1..160`.

Ответ `200`:

```json
{
  "uploadedFileId": "upload-...",
  "snapshotId": "manual-sap-<16 chars SHA-256>",
  "rowCount": 8,
  "warnings": [],
  "sourceKind": "UPLOADED_FILE"
}
```

Оба endpoints канонизируют `1..500` строк. SAP endpoint поддерживает только табличные CSV/XLS/XLSX. Appius endpoint дополнительно поддерживает строки, извлечённые из TXT, DOCX и PDF с текстовым слоем:

1. Размеченные строки `ключ: значение` имеют приоритет; новая позиция начинается со следующего кода позиции.
2. Если ни одной полной размеченной позиции нет, включается позиционный parser. Каждая строка должна использовать ровно один тип разделителя — `;` или `|` — и после удаления необязательных крайних `|` содержать ровно четыре поля.
3. Поля сопоставляются только в порядке `internalCode`, `nameRu`, `requiredQuantity`, `unit`. Код и единица проходят allowlist-валидацию, количество должно быть числом `> 0` и `≤ 1 000 000 000 000`; если delimiter-shaped документ содержит хотя бы одну отклонённую строку, весь файл получает `REVIEW_REQUIRED`, счётчик отклонений и безопасное предупреждение, поэтому частичный импорт не применяется молча.
4. Текст и ячейки считаются неисполняемыми данными. Формулы и prompt-injection инструкции не выполняются и не меняют trusted user/source context.

Минимальные логические поля:

| Импорт | Обязательные поля | Допустимые основные заголовки |
|---|---|---|
| Appius | код позиции, наименование, требуемое количество `> 0`, единица | `internalCode`/`код позиции`, `nameRu`/`наименование`, `requiredQuantity`/`требуемое количество`, `unit`/`единица` |
| SAP | код материала, наименование, свободный остаток `>= 0`, единица | `materialCode`/`код материала`, `nameRu`/`наименование`, `availableQuantity`/`свободный остаток`, `unit`/`единица` |

Пример Appius:

```csv
internalCode;nameRu;requiredQuantity;unit;equipmentType;standard
APP-DEMO-MANUAL-001;Труба демонстрационная;2;M;PIPE;DEMO-STANDARD
```

Позиционный Appius TXT без заголовка:

```text
APP-DEMO-MANUAL-001;Труба демонстрационная;2;M
```

Та же позиция в DOCX или text-PDF:

```text
APP-DEMO-MANUAL-001 | Труба демонстрационная | 2 | M
```

Пример SAP:

```csv
materialCode;nameRu;availableQuantity;unit;equipmentType;plant;storageLocation;snapshotAt
SAP-DEMO-MANUAL-001;Труба демонстрационная;10;M;PIPE;PLANT-DEMO;STORAGE-DEMO;2026-08-12T10:00:00+03:00
```

`equipmentType` необязателен и по возможности выводится из наименования; нераспознанное значение становится `UNKNOWN` с warning. Для SAP отсутствующие `plant` и `storageLocation` получают явное `MANUAL-NOT-PROVIDED`, а отсутствующий `snapshotAt` — время принятия импорта. Дополнительные поля (синонимы, стандарт, материал, размеры и другие поддержанные атрибуты) сохраняются после нормализации. Коды Appius должны быть уникальны внутри файла.

Отсутствующий upload даёт `404 UPLOAD_NOT_FOUND`; status, отличный от `PARSED`, — `409 UPLOAD_REVIEW_REQUIRED`. Ошибки содержимого возвращаются с HTTP `400`: `MANUAL_IMPORT_CONTEXT_INVALID`, `MANUAL_IMPORT_EMPTY`, `MANUAL_IMPORT_ROW_LIMIT`, `MANUAL_IMPORT_ROW_INVALID`, `MANUAL_IMPORT_REQUIRED_FIELD`, `MANUAL_IMPORT_NUMBER_INVALID`, `MANUAL_IMPORT_DATE_INVALID`, а для повторяющегося Appius-кода — `APPIUS_IMPORT_DUPLICATE_CODE`.

Validation endpoint сохраняет audit/provenance и возвращает checksum-derived ID. При прикреплении к failed run строки канонизируются заново в trusted контексте этого run и затем реально используются как Appius/SAP snapshot; столбцы `userId`, access и version из файла не могут изменить server-side identity или границу доступа.

## Appius mock API

### `GET /api/mock/appius/specifications`

Ответ:

```json
{
  "specifications": [],
  "total": 3,
  "integrationState": {},
  "source": "APPIUS_MOCK",
  "isSyntheticDemo": true
}
```

Каждая specification содержит `id`, `userId`, `projectCode`, `name`, `latestVersionId`, `latestVersionNumber`, `positionCount`.

### `GET /api/mock/appius/specifications/:id/versions`

Ответ: `{ specificationId, versions, total, currentVersionId, source, isSyntheticDemo }`. Version содержит `id`, `specificationId`, `userId`, `versionNumber`, `isCurrent`, `status`, `effectiveAt`, `positionCount`.

### `GET /api/mock/appius/specifications/:id/positions`

Query:

| Параметр | Ограничение |
|---|---|
| `version` | Optional ID, максимум 120 символов; без него выбирается latest |
| `history` | `1` или `true` разрешает архивный read-only просмотр |

Ответ: `{ specificationId, versionId, history, positions, total, source: "APPIUS_MOCK", isSyntheticDemo: true }`.

Архивная версия без `history`: `409 APPIUS_STALE_VERSION`. Исторические позиции в canonical seed metadata-only, поэтому `positions` может быть пустым.

### `POST /api/mock/appius/events/new-version`

Строгий body:

| Поле | Ограничение |
|---|---|
| `eventId` | Optional string `1..200`; ключ идемпотентности события |
| `specificationId`, `previousVersionId`, `currentVersionId` | Optional string `1..120` |

```json
{
  "eventId": "appius-event:spec-demo-piping-001:v3-to-v4",
  "specificationId": "spec-demo-piping-001",
  "previousVersionId": "spec-demo-piping-001-v2",
  "currentVersionId": "spec-demo-piping-001-v3"
}
```

Без полей adapter выбирает первую доступную specification, current и одну historic version. Обработка транзакционно переводит прежнюю current version в `SUPERSEDED`, сохраняет её immutable historic snapshot, клонирует позиции в следующую version, переключает specification и пишет один audit event. Повтор с тем же `eventId` возвращает уже созданную пару версий и не создаёт следующую. Seeded сценарий хранит стабильный `eventId` исходного события в immutable configuration snapshot, поэтому повтор шага, retry и повторный запуск не создают `v5`. Ответ: `{ event, isSyntheticDemo: true }`; `event` содержит `eventType`, `previousVersionId`, `currentVersionId`, `usedVersionId`, `rejectedVersionId`, `auditCode`.

### Appius state

`GET /api/mock/admin/integrations/appius/state` возвращает `{ state, isSyntheticDemo: true }`.

`POST` принимает строгий body:

| Поле | Тип |
|---|---|
| `state` | `AVAILABLE`, `UNAVAILABLE`, `SLOW`, `ACCESS_DENIED`, `STALE_VERSION` |
| `delayMs` | Optional integer `0..10000`; для `SLOW` default 800, иначе adapter записывает 0 |

Ответ `200`: `{ state, isSyntheticDemo: true }`.

## SAP mock API

### `GET /api/mock/sap/materials/:materialCode`

`materialCode` должен соответствовать `^[A-Z0-9-]{1,120}$` без учёта регистра. Ответ: `{ materialCode, materials, total, integrationState, source: "SAP_MOCK", isSyntheticDemo: true }`.

Пустой результат: `404 SAP_MATERIAL_NOT_FOUND`.

### `GET .../A_MaterialStock`

Полный путь:

```text
/api/mock/sap/odata/sap/API_MATERIAL_STOCK_SRV/A_MaterialStock
```

Query:

| Параметр | Default | Ограничение |
|---|---:|---|
| `$filter` | пусто | Максимум 500 символов; allowlist grammar ниже |
| `$top` | 20 | Integer `1..100` |
| `$skip` | 0 | Integer `0..10000` |
| `$select` | все поля | Comma-separated allowlist |

Поддерживаемый `$filter`:

- equality `Field eq 'value'` для `Material`, `Plant`, `StorageLocation`, `Batch`, `EquipmentType`, `MaterialBaseUnit`;
- `substringof('text', Field)` грамматически принимает `MaterialName`, `MaterialNameEn` или `LegacyMaterial`, но в этом mock один текст ищется сразу по коду, RU/EN-наименованиям, legacy code и synonyms;
- разные equality-поля и один `substringof` соединяются оператором `and`; если повторить одно equality-поле или `substringof`, фактически действует последнее значение.

Одинарная кавычка внутри значения удваивается. `or`, `ne` и произвольный OData не поддерживаются.

Разрешённый `$select`:

```text
Material, MaterialName, MaterialNameEn, LegacyMaterial, EquipmentType,
Standard, MaterialGrade, Dimensions, Plant, StorageLocation, Batch,
MatlWrhsStkQtyInMatlBaseUnit, MaterialBaseUnit, SnapshotDate, MaterialCardUrl
```

Ответ:

```json
{
  "d": {
    "results": [],
    "__count": "30",
    "snapshotAt": "2026-08-11 10:30:00+03",
    "__next": "/api/mock/sap/odata/...?$skip=20"
  }
}
```

`__next` присутствует только при следующей странице. Пример с безопасным shell quoting:

```bash
curl --fail-with-body -sS \
  'http://localhost:3000/api/mock/sap/odata/sap/API_MATERIAL_STOCK_SRV/A_MaterialStock?$filter=Material%20eq%20%27SAP-DEMO-0001%27&$top=1&$select=Material,MatlWrhsStkQtyInMatlBaseUnit,SnapshotDate'
```

### SAP state и reset

`GET /api/mock/admin/integrations/sap/state` возвращает `{ state, isSyntheticDemo: true }`.

`POST` принимает строгий body:

| Поле | Тип |
|---|---|
| `state` | `AVAILABLE`, `UNAVAILABLE`, `SLOW`, `STALE`, `RATE_LIMITED`, `MALFORMED_RESPONSE` |
| `delayMs` | Optional integer `0..10000`; `SLOW` default 800 |
| `snapshotAt` | Optional ISO datetime с offset; обязателен для `STALE` |

`POST /api/mock/admin/integrations/sap/reset` не принимает body. Несмотря на SAP-specific path, текущий adapter вызывает полный `resetDemoData`: восстанавливает 24/30, integration states, prompts/dictionaries и удаляет runtime-историю demo user. Ответ: `{ reset: true, counts, state, isSyntheticDemo: true }`.

## Admin API

### `GET /api/admin/integrations`

Ответ: `{ integrations, isSyntheticDemo: true }`. Публичная projection каждого state содержит `system`, `state`, `delayMs`, nullable `snapshotAt`, `lastSynchronizedAt`, `safeMessage`, `version`; secrets/settings не возвращаются.

### `PATCH /api/admin/integrations`

Строгий body:

| Поле | Тип | Ограничение |
|---|---|---|
| `system` | enum | `APPIUS`, `SAP`, `RAG`, `LLM` |
| `state` | enum | Должен поддерживаться выбранной системой |
| `delayMs` | integer | Обязательный, `0..10000` |
| `snapshotAt` | ISO datetime или null | Обязателен для `SAP + STALE` |
| `safeMessage` | string или null | После trim максимум 240 |

Allowed states: Appius как выше; SAP как выше; RAG/LLM: `AVAILABLE`, `UNAVAILABLE`, `SLOW`, `RATE_LIMITED`, `MALFORMED_RESPONSE`.
Состояния всех четырёх систем исполняются runtime. RAG `AVAILABLE` выполняет гибридный нормативный поиск, `SLOW` добавляет контролируемую задержку, а остальные состояния дают точные коды `RAG_UNAVAILABLE`, `RAG_RATE_LIMITED` или `RAG_MALFORMED_RESPONSE` и безопасно останавливают соответствующий сценарный шаг/инструмент. LLM `AVAILABLE` и `SLOW` вызывают offline mock-provider; `LLM_UNAVAILABLE`, `LLM_RATE_LIMITED` и `LLM_MALFORMED_RESPONSE` дают безопасный ответ с `confidence: 0` и `requiresHumanReview: true`, сохраняя citations уже выполненных инструментов. Внешний LLM и API key не требуются.

Ответ: `{ integration, isSyntheticDemo: true }`.

### Prompt versions

`GET /api/admin/prompts` возвращает `{ prompts, isSyntheticDemo: true }`.

`POST /api/admin/prompts` принимает строгий body:

| Поле | Ограничение |
|---|---|
| `name` | Optional `1..80`, default `mtr-project-agent` |
| `promptVersion` | `1..32`, regex `^[0-9A-Za-z][0-9A-Za-z._-]*$` |
| `content` | После trim `40..20000` |
| `activate` | Optional boolean, default `false` |

Ответ `201`: `{ prompt, isSyntheticDemo: true }`. Повтор name/version: `409 PROMPT_VERSION_EXISTS`.

`POST /api/admin/prompts/:id/activate`: path ID `1..160`, body отсутствует. Ответ `{ prompt, isSyntheticDemo: true }`; неизвестный ID: `404 PROMPT_NOT_FOUND`.

### Dictionaries

`GET /api/admin/dictionaries?q=...`: `q` optional, после trim максимум 120. Ответ `{ dictionaries, isSyntheticDemo: true }`.

`PATCH /api/admin/dictionaries/:id`: path ID `1..160`, строгий body:

```json
{
  "values": ["синоним 1", "synonym 2"],
  "active": true,
  "version": 1
}
```

`values`: `1..50` строк, каждая после trim `1..120`; дубликаты удаляются. `active` optional; `version` обязательный positive integer. Ошибки: `404 DICTIONARY_NOT_FOUND`, `409 DICTIONARY_VERSION_CONFLICT`. Ответ `{ dictionary, isSyntheticDemo: true }`.

Активные записи типа `MTR_SEARCH_SYNONYMS` применяются уже к следующему запросу: расширяют intent/разрешение позиции агента, SAP query/ranking и токены нормативного поиска. Нормативный адаптер ранжирует только доступные и применимые versioned chunks по формуле `55% metadata + 30% deterministic semantic-like signal + 15% lexical overlap`; внешние embeddings не используются. Найденное правило содержит `retrievalEvidence` с `chunkId`, `language`, итоговым и компонентными score, а также `matchedAttributes`.

### `PATCH /api/admin/scenarios/:id`

Строгий body: `{ "enabled": true }`. Path ID `1..160`. Ответ:

```json
{
  "scenario": { "id": "...", "name": "...", "enabled": true },
  "isSyntheticDemo": true
}
```

Неизвестный ID: `404 SCENARIO_NOT_FOUND`.

### `GET /api/admin/audit`

Query:

| Параметр | Ограничение |
|---|---|
| `action` | Optional string, trim, максимум 120 |
| `entityType` | Optional string, trim, максимум 120 |
| `outcome` | `SUCCESS` или `FAILURE` |
| `limit` | Integer `1..200`, default 100 |
| `offset` | Integer `>=0`, default 0 |

Ответ:

```json
{
  "entries": [],
  "pagination": { "limit": 100, "offset": 0, "returned": 0 },
  "isSyntheticDemo": true
}
```

В `entries[].details` рекурсивно скрываются keys, похожие на authorization, cookie, password, secret, token, api key и database URL.

### `POST /api/admin/reset`

Строгий body:

```json
{ "confirmation": "RESET_DEMO_DATA" }
```

Доступен только при `APP_MODE=demo`; в development/test это default, если переменная отсутствует. Ответ:

```json
{
  "reset": true,
  "counts": {
    "canonicalPositions": 3584,
    "sapMaterials": 30,
    "sapBalances": 30
  },
  "isSyntheticDemo": true
}
```

Полный `counts` также содержит остальные seeded tables. Несовпавшие счётчики: `500 RESET_COUNT_MISMATCH`; выключенный режим: `403 RESET_DISABLED`.

## Связанные документы

- [README и карта документации](../README.md)
- [Демонстрация за 7–10 минут](demo-guide.md)
- [Эксплуатационные инструкции](operations.md)
- [Поведение МТР-аналитика](agent-behavior.md)
- [Семантический слой аналитики МТР](mtr-analytics-semantic-layer.md)
- [Трассируемость и доверительные границы МТР-агента](mtr-agent-orchestrator-traceability.md)
- [Scoped RBAC](RBAC.md)
