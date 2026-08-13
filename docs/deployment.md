# Развёртывание прототипа МТР

Документ описывает три поддерживаемых контура: локальный PGlite, Vercel и
single-host on-premise на Docker Compose. Это демонстрационный прототип с несколькими
синтетическими RBAC-персонами. Docker Compose не является промышленной аттестацией и не заменяет
корпоративные SSO, backup/PITR, SIEM, secret store, антивирус, mTLS и регламент UAT.

## 1. Матрица окружений

| Контур | База | Файлы | Назначение |
|---|---|---|---|
| Local | PGlite в `.data/pglite` | `.data/uploads` | автономная разработка и демонстрация |
| Vercel Preview | отдельная managed PostgreSQL database/branch | отдельный Vercel Blob store | временная проверка ветки |
| Vercel Production | отдельная production PostgreSQL database | отдельный production Blob store | production-демонстрация |
| On-premise pilot | PostgreSQL 16 в Compose или внешний PostgreSQL/Postgres Pro | persistent volume `.data/uploads` | один защищённый хост за reverse proxy |

Preview и Production не должны использовать общие `DATABASE_URL` или
`BLOB_READ_WRITE_TOKEN`. PGlite не подходит для Vercel: файловая система Functions
не является устойчивым хранилищем.

## 2. Переменные окружения

| Переменная | Local | Vercel | On-premise | Назначение |
|---|---:|---:|---:|---|
| `DATABASE_URL` | необязательна | обязательна | обязательна | PostgreSQL connection string; для Vercel использовать pooled URL |
| `PGLITE_DATA_DIR` | `.data/pglite` | не задавать | не задавать при PostgreSQL | локальная PGlite |
| `BLOB_READ_WRITE_TOKEN` | необязательна | обязательна | не задавать для single-host volume | Vercel Blob uploads |
| `LLM_PROVIDER` | `mock` | `mock` | `mock` | детерминированный провайдер без внешнего LLM |
| `APP_MODE` | `demo` | `demo` | `demo` или `production` | reset доступен только в `demo` |
| `SESSION_COOKIE_SECURE` | необязательна | включается автоматически по `VERCEL` | `true` за TLS reverse proxy | принудительный `Secure` для HttpOnly session cookie |
| `DEMO_PASSWORD_HASH` | secret, обязателен | secret, обязателен | secret, обязателен | scrypt-хеш общего demo-пароля; plaintext и реальный хеш не публикуются |
| `MTR_AGENT_ORCHESTRATOR_ENABLED` | `false` | explicit | explicit | единый runtime агента после миграции `0006` |
| `MTR_AGENT_ACTIONS_ENABLED` | `false` | explicit | explicit | подтверждаемые действия агента |
| `MTR_AGENT_EVENTS_ENABLED` | `false` | explicit | explicit | event ingress и proactive insights |
| `MTR_AGENT_KILL_SWITCH` | `false` | operational | operational | аварийно запрещает новое выполнение |
| `MTR_AGENT_EVENT_INGRESS_SECRET` | optional | secret | secret | минимум 32 символа, только для event ingress |

Demo-реквизиты выдаются владельцу контура приватно и не отображаются на `/login`; БД хранит scrypt-хеш пароля и SHA-256-хеш opaque session token. Секреты задаются через локальный `.env.local`, Vercel Environment Variables или
корпоративный secret store. Их нельзя помещать в image layers, Git, build arguments,
логи и команды, сохраняемые shell history. Не задавайте `LLM_API_KEY` для mock-режима.

## 3. Health checks

- `GET /api/health?check=live` проверяет, что Node.js/Next.js процесс отвечает, и не
  обращается к БД.
- `GET /api/health?check=ready` проверяет доступ к БД и канонический seed:
  `users=8`, `Appius specifications=83`, `Appius positions=3584`, `SAP materials=30`, `SAP balances=30`.
- Readiness возвращает HTTP `503`, если БД недоступна или контрольные количества не
  совпали. Ответ не содержит connection string, токены или текст внутренней ошибки.
- Состояния моков Appius/SAP/RAG/LLM не смешиваются с инфраструктурной readiness;
  они проверяются в админке интеграций.

Health endpoint не заменяет controlled migration/seed job. Readiness всегда
немутирующая: она открывает соединение без DDL, одним точным запросом читает counts и
возвращает `503`, если schema отсутствует или seed не совпадает. Обычные authenticated
Vercel runtime-чтения также не применяют migrations и не восстанавливают seed.

Demo-login имеет отдельный bootstrap fallback: он может применить checked-in migrations
и восстановить только неполный canonical seed. Результат дедуплицируется на 5 минут,
а explicit seed/reset инвалидируют cache. Это страховка синтетической демонстрации, а
не замена controlled `pnpm db:migrate` и не production identity-паттерн.

## 4. Local с PGlite

Требования: Node.js 24.x и pnpm 11.16.0.

```bash
cd mtr-prototype
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Первый `db:seed` создаёт ровно 8/24/30/30 и пять сценариев. Четыре fixture manifests
(`identity-base-v1`, `appius-base-v1`, `sap-base-v1`, `normative-base-v1`) используют
schema `1.0.0`; сценарный manifest `scenarios-base-v2` использует schema `1.1.0`.
Повторный `db:seed` атомарно заменяет все данные Демо-пользователя, включая runs и
audit, поэтому это не deploy-hook. Для проверки:

```bash
curl --fail --silent --show-error 'http://127.0.0.1:3000/api/health?check=ready'
pnpm benchmark
```

Локальные данные удаляются только осознанным `pnpm db:reset`. Удалённый reset
скриптом заблокирован, пока оператор явно не задаст `ALLOW_REMOTE_RESET=true`.

## 5. Vercel Preview и Production

### 5.1 Настройки проекта

При импорте Git-репозитория укажите:

- Framework Preset: Next.js;
- Root Directory: `mtr-prototype`;
- Node.js: 24.x, также закреплено в `package.json`;
- Install Command: `pnpm install --frozen-lockfile`;
- Build Command: `pnpm build`;
- Output Directory: оставить автоматическое значение Next.js.

Build command после `next build` автоматически выполняет
`scripts/verify-pdf-runtime-assets.ts`. Скрипт требует exact top-level Cyrillic и Latin
Noto Sans WOFF в свежем NFT trace PDF-export route; вне Vercel он дополнительно
проверяет физическое наличие обоих assets в standalone bundle. Успешный Next.js build
без этих runtime-файлов не считается успешным deploy artifact.

Включите Deployment Protection как минимум для Preview. Прототип предоставляет
нескольким scoped demo-персонам, но публичный незакрытый URL всё равно раскрывает синтетический контур и поверхность входа.

### 5.2 Раздельные данные

1. Через Vercel Marketplace подключите managed PostgreSQL provider. Приложение читает
   именно `DATABASE_URL`; если integration создаёт переменную с другим именем,
   сопоставьте pooled connection string с `DATABASE_URL`.
2. Создайте отдельную database/branch для Preview-ветки и отдельную database для
   Production. Выберите регион рядом с Vercel Functions.
3. Создайте отдельные Blob stores для Preview и Production.
4. В Project Settings → Environment Variables назначьте каждой среде собственные
   `DATABASE_URL` и `BLOB_READ_WRITE_TOKEN`.
5. Для обеих сред задайте `LLM_PROVIDER=mock` и `APP_MODE=demo`. Production prototype
   с рабочим reset должен оставаться защищённым Deployment Protection.
6. Задайте `DEMO_PASSWORD_HASH` как encrypted environment variable. Не добавляйте plaintext или реальный hash в Git.
7. Первый rollout оркестратора выполняйте после migration `0006`: сначала `MTR_AGENT_ORCHESTRATOR_ENABLED=true`, затем независимо actions/events. Для event ingress нужен отдельный `MTR_AGENT_EVENT_INGRESS_SECRET` ≥32 символов. Kill switch оставьте `false`, но подготовьте операционную процедуру его включения.

Изменённые environment variables действуют только для новых deployments; после
ротации credentials выполните redeploy.

### 5.3 Migrations и первичный seed

Команды запускаются из связанного каталога `mtr-prototype`. Важный gate: существующий
`.env.local` может иметь приоритет над значениями, полученными `vercel env run`, и
незаметно направить production-команду в Preview database. Используйте чистый checkout
без `.env.local` либо выполняйте целиком следующий fail-safe block. Он временно убирает
локальный файл и восстанавливает его через `trap` даже при ошибке:

```bash
set -e
MTR_TARGET=preview # либо production
mtr_env_backup_dir=$(mktemp -d)
mtr_env_backup_file="$mtr_env_backup_dir/env.local"
if [ -f .env.local ]; then mv .env.local "$mtr_env_backup_file"; fi
mtr_restore_env() {
  if [ -f "$mtr_env_backup_file" ]; then mv "$mtr_env_backup_file" .env.local; fi
  rmdir "$mtr_env_backup_dir" 2>/dev/null || true
}
trap mtr_restore_env EXIT

vercel env run -e "$MTR_TARGET" -- node -e \
  'console.log({target: process.env.NEON_PROJECT_ID, database: process.env.POSTGRES_DATABASE})'
vercel env run -e "$MTR_TARGET" -- pnpm db:migrate
# Только для новой пустой demo-базы:
vercel env run -e "$MTR_TARGET" -- pnpm db:seed
```

`db:seed` выполняется один раз для новой пустой demo-базы. На последующих релизах
выполняйте только `db:migrate`: seed удаляет runtime-историю Демо-пользователя.
Сверьте напечатанный non-secret target с ресурсом среды. Миграция должна завершиться
до переключения production traffic; после seed readiness обязана показать 8/24/30/30.

Migration `0006_mtr_agent_orchestrator` только добавляет durable cases, evidence, plans, tasks, action proposals, event inbox, proactive insights и metric events; `0004_product_iteration` и `0005_scoped_rbac` не изменяются. Код можно развернуть с выключенными flags, применить migration controlled job, проверить readiness и только затем включить основной runtime. Rollback уровня приложения: выключить основной flag или включить kill switch; additive таблицы остаются совместимыми и не требуют down-migration.

### 5.4 Deploy gate

Перед Preview и Production:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm privacy:scan
pnpm eval:agent
pnpm build
pnpm benchmark
pnpm test:e2e
```

Push ветки создаёт Preview, merge/push в Production Branch создаёт Production
deployment. После deploy проверьте оба health режима. Для защищённого deployment
используйте `vercel curl`, для доступного URL допустим обычный `curl`:

```bash
vercel curl '/api/health?check=live' --deployment '<deployment-url>'
vercel curl '/api/health?check=ready' --deployment '<deployment-url>'
```

Дополнительно проверьте redirect анонимного `/` на `/login`, вход/выход, server-driven завершение run без вызова `/advance`, отсутствие tool names в user API и наличие тех же операций в `/admin/agent-logs`. Для оркестратора проверьте `SUMMARY`, scoped `STOCKS`, смену роли с очисткой widget, reauthorized case/citation, proposal без автоматического side effect, confirm/replay и event idempotency. Production допускается только после exact-SHA Preview, HTTP 200 readiness, рабочем PDF-export, SLA run ≤15 секунд и отсутствия P0/P1. Эта feature-ветка Production не изменяет.

## 6. On-premise Docker Compose

Текущий Compose предназначен для pilot single-host. По умолчанию web опубликован
только на `127.0.0.1:3000`; перед ним нужен корпоративный reverse proxy с TLS,
ограничением размера запросов, rate limits и журналированием.

### 6.1 Секреты и images

Создайте некоммитируемый `mtr-prototype/.env` с правами только владельца:

```dotenv
POSTGRES_DB=mtr_demo
POSTGRES_USER=mtr
POSTGRES_PASSWORD=<strong-random-password>
DATABASE_URL=postgresql://mtr:<url-encoded-password>@postgres:5432/mtr_demo
APP_MODE=demo
MTR_BIND_ADDRESS=127.0.0.1
MTR_PORT=3000
```

Не копируйте реальное содержимое `.env` в тикеты или логи. `docker compose config`
раскрывает подставленные значения; для безопасной синтаксической проверки используйте
`docker compose config --quiet`.

Prototype defaults закрепляют Node 24/Alpine и PostgreSQL 16.14/Alpine. Перед
закрытым pilot:

- зеркалируйте base images и npm/pnpm dependencies во внутренний registry;
- задайте `NODE_IMAGE`, `POSTGRES_IMAGE`, `MTR_IMAGE`, `MTR_TOOLING_IMAGE` через
  внутренние immutable tags или OCI digests;
- сформируйте SBOM, просканируйте и подпишите images;
- запретите runtime egress, кроме разрешённых корпоративных endpoints.

### 6.2 Первый запуск

```bash
docker compose config --quiet
docker compose build migrate web
docker compose up -d postgres
docker compose run --rm migrate
docker compose --profile seed run --rm seed
docker compose up -d web
curl --fail --silent --show-error 'http://127.0.0.1:3000/api/health?check=ready'
```

`seed` вынесен в отдельный profile и не выполняется на обычном restart/deploy. Web
стартует только после healthy PostgreSQL и успешно завершённой migration job.
Контейнер web работает не от root, с read-only root filesystem, dropped capabilities,
`no-new-privileges`, ограниченными логами и persistent volumes для uploads/cache.

Для следующих релизов:

```bash
docker compose build migrate web
docker compose run --rm migrate
docker compose up -d --no-deps web
```

Single-host uploads сохраняются в volume `uploads_data`. Для нескольких web replicas
до production необходимо реализовать S3-compatible storage adapter; общий локальный
volume не считается multi-node object storage.

### 6.3 Backup и эксплуатация

- Настройте ежедневный backup и PITR PostgreSQL вне Compose lifecycle.
- Проверяйте восстановление backup на отдельном контуре.
- Сохраняйте OCI digest, migration journal и результат health для каждого релиза.
- Не публикуйте порт PostgreSQL наружу.
- Не используйте `docker compose down -v` в эксплуатационном контуре: ключ `-v`
  удаляет volumes базы и uploads.

## 7. Rollback

### Vercel

1. Убедитесь, что причина в приложении, а не в БД/credentials.
2. Выполните `vercel rollback` или `vercel rollback <known-good-deployment-url>`.
3. Проверьте `vercel rollback status`, liveness и readiness.
4. После исправления используйте `vercel promote <fixed-deployment-url>`, чтобы вернуть
   автоматическое назначение production domain.

Vercel rollback переключает application deployment, но не откатывает PostgreSQL,
Blob и текущие environment variables. Миграции должны быть backward-compatible.
Для несовместимого изменения БД используйте заранее подготовленный restore/PITR plan,
а не `db:reset`.

### On-premise

Храните предыдущий подписанный `MTR_IMAGE` по digest. Если schema остаётся совместимой:

```bash
MTR_IMAGE='<registry>/mtr-ai-demo@sha256:<known-good-digest>' docker compose pull web
MTR_IMAGE='<registry>/mtr-ai-demo@sha256:<known-good-digest>' docker compose up -d --no-deps web
curl --fail --silent --show-error 'http://127.0.0.1:3000/api/health?check=ready'
```

Down-migrations прототип не выполняет. При несовместимой schema остановите rollout и
восстановите согласованную пару image/database из утверждённого backup/PITR.

## 8. Benchmark

`pnpm benchmark` запускает `BENCH-10K-001`: пять измерений чистой доменной функции
сопоставления на фиксированном массиве из 10 000 синтетических SAP records. Скрипт
проверяет одинаковый результат `EXACT/100`, выводит latency и приблизительную heap
delta и завершается ненулевым кодом при функциональной невоспроизводимости.

Показатель зависит от hardware/runtime и не является доказательством SLA для 10 000
реальных записей, БД, сети или конкурентных пользователей.

## 9. Официальные справочные материалы

- [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
- [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
- [Vercel environments](https://vercel.com/docs/deployments/environments)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Vercel Marketplace storage](https://vercel.com/docs/marketplace-storage)
- [Vercel production rollback](https://vercel.com/docs/deployments/rollback-production-deployment)
- [Docker Compose startup order](https://docs.docker.com/compose/how-tos/startup-order/)
