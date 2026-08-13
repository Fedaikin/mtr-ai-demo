# Прототип системы анализа МТР

Рабочий русскоязычный прототип анализа материально-технических ресурсов. Приложение получает актуальные спецификации из мока Appius PLM, сопоставляет позиции с остатками SAP S/4HANA, применяет демонстрационные правила ответственности и аналогов, сохраняет серверный сценарий и формирует отчёт. Встроенный «МТР-аналитик» работает без внешнего LLM через детерминированный mock-провайдер.

> В приложении используются только синтетические демонстрационные данные и правила. Результаты не подтверждают реальный складской остаток и не разрешают закупку или эксплуатацию.

## Что уже работает

| Возможность | Реализация |
|---|---|
| Доступ | Восемь синтетических субъектов, scoped RBAC, persistent HttpOnly-сессия и переключение демонстрационных ролей без публикации пароля |
| Appius PLM | 83 актуальные спецификации с различным объёмом (3 584 позиции); эталонный анализ стабильно использует исходные 3 спецификации / 24 позиции; доступен просмотр истории |
| SAP S/4HANA | Ровно 30 материалов и 30 связанных остатков, OData-подобный HTTP facade |
| Анализ | Категории `EXACT`, `LIKELY`, `REVIEW`, `NO_MATCH`; ответственность и количественное покрытие аналогами |
| Сценарии | Серверный bounded runner после create/retry/manual import; UI только опрашивает состояние; работают cancel, совместимый `advance` и фактический snapshot файла (`sourceKind: UPLOADED_FILE`) |
| Ручной импорт | Appius принимает CSV/XLS/XLSX, размеченный текст и позиционные TXT/DOCX/text-PDF ровно из четырёх полей `код / наименование / количество / единица`; смесь допустимых и отклонённых строк блокируется как `REVIEW_REQUIRED`; известный demo-image даёт фиксированный OCR, остальные изображения и scan-PDF требуют проверки. SAP fallback поддерживает только CSV/XLS/XLSX |
| Отчёты | Интерактивный отчёт, версионное решение эксперта и экспорт JSON, XLSX, PDF |
| МТР-агент | Единый runtime `CHAT / COMMAND / EVENT`, шесть команд, включая проверяемый анализ позиции с forecast/backtest и scenario comparison; bounded планы, повторно авторизуемая история выводов и evidence, недельная сводка, proactive-сигналы, подтверждаемые действия и owner-only feedback в карантин без online learning |
| Администрирование | Исполняемые состояния Appius, SAP, RAG и LLM, сценарии, промпты, словари, логи агента, аудит, demo-reset |
| Хранилище | PGlite локально; PostgreSQL при заданном `DATABASE_URL`; Blob для загрузок на Vercel |

## Быстрый запуск

Нужны Node.js `24.x` и pnpm `11.16.0` — эти версии закреплены в `package.json`. Команды выполняются из каталога `mtr-prototype`.

```bash
pnpm install --frozen-lockfile
test -e .env.local || cp .env.example .env.local
# Получите приватный scrypt-хеш у владельца контура и задайте DEMO_PASSWORD_HASH.
node --env-file=.env.local --import tsx scripts/migrate.ts
node --env-file=.env.local --import tsx scripts/seed.ts
pnpm dev
```

Откройте [http://localhost:3000](http://localhost:3000) и войдите с приватно выданными демонстрационными реквизитами. Экран `/login`, README и клиентский bundle не показывают логин, пароль или хеш. `DEMO_PASSWORD_HASH` обязателен и задаётся через secret manager. Команда `db:seed` предназначена для первого запуска или осознанного восстановления канонического набора.

Первый сквозной результат можно получить по [демонстрационному сценарию за 7–10 минут](docs/demo-guide.md).

## Карта документации

Документация разделена по Diátaxis: учебный сценарий помогает пройти путь впервые, инструкции решают эксплуатационные задачи, справочник фиксирует контракты, а архитектурные документы объясняют принятые решения.

| Задача читателя | Документ | Тип |
|---|---|---|
| Провести полный анализ, открыть отчёт и проверить агента | [Демонстрация за 7–10 минут](docs/demo-guide.md) | Tutorial |
| Запустить, проверить, сбросить или диагностировать приложение | [Эксплуатация прототипа](docs/operations.md) | How-to |
| Развернуть Local, Vercel или on-premise pilot | [Развёртывание](docs/deployment.md) | How-to / reference |
| Вызвать HTTP API и проверить схему запроса | [Справочник HTTP API](docs/api-reference.md) | Reference |
| Понять правила grounded-агента | [Поведение МТР-аналитика](docs/agent-behavior.md) | Reference / explanation |
| Проверить формулы, качество данных, forecast и команду `ANALYSIS` | [Семантический слой аналитики МТР](docs/mtr-analytics-semantic-layer.md) | Reference / explanation / how-to |
| Понять границы runtime, persistence и rollout | [Трассируемость МТР-агента](docs/mtr-agent-orchestrator-traceability.md) | Reference / explanation |
| Проверить модель ролей, scopes и permissions | [Scoped RBAC](docs/RBAC.md) | Reference |
| Увидеть исходные ограничения перед интеграцией | [Baseline МТР-агента](docs/mtr-agent-orchestrator-baseline.md) | Historical evidence |

Все новые документы доступны непосредственно из этого README и ссылаются друг на друга.

## Основные экраны

| Путь | Назначение |
|---|---|
| `/login` | Вход синтетической RBAC-персоны; реквизиты на экране не публикуются |
| `/` | Обзор данных, последнего запуска и интеграций |
| `/specifications` | Актуальные спецификации Appius и их позиции |
| `/runs` | Сохранённые серверные запуски |
| `/mtr-analysis` | МТР-анализ и единое рабочее пространство агента: chat, команды, кейсы, сводка, сигналы и подтверждаемые действия |
| Глобальный виджет | Контекстный «МТР-агент» в правом нижнем углу; очищается при смене роли |
| `/admin/scenarios` | Запуск пяти демонстрационных сценариев |
| `/admin/integrations` | Управляемые состояния Appius, SAP, RAG и LLM |
| `/admin/prompts` | Версии системного промпта |
| `/admin/dictionaries` | Словари нормализации |
| `/admin/agent-logs` | Метрики legacy-инструментов и persisted-состояния оркестратора без личных сообщений и raw payload |
| `/admin/audit` | Фильтруемый журнал и восстановление demo-набора |

Readiness и контроль canonical seed доступны по `/api/health`; probe только читает точные counts и не выполняет migration/seed. Полный контракт приведён в [API reference](docs/api-reference.md#health-api).

## Команды проекта

| Команда | Назначение |
|---|---|
| `pnpm dev` | Development server на `http://localhost:3000` |
| `pnpm build` | Production build Next.js и обязательная проверка, что Cyrillic/Latin PDF-font assets присутствуют в свежем route trace и, для standalone, в bundle |
| `pnpm start` | Вызов `next start`; для текущего `output: standalone` используйте [standalone-запуск](docs/operations.md#как-запустить-production-bundle-локально) |
| `pnpm lint` | ESLint без допустимых warnings |
| `pnpm typecheck` | Генерация Next.js route types и строгий TypeScript |
| `pnpm test` | Все Vitest unit и integration тесты |
| `pnpm test:unit` | Доменные unit-тесты |
| `pnpm test:integration` | Fixture, runner и export integration-тесты |
| `pnpm test:e2e` | Playwright на desktop и mobile; server запускается автоматически |
| `pnpm test:coverage` | Покрытие domain/application через V8 |
| `pnpm privacy:scan` | Проверить исходники и документы на контактные данные и запрещённые маркеры |
| `pnpm eval:agent` | Выполнить 34 deterministic golden-case проверки МТР-аналитика |
| `pnpm eval:agent:analytical` | Выполнить отдельный production-shaped набор analytical command/chat oracle-проверок |
| `pnpm eval:agent:learning` | Выполнить versioned feedback/curation/rollback и trust-boundary eval |
| `pnpm eval:agent:provider` | Выполнить 20 provider-boundary validation/held-out/adversarial проверок |
| `pnpm eval:agent:security` | Выполнить 32 проверки permission, scope, injection, citation/case/action reauthorization |
| `pnpm eval:agent:scale` | Выполнить 20 портфельных ANALYSIS-кейсов двумя параллельными батчами по 10 |
| `pnpm perf:smoke` | Измерить готовность API и загрузку основных экранов; поддерживает локальный или Preview base URL |
| `pnpm check` | `lint` → `typecheck` → `test` → `privacy:scan` → legacy, analytical, learning, provider, security и scale eval-наборы → `build` |
| `pnpm db:migrate` | Применить checked-in Drizzle migrations |
| `pnpm db:seed` | Заменить demo-scoped данные каноническим seed |
| `pnpm db:reset` | Атомарно восстановить demo-scoped данные; remote reset защищён флагом |
| `pnpm db:generate` | Сгенерировать новую Drizzle migration после изменения schema |

Скрипты `pnpm db:*` читают переменные текущего process, но не загружают `.env.local` автоматически. В quick start выше Node.js 24 явно загружает тот же env-файл, который затем читает Next.js.

Полный порядок, безопасный reset и диагностика описаны в [operations.md](docs/operations.md).

## Переменные окружения

Шаблон находится в `.env.example`.

| Переменная | Локально | Preview/Production | Назначение |
|---|---|---|---|
| `DATABASE_URL` | Необязательна | Обязательна для durable persistence | PostgreSQL connection string; пустое значение включает PGlite |
| `PGLITE_DATA_DIR` | `.data/pglite` в шаблоне | Не используется | Каталог локальной PGlite; `memory://` используется в тестах |
| `BLOB_READ_WRITE_TOKEN` | Необязательна | Обязательна для загрузок на Vercel | Private Vercel Blob storage |
| `LLM_PROVIDER` | `mock` | `mock` для текущего прототипа | Декларативный маркер; runtime текущей версии явно создаёт deterministic mock-provider |
| `LLM_API_KEY` | Пустая | Не нужна для `mock` | Зарезервирована под внешний provider |
| `MTR_AGENT_LLM_ENABLED` | `true` | Операционный флаг | Только явное `false` останавливает provider call; подтверждённые tool-citations сохраняются в безопасном fallback |
| `APP_MODE` | `demo` | `demo` только в защищённом прототипном контуре | Разрешает API demo-reset |
| `DEMO_USER_ID` | `demo-user-001` | `demo-user-001` | Канонический владелец предметных fixtures; доверенная session и scopes задаются сервером |
| `DEMO_PASSWORD_HASH` | Обязателен | Обязателен через secret manager | Общий scrypt-хеш для интерактивных demo-персон; plaintext и реальный хеш в Git/UI запрещены |
| `MTR_AGENT_ORCHESTRATOR_ENABLED` | `false` | Явно включить после миграции `0006` | Единый runtime, команды, кейсы, digest и insights |
| `MTR_AGENT_ACTIONS_ENABLED` | `false` | Включать отдельно | Proposal/confirm/cancel для разрешённых L2-действий |
| `MTR_AGENT_EVENTS_ENABLED` | `false` | Включать отдельно | Service-to-service event ingress и proactive insights |
| `MTR_AGENT_KILL_SWITCH` | `false` | Операционный флаг | Немедленно останавливает новое выполнение оркестратора |
| `MTR_AGENT_EVENT_INGRESS_SECRET` | Не нужен без events | Secret ≥32 символов | Защищает event ingress; не передаётся в браузер |

## Структура

```text
src/
  app/                       Next.js pages и Route Handlers
  application/               сценарий, отчёт, файлы и AI-агент
  domain/                    чистые правила matching и ответственности
  ports/                     контракты заменяемых источников
  adapters/mock/             Appius, SAP и deterministic LLM
  adapters/persistence/      Drizzle, PostgreSQL и PGlite
tests/                       unit, integration и Playwright E2E
drizzle/                     checked-in SQL migrations
prompts/                     system prompt и few-shot cases
evals/                       golden cases МТР-аналитика
docs/                        документация прототипа
```

Границы runtime, persistence и приёмочные связи приведены в [трассируемости МТР-агента](docs/mtr-agent-orchestrator-traceability.md), а политика доступа — в [Scoped RBAC](docs/RBAC.md).

## Контрольные инварианты

- предметные fixtures принадлежат каноническому demo-контуру; доступ ограничивается проектом, source/catalog scope и warehouse claims;
- Appius содержит 83 актуальные спецификации и 3 584 позиции; эталонный сценарный набор содержит 24 позиции;
- SAP содержит ровно 30 материалов и 30 остатков;
- fixture manifests `identity-base-v1`, `appius-base-v1`, `sap-base-v1`, `normative-base-v1` используют schema `1.0.0`; `scenarios-base-v2` использует schema `1.1.0` и содержит пять сценариев;
- полный сценарий формирует golden-распределение 8 `EXACT`, 8 `LIKELY`, 5 `REVIEW`, 3 `NO_MATCH`;
- агент получает предметные факты только через server-side capabilities с `TrustedRequestContext`;
- каждый LLM-вызов проходит provider-neutral boundary: redaction, token/cost/rate budgets, timeout/cancel, kill switch и строгую проверку ответа; обучение, retention и сохранение reasoning запрещены;
- сохранённые citations повторно авторизуются при чтении; L2-действия требуют отдельного подтверждения;
- отзыв на ответ создаёт идемпотентный `LearningCandidate` в карантине; он не меняет runtime без human approval, regression case, validation checksum и отдельной активации;
- внешний `userId` не выбирает контекст данных;
- только два известных hash-bound demo PNG fixtures получают фиксированный синтетический OCR; любое другое JPEG/JPG/PNG/TIFF требует ручной проверки;
- real contact/PII и реальные корпоративные правила запрещены.

Перед передачей результата выполните локальный gate из [эксплуатационной инструкции](docs/operations.md#как-выполнить-полную-локальную-проверку).
