# Как запустить и обслуживать прототип МТР

Этот документ содержит проверенные операции для локальной разработки, БД, тестирования, управляемых отказов и ручного импорта. Описание HTTP-полей находится в [справочнике API](api-reference.md), а первый пользовательский проход - в [демонстрации за 7–10 минут](demo-guide.md).

> Прототип использует только синтетические demo-персоны со scoped RBAC. Публичный Preview необходимо закрывать средствами платформы. Не загружайте реальные контакты, персональные данные, спецификации или корпоративные правила.

## Предварительные условия

Проверьте runtime из каталога `mtr-prototype`:

```bash
node --version
pnpm --version
```

Поддерживаемые значения текущего проекта:

- Node.js `24.x`, ветка закреплена полем `engines.node`;
- pnpm `11.16.0`, версия закреплена полем `packageManager`;
- PostgreSQL не требуется для локального режима: используется PGlite.

## Как запустить прототип локально

1. Установите зависимости по lockfile:

   ```bash
   pnpm install --frozen-lockfile
   ```

2. При первом запуске создайте локальную конфигурацию:

   ```bash
   test -e .env.local || cp .env.example .env.local
   ```

   Не повторяйте `cp`, если `.env.local` уже содержит нужные локальные значения.

3. Примените checked-in миграции:

   ```bash
   node --env-file=.env.local --import tsx scripts/migrate.ts
   ```

   Ожидаемое сообщение для режима без `DATABASE_URL`:

   ```text
   Drizzle-миграции успешно применены: локальная PGlite.
   ```

4. Для чистого demo-контура запишите канонический seed:

   ```bash
   node --env-file=.env.local --import tsx scripts/seed.ts
   ```

   Скрипт заменяет demo-scoped runtime-данные. Ожидаемые счётчики: 8 субъектов, 83 спецификации / 3 584 позиции Appius, 30 материалов SAP, 30 остатков SAP. Эталонный сценарий по-прежнему использует исходные 3 спецификации / 24 позиции. Fixture manifests `identity-base-v1`, `appius-base-v1`, `appius-portfolio-v1`, `sap-base-v1` и `normative-base-v1` имеют schema `1.0.0`; `scenarios-base-v2` имеет schema `1.1.0` и содержит пять сценариев. Версия сценарного manifest не меняет контрольные counts.

5. Запустите development server:

   ```bash
   pnpm dev
   ```

6. Задайте приватный scrypt-хеш в `DEMO_PASSWORD_HASH`, откройте [http://localhost:3000](http://localhost:3000) и войдите с выданной demo-персоной. Plaintext-пароль не должен находиться в Git, `.env.example`, документации или UI.

`next dev` загружает `.env.local` сам, а обычные `tsx`-скрипты — нет. Поэтому для migrate/seed выше используется `node --env-file=.env.local --import tsx`: все три процесса обращаются к одной БД.

Для другого порта используйте фактические флаги Next.js:

```bash
pnpm dev --hostname 127.0.0.1 --port 3100
```

### Как проверить запуск без браузера

```bash
MTR_BASE_URL=http://localhost:3000
MTR_COOKIE_JAR=$(mktemp)
trap 'rm -f "$MTR_COOKIE_JAR"' EXIT

read -r -s MTR_DEMO_PASSWORD
curl --fail-with-body -sS -c "$MTR_COOKIE_JAR" \
  -X POST "$MTR_BASE_URL/api/auth/login" \
  -H 'content-type: application/json' \
  --data "$(jq -n --arg login demo --arg password "$MTR_DEMO_PASSWORD" '{login:$login,password:$password}')" >/dev/null
unset MTR_DEMO_PASSWORD

curl --fail-with-body -sS -b "$MTR_COOKIE_JAR" "$MTR_BASE_URL/api/mock/appius/specifications"
curl --fail-with-body -sS -b "$MTR_COOKIE_JAR" \
  "$MTR_BASE_URL/api/mock/sap/odata/sap/API_MATERIAL_STOCK_SRV/A_MaterialStock?\$top=1"
curl --fail-with-body -sS "$MTR_BASE_URL/api/health?check=ready"
```

Первый ответ должен содержать `total: 3`; второй - `d.__count: "30"`; readiness должен вернуть `status: "ok"` и контрольные счётчики 8/24/30/30.

## Как выбрать локальное хранилище

Драйвер выбирается только по `DATABASE_URL`:

- непустой `DATABASE_URL`: PostgreSQL через `postgres.js`;
- пустой или отсутствующий `DATABASE_URL`: PGlite;
- `PGLITE_DATA_DIR=memory://`: временная БД для теста одного процесса;
- `PGLITE_DATA_DIR=.data/pglite`: локальная durable БД из `.env.example`;
- если `PGLITE_DATA_DIR` не задан, приложение использует `.data/mtr-pglite`.

В local/test первый repository access может лениво применить migrations. В Vercel обычные authenticated runtime-чтения не выполняют DDL и не восстанавливают seed; readiness также является точной немутирующей проверкой. Demo-login имеет отдельный bootstrap fallback, который может применить migration и исправить только отсутствующий/неполный canonical seed; повторные проверки дедуплицируются на 5 минут, а explicit seed/reset инвалидируют cache. Для предсказуемой эксплуатации всегда выполняйте migration явно: локально — через `node --env-file=.env.local --import tsx scripts/migrate.ts`, в CI/deploy job — через `pnpm db:migrate` с уже внедрёнными environment variables.

### Как проверить миграцию и seed без изменения локальной БД

```bash
PGLITE_DATA_DIR=memory:// pnpm db:migrate
PGLITE_DATA_DIR=memory:// pnpm db:seed
PGLITE_DATA_DIR=memory:// pnpm db:reset
```

Каждая команда создаёт свой in-memory процесс и завершается после проверки. Этот режим подходит для smoke-команд, но не сохраняет состояние между ними.

## Как подключить PostgreSQL

1. Передайте `DATABASE_URL` процессу через локальный secret store или окружение CI. Не записывайте connection string в Git, документацию, логи или shell history.
2. Убедитесь, что переменная непустая:

   ```bash
   test -n "${DATABASE_URL:-}"
   ```

3. Примените миграции:

   ```bash
   pnpm db:migrate
   ```

4. На новой отдельной demo-БД один раз выполните seed:

   ```bash
   pnpm db:seed
   ```

`db:seed` заменяет синтетические demo-scoped данные и не является production migration. Для Preview и Production нужны разные БД или схемы; безопасная последовательность приведена в [руководстве по развёртыванию](deployment.md#migrations-и-первичный-seed).

## Как безопасно восстановить demo-набор

### Через локальную CLI

Остановите development server, затем выполните:

```bash
node --env-file=.env.local --import tsx scripts/reset.ts
```

Reset атомарно удаляет runs, steps, результаты, uploads metadata, agent threads/messages, аудит и изменённые настройки только для `demo-user-001`, после чего возвращает canonical seed.

### Через интерфейс

1. Откройте `/admin/audit`.
2. Подтвердите, что понимаете удаление demo-истории.
3. Нажмите **Восстановить базовый набор**.

UI вызывает защищённый session API. Эквивалентная CLI-команда использует cookie jar из раздела [проверки запуска](#как-проверить-запуск-без-браузера):

```bash
curl --fail-with-body -sS \
  -b "$MTR_COOKIE_JAR" \
  -X POST "$MTR_BASE_URL/api/admin/reset" \
  -H 'content-type: application/json' \
  --data '{"confirmation":"RESET_DEMO_DATA"}'
```

API доступен только при `APP_MODE=demo`. Успешный ответ подтверждает `specifications: 83`, `canonicalPositions: 3584`, `sapMaterials: 30`, `sapBalances: 30`.

### Защита удалённого reset

CLI блокирует reset при непустом `DATABASE_URL`. Для осознанного восстановления отдельной удалённой demo-БД требуется явный флаг. Если `DATABASE_URL` уже внедрён в process:

```bash
ALLOW_REMOTE_RESET=true pnpm db:reset
```

Если адрес хранится только в локальном `.env.local`:

```bash
ALLOW_REMOTE_RESET=true node --env-file=.env.local --import tsx scripts/reset.ts
```

Это разрушающая операция для demo-scoped истории. Сначала проверьте target БД и убедитесь, что она не используется Production.

## Как выполнить полную локальную проверку

### Основной gate

```bash
pnpm check
```

Фактическая последовательность: ESLint, Next route type generation + TypeScript, все Vitest-тесты, privacy scan, 34 deterministic eval-кейса агента, production build.

### Полный release gate

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm privacy:scan
pnpm eval:agent
pnpm build
pnpm test:e2e
```

`test:e2e` запускает приложение на `127.0.0.1:3100` и выполняет проекты `chromium-desktop` и `chromium-mobile`. Если порт занят:

```bash
PORT=3200 pnpm test:e2e
```

Privacy scan проверяет `src`, `docs`, `fixtures`, `public`, `drizzle` и `README.md` на email, российские номера телефонов и запрещённые маркеры. Он не печатает найденное чувствительное значение.

### Как запустить production bundle локально

Проект собирается с `output: "standalone"`. После build скопируйте не входящие в standalone bundle статические каталоги и запустите сгенерированный server:

```bash
pnpm build
mkdir -p .next/standalone/public .next/standalone/.next/static
cp -R public/. .next/standalone/public/
cp -R .next/static/. .next/standalone/.next/static/
PORT=3100 HOSTNAME=127.0.0.1 \
  node --env-file=.env.local .next/standalone/server.js
```

`pnpm build` завершает сборку скриптом `scripts/verify-pdf-runtime-assets.ts`. Gate проверяет, что свежий NFT trace PDF-export route содержит top-level Cyrillic и Latin Noto Sans WOFF, а в standalone-режиме — что оба файла физически присутствуют в `.next/standalone/node_modules/...`. Для повторной проверки уже собранного артефакта без новой сборки выполните `pnpm exec tsx scripts/verify-pdf-runtime-assets.ts`; отсутствие любого runtime asset завершает команду с ошибкой.

После запуска повторите login и три curl-smoke из раздела [проверки запуска](#как-проверить-запуск-без-браузера).

## Как проверить полный сценарий через API

Для команд ниже нужен `jq`. Development server должен работать на порту `3000`, а переменные `MTR_BASE_URL` и `MTR_COOKIE_JAR` должны быть созданы login-командами из раздела [проверки запуска](#как-проверить-запуск-без-браузера).

1. Создайте запуск:

   ```bash
   RUN_ID=$(curl --fail-with-body -sS \
     -b "$MTR_COOKIE_JAR" \
     -X POST "$MTR_BASE_URL/api/scenario-runs" \
     -H 'content-type: application/json' \
     --data '{"scenarioId":"scenario-full-analysis","specificationId":"ALL_CURRENT_SPECIFICATIONS","mode":"NORMAL","seed":"BASE"}' \
     | jq -r '.id')
   ```

2. Сервер сам продолжает run после ответа `201`. Опрашивайте сохранённое состояние; клиентский `/advance` для обычного выполнения не нужен:

   ```bash
   while true; do
     RUN_JSON=$(curl --fail-with-body -sS -b "$MTR_COOKIE_JAR" \
       "$MTR_BASE_URL/api/scenario-runs/${RUN_ID}")
     echo "$RUN_JSON" | jq '{id,status,currentStep,progress,version}'
     RUN_STATUS=$(echo "$RUN_JSON" | jq -r '.status')
     case "$RUN_STATUS" in COMPLETED|FAILED|CANCELLED) break ;; esac
     sleep 0.5
   done
   ```

3. Для базового сценария ожидается `COMPLETED`. Шаги исполняются bounded server drain, сохраняются атомарно и продолжаются даже после закрытия вкладки. Совместимый ADMIN endpoint `/advance` оставлен для диагностики и CAS-тестов, но UI его не вызывает.
4. Проверьте отчёт:

   ```bash
   curl --fail-with-body -sS \
     -b "$MTR_COOKIE_JAR" \
     "$MTR_BASE_URL/api/reports/${RUN_ID}" \
     | jq '.summary | {total,exact,likely,review,noMatch,analogues}'
   ```

Ожидается `total=24`, `exact=8`, `likely=8`, `review=5`, `noMatch=3`.

Если диагностический `advance` или manual import получает устаревший `If-Match`, сервер возвращает `409 OPTIMISTIC_LOCK_CONFLICT`. Перечитайте run и возьмите новую `version`.

Для `scenario-appius-new-version` сначала восстановите canonical seed. Успешный run переводит `spec-demo-piping-001-v3` в `SUPERSEDED`, создаёт current `spec-demo-piping-001-v4` с теми же 8 позициями и пишет `appius.new_version.promoted` / `NEW_VERSION_PROMOTED`. Стабильный `eventId` исходного события хранится в scenario snapshot: повтор шага, retry и повторный запуск возвращают ту же пару `v3 → v4`, не создавая `v5`. Явный reset снова восстанавливает canonical `v3` и позволяет повторно воспроизвести promotion.

## Как проверить cancel и retry

Для активного `${RUN_ID}`:

```bash
curl --fail-with-body -sS \
  -b "$MTR_COOKIE_JAR" \
  -X POST "$MTR_BASE_URL/api/scenario-runs/${RUN_ID}/cancel" \
  | jq '{id,status,progress,version}'
```

Повторный cancel возвращает тот же terminal run. Retry не изменяет исходную историю, а создаёт новый `QUEUED` run:

```bash
curl --fail-with-body -sS \
  -b "$MTR_COOKIE_JAR" \
  -X POST "$MTR_BASE_URL/api/scenario-runs/${RUN_ID}/retry" \
  | jq '{id,retryOfRunId,status,version}'
```

## Как проверить отказ Appius/SAP и ручной импорт

Ручной recovery разрешён только для `SAP_UNAVAILABLE`, `SAP_RATE_LIMITED`, `SAP_MALFORMED_RESPONSE`, `APPIUS_UNAVAILABLE` и `APPIUS_STALE_VERSION`. `APPIUS_ACCESS_DENIED` нельзя обойти загрузкой файла.

### В интерфейсе

1. Для SAP оставьте интеграцию в `AVAILABLE`: seeded-сценарий сам создаст `SAP_UNAVAILABLE`. Для Appius установите на `/admin/integrations` состояние `UNAVAILABLE` или `STALE_VERSION`, затем запустите подходящий сценарий.
2. Откройте `/admin/scenarios`.
3. Для SAP выберите **Отказ SAP и ручной импорт**; для Appius можно использовать обычный анализ выбранной спецификации.
4. После допустимого `FAILED` откройте run.
5. Для SAP подготовьте только синтетический CSV/XLS/XLSX с обязательными полями источника. Например, CSV:

   ```csv
   materialCode;nameRu;availableQuantity;unit;equipmentType;plant;storageLocation;snapshotAt
   SAP-DEMO-MANUAL-001;Труба демонстрационная;10;M;PIPE;PLANT-DEMO;STORAGE-DEMO;2026-08-12T10:00:00+03:00
   ```

   Appius принимает тот же табличный CSV/XLS/XLSX-контракт:

   ```csv
   internalCode;nameRu;requiredQuantity;unit;equipmentType;standard
   APP-DEMO-MANUAL-001;Труба демонстрационная;2;M;PIPE;DEMO-STANDARD
   ```

   Для Appius также допустим позиционный TXT без заголовка:

   ```text
   APP-DEMO-MANUAL-001;Труба демонстрационная;2;M
   ```

   или строка в DOCX/PDF с текстовым слоем:

   ```text
   APP-DEMO-MANUAL-001 | Труба демонстрационная | 2 | M
   ```

6. В блоке **Продолжить через ручной импорт** выберите файл. Appius UI предлагает `.csv,.xls,.xlsx,.txt,.pdf,.docx,.jpeg,.jpg,.png,.tiff`; SAP UI — только `.csv,.xls,.xlsx`. Загрузка и продолжение начнутся автоматически только для `PARSED` файла.
7. Дождитесь `COMPLETED`. В `outputSnapshot.appius` или `outputSnapshot.sap` должны быть именно строки файла, `state: MANUAL_IMPORT` и `sourceKind: UPLOADED_FILE`.

Для Appius обязательны код позиции, наименование, требуемое количество `> 0` и единица; позиционная строка должна использовать только один разделитель (`;` либо `|`) и содержать ровно эти четыре поля в указанном порядке. Размеченный формат `ключ: значение` имеет приоритет. Неоднозначный/неполный текст, смесь допустимых и отклонённых позиционных строк, PDF без текстового слоя и неизвестное изображение получают `REVIEW_REQUIRED`; partial import не применяется, предупреждение сообщает только число отклонений и не раскрывает содержимое строки. Только два известных demo PNG hash дают фиксированный синтетический OCR. Для SAP обязательны код материала, наименование, свободный остаток `>= 0` и единица, а fallback остаётся строго табличным CSV/XLS/XLSX. Допускаются английские заголовки из примеров и русские эквиваленты `код позиции`/`код материала`, `наименование`, `требуемое количество`/`свободный остаток`, `единица`. Сервер валидирует и канонизирует каждую строку, повторно делает это при resume и сохраняет checksum, фактические данные и warnings в run. Формулы и prompt-injection инструкции остаются неисполняемыми данными; `userId`, access и version всегда формируются из trusted server context, а не из файла.

### Через API

После создания failed run задайте абсолютный путь к синтетическому файлу. Для SAP:

```bash
SAP_IMPORT_FILE=/absolute/path/to/synthetic-sap-demo.csv

UPLOAD_ID=$(curl --fail-with-body -sS \
  -b "$MTR_COOKIE_JAR" \
  -X POST "$MTR_BASE_URL/api/uploads" \
  -F 'purpose=SAP_MANUAL_IMPORT' \
  -F "file=@${SAP_IMPORT_FILE}" \
  | jq -r '.id')

curl --fail-with-body -sS \
  -b "$MTR_COOKIE_JAR" \
  -X POST "$MTR_BASE_URL/api/manual-imports/sap" \
  -H 'content-type: application/json' \
  --data "{\"uploadedFileId\":\"${UPLOAD_ID}\"}"

RUN_VERSION=$(curl --fail-with-body -sS \
  -b "$MTR_COOKIE_JAR" \
  "$MTR_BASE_URL/api/scenario-runs/${RUN_ID}" \
  | jq -r '.version')

curl --fail-with-body -sS \
  -b "$MTR_COOKIE_JAR" \
  -X POST "$MTR_BASE_URL/api/scenario-runs/${RUN_ID}/manual-import" \
  -H 'content-type: application/json' \
  -H "if-match: ${RUN_VERSION}" \
  --data "{\"uploadedFileId\":\"${UPLOAD_ID}\"}"
```

Для Appius используйте `purpose=APPIUS_MANUAL_IMPORT`, вызовите `/api/manual-imports/specification`, а затем тот же `/api/scenario-runs/${RUN_ID}/manual-import` с актуальным `If-Match`. Validation response содержит `sourceKind: UPLOADED_FILE` и checksum-derived `manual-sap-*` либо `manual-appius-*` ID. После resume сервер сам продолжает run; опрашивайте его тем же GET-циклом, не вызывая `/advance` из браузера.

Ошибки пустого файла, отсутствующих полей, неверного числа/даты и дублирующегося Appius-кода возвращаются как `MANUAL_IMPORT_*` или `APPIUS_IMPORT_DUPLICATE_CODE`; полный перечень приведён в [справочнике API](api-reference.md#upload-и-manual-import-api).

## Как управлять интеграционными отказами

Через `/admin/integrations` доступны:

- Appius: `AVAILABLE`, `UNAVAILABLE`, `SLOW`, `ACCESS_DENIED`, `STALE_VERSION`;
- SAP: `AVAILABLE`, `UNAVAILABLE`, `SLOW`, `STALE`, `RATE_LIMITED`, `MALFORMED_RESPONSE`;
- RAG и LLM: `AVAILABLE`, `UNAVAILABLE`, `SLOW`, `RATE_LIMITED`, `MALFORMED_RESPONSE`.

Integration states всех четырёх систем исполняются runtime. RAG `SLOW` добавляет контролируемую задержку гибридного нормативного поиска; `UNAVAILABLE`, `RATE_LIMITED` и `MALFORMED_RESPONSE` дают точный `RAG_*` failure без придуманного правила. LLM `SLOW` задерживает offline mock-provider; остальные отказные состояния дают безопасный `LLM_*` fallback с `confidence: 0`, `requiresHumanReview: true` и сохранёнными citations уже выполненных инструментов. После проверки верните состояние в `AVAILABLE`, иначе последующие demo-сценарии и запросы агента продолжат воспроизводить отказ.

Пример безопасного переключения SAP:

```bash
curl --fail-with-body -sS \
  -b "$MTR_COOKIE_JAR" \
  -X PATCH "$MTR_BASE_URL/api/admin/integrations" \
  -H 'content-type: application/json' \
  --data '{"system":"SAP","state":"UNAVAILABLE","delayMs":0,"safeMessage":"SAP временно недоступна в демонстрационном сценарии."}'
```

Вернуть доступность:

```bash
curl --fail-with-body -sS \
  -b "$MTR_COOKIE_JAR" \
  -X PATCH "$MTR_BASE_URL/api/admin/integrations" \
  -H 'content-type: application/json' \
  --data '{"system":"SAP","state":"AVAILABLE","delayMs":0}'
```

## Как проверить AI-агента через API

```bash
THREAD_ID=$(curl --fail-with-body -sS \
  -b "$MTR_COOKIE_JAR" \
  -X POST "$MTR_BASE_URL/api/agent/threads" \
  -H 'content-type: application/json' \
  --data '{"title":"Проверка остатка"}' \
  | jq -r '.thread.id')

curl --fail-with-body -sS \
  -b "$MTR_COOKIE_JAR" \
  -X POST "$MTR_BASE_URL/api/agent/threads/${THREAD_ID}/messages" \
  -H 'content-type: application/json' \
  --data "{\"threadId\":\"${THREAD_ID}\",\"message\":\"Какой остаток материала SAP-DEMO-0001?\"}" \
  | jq '.items[1] | {content,citations,confidence:.structuredOutput.confidence,requiresHumanReview:.structuredOutput.requiresHumanReview}'
```

Ожидаются citations `SAP`, уверенность и признак экспертной проверки. Публичный ответ намеренно не содержит `toolCalls`, аргументы или технический JSON; фактический `sap.getMaterialStock` доступен ADMIN на `/admin/agent-logs`. Поле `userId` отсутствует во входной схеме. Если добавить его в JSON, строгая схема вернёт `400 VALIDATION_ERROR`; идентификатор из текста сообщения также не меняет доверенную server session.

### Как включить и проверить оркестратор 3.0.0

После применения migrations `0006_mtr_agent_orchestrator` и `0007_mtr_agent_learning` включайте возможности независимо:

```dotenv
MTR_AGENT_ORCHESTRATOR_ENABLED=true
MTR_AGENT_ACTIONS_ENABLED=true
MTR_AGENT_EVENTS_ENABLED=false
MTR_AGENT_KILL_SWITCH=false
```

Основной флаг включает единый `CHAT / COMMAND` runtime, кейсы, bounded plans, недельную сводку и чтение insights. Actions требуют второго флага. Event ingress оставляйте выключенным, пока не настроен отдельный service secret. Любой новый флаг по умолчанию `false`; `MTR_AGENT_KILL_SWITCH=true` имеет приоритет и останавливает новое выполнение без удаления уже сохранённых данных.

`0007` не требует отдельного feature flag: endpoint обратной связи доступен только
владельцу сохранённого ответа с `agent.chat`, а запись всегда создаётся в
`QUARANTINED`. Одобрение, продвижение, отклонение и отзыв выполняются отдельным
curation-сервисом с повторной проверкой `review.decide` / `prompt.activate`,
контрольной суммой regression-кейса и durable audit. Ни отправка отзыва, ни его
одобрение сами по себе не изменяют поведение runtime.

Проверьте typed-команду через ту же session:

```bash
curl --fail-with-body -sS -b "$MTR_COOKIE_JAR" \
  -X POST "$MTR_BASE_URL/api/agent/commands/SUMMARY" \
  -H 'content-type: application/json' \
  --data '{"context":{"projectId":"demo-project-001"}}' \
  | jq '.result | {title,summary,confidence,requiresHumanReview,correlationId}'
```

В `/mtr-analysis` должны появиться пять быстрых команд, личные кейсы, недельная сводка, сигналы и предложения действий. Тот же runtime использует глобальный виджет. После смены demo-роли widget закрывается и очищает client-only thread context до навигации. `/admin/agent-logs` отдельно показывает persisted метрики команд, планов, действий и событий; личный текст сообщения, event payload и raw tool result метрики не читают.

Для event ingress задайте `MTR_AGENT_EVENT_INGRESS_SECRET` длиной не менее 32 символов через secret manager и только затем включите `MTR_AGENT_EVENTS_ENABLED=true`. Внешний отправитель обязан передавать secret в `x-mtr-event-secret`; браузерный JavaScript его не получает.

## Как подготовить cloud environment

Для Vercel или другого serverless-окружения задайте:

- Project Root: `mtr-prototype`;
- Install Command: `pnpm install --frozen-lockfile`;
- Build Command: `pnpm build`;
- `DATABASE_URL`: отдельная durable PostgreSQL БД;
- `BLOB_READ_WRITE_TOKEN`: private Blob storage для uploads;
- `LLM_PROVIDER=mock`;
- `APP_MODE=demo` только для защищённого demo-контура;
- `DEMO_USER_ID=demo-user-001`.
- `DEMO_PASSWORD_HASH`: приватный scrypt-хеш через secret manager;
- orchestrator flags из предыдущего раздела; при первом rollout начать с основного runtime, затем отдельно actions/events.

Перед запуском новой сборки примените `pnpm db:migrate` к целевой БД отдельной controlled job. Локальная PGlite и `.data/uploads` не являются durable storage на Vercel. Production и Preview не должны разделять БД, Blob namespace или credentials.

Не выполняйте `vercel env run -e production` при существующем `.env.local`: локальные значения могут получить приоритет и направить job в Preview database. Используйте fail-safe block из [руководства по развёртыванию](deployment.md#migrations-и-первичный-seed), сверяйте non-secret `NEON_PROJECT_ID`, а после job проверяйте readiness 8/24/30/30.

## Устранение неполадок

| Симптом | Причина | Действие |
|---|---|---|
| `Каталог Drizzle-миграций не найден` | Команда запущена не из `mtr-prototype` либо каталог `drizzle/` отсутствует | Перейдите в корень приложения; проверьте `drizzle/meta/_journal.json` и `drizzle/*.sql` |
| `EADDRINUSE` | Порт уже занят | Выполните `pnpm dev --hostname 127.0.0.1 --port 3100` |
| Readiness возвращает `503 not_ready` | Миграции применены, но canonical seed отсутствует или повреждён | На отдельной demo-БД выполните `pnpm db:seed`; для сохранения истории сначала исследуйте расхождение |
| Production readiness показывает `0/0/0/0` после успешного seed | `vercel env run` подхватил локальный `.env.local` и job ушла в другую БД | Не повторяйте seed вслепую; сравните `NEON_PROJECT_ID`, уберите локальный env через fail-safe block и выполните job для точного target |
| Upload на Vercel возвращает 500 | Нет `BLOB_READ_WRITE_TOKEN` | Создайте private Blob store и добавьте token в environment проекта |
| `REPORT_NOT_READY` | Run не достиг `COMPLETED` | Опрашивайте run и дождитесь серверного завершения; при прерванном invocation GET безопасно перепланирует продолжение |
| `OPTIMISTIC_LOCK_CONFLICT` | Передана устаревшая version | Выполните `GET /api/scenario-runs/:id`, затем повторите действие с новым `If-Match` |
| `RESET_DISABLED` | `APP_MODE` не равен `demo` | Не включайте reset в production; для защищённого demo задайте `APP_MODE=demo` |
| `Удалённый reset заблокирован` | Задан `DATABASE_URL`, но нет явного разрешения | Сначала проверьте target; только для отдельной demo-БД используйте `ALLOW_REMOTE_RESET=true pnpm db:reset` |
| `APPIUS_STALE_VERSION` | Запрошена архивная версия без history mode | Добавьте `history=1` только для просмотра; для анализа используйте latest |
| `SAP_RATE_LIMITED` или `SAP_MALFORMED_RESPONSE` | Включён управляемый mock-отказ | Используйте валидный ручной SAP import или верните `AVAILABLE` и создайте retry |
| `APPIUS_UNAVAILABLE` или `APPIUS_STALE_VERSION` | Appius не дал актуальную спецификацию | Используйте валидный ручной Appius import или восстановите источник; `APPIUS_ACCESS_DENIED` ручной импорт не разрешает |
| `RAG_*` или безопасный `LLM_*` fallback | Admin-state реально применяется runtime | Проверьте audit и управляемый state; после теста верните `AVAILABLE` |
| Изображение имеет `REVIEW_REQUIRED` | SHA-256 не входит в два известных demo OCR hash; универсальный OCR не подключён | Для Appius используйте CSV/XLS/XLSX или структурированный TXT/DOCX/text-PDF; для SAP — CSV/XLS/XLSX. Неизвестному изображению OCR не придумывается |
| Privacy scan завершился ошибкой | Найден тип контакта или запрещённый маркер | Удалите значение из проекта; scan намеренно не печатает сам секрет |

## Связанные документы

- [README и карта документации](../README.md)
- [Демонстрация за 7–10 минут](demo-guide.md)
- [Справочник HTTP API](api-reference.md)
- [Поведение AI-агента](agent-behavior.md)
- [Развёртывание и persistence](deployment.md)
- [Трассируемость МТР-агента](mtr-agent-orchestrator-traceability.md)
