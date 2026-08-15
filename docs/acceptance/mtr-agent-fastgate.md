# MTR Agent FastGate v1.1

FastGate — короткая доказательная проверка МТР-агента через реальный HTTP-контур.
Она проверяет вход, треды, универсальный чат, browser shell, RBAC/warehouse
claims, ссылки на источники и безопасную proposal-only операцию. Product,
Production и общие демонстрационные данные прогон не изменяет.

## Текущий статус

Продуктовый диагностический контур проходит 12/12 кейсов и 23/23 сообщений,
но строгая локальная приёмка **заблокирована окружением**. На доступном macOS
host отсутствуют все обязательные независимые средства антифальсификации:

- отдельный connector/witness, которому приложение не передаёт private key;
- подписанный HTTP/connector transcript с независимым счётчиком сообщений;
- detached clean build с read-only Merkle/PID/mount attestation;
- disposable container/VM, запрещающий произвольное чтение и запись host;
- witnessed counterfactual overlays для проверки oracle/evaluator.

Поэтому FastGate обязан возвращать `BLOCKED_BY_ENVIRONMENT`, confidence не выше
`MEDIUM` и readiness не выше 84/100. Старый локальный aggregate, который
объявлял HIGH/100/PASS на основании подписи, созданной самим runner/application,
недействителен и не является acceptance evidence.

## Официальный локальный запуск

```bash
pnpm eval:agent:fastgate -- --runs 3
```

Supervisor требует чистое tracked-дерево и fail-closed проверяет наличие
строгого witness-окружения **до запуска приложения**. В текущем окружении
команда завершится ненулевым кодом и сохранит aggregate с
`BLOCKED_BY_ENVIRONMENT`. Это ожидаемый и корректный результат, а не дефект
продуктовой логики.

Ровно три official runs допускаются только после появления независимого
witness-окружения. Aggregate принимает только набор из трёх уникальных signed
run identities и падает при любом failed/partial/blocked запуске.

Одиночный запуск предназначен только для разработки:

```bash
pnpm eval:agent:fastgate:single
```

Он проверяет продуктовые ответы, oracle-сравнения, RBAC и отсутствие side
effect, но никогда не выдаёт HIGH confidence или официальный PASS. Внутренняя
подпись application/runner считается только диагностической и не доказывает
независимое происхождение source rows.

## Две оценки

- `verifiedCapabilityPoints/Max/Percent` — качество фактически выполненных
  продуктовых кейсов;
- `acceptanceReadinessScore` — готовность доказательного контура с hard caps;
- `evaluationCoveragePercent` — доля исполненного функционального FastGate;
- `assessmentConfidence` — доверие к независимости доказательств.

Диагностический результат может иметь capability 100/100 и coverage 100%, но
при отсутствии witness всё равно получает readiness ≤84, `MEDIUM` и
`NOT READY FOR FULL ACCEPTANCE`.

## Что проверяется строго

- FG-04 сверяет выбранную дефицитную позицию, потребность, доступный остаток,
  сроковой приход, дефицит, дозаказ и допустимые аналоги с независимым oracle;
- FG-06 сверяет точный multiset проектов, спецификаций, сроков и статусов в
  трёхдневном горизонте, а также полный набор citation IDs;
- FG-07 проверяет разрешённую и запрещённую пары, независимый технический
  процент, покрытие количества, отклонения, нормативное основание и обязательное
  human review для всего, что не равно 100%;
- FG-08 сверяет решения по каждой позиции последнего завершённого запуска,
  ответственность и document/clause citations, а не только агрегаты;
- FG-12 работает в серверном режиме `PROPOSE_ONLY`: confirm endpoint возвращает
  `409 MTR_AGENT_ACTION_CONFIRMATION_DISABLED`, а целевое состояние до/после
  остаётся идентичным;
- журнал операций отображает и tool-, и universal-capability события.

Assertion evidence хранит typed expected/actual observations, selected IDs,
citations, snapshots и correlation IDs, когда они доступны. Пустой boolean
`true/true` сам по себе не считается достаточным доказательством.

## Артефакты

Диагностические и blocked-артефакты сохраняются вне Git в
`test-results/mtr-agent-fastgate/<timestamp>-<sha>/`. Они не публикуются и не
являются Preview/Production attestation.

Для строгого PASS одного `result.json` недостаточно. Нужны внешний witness
index, signed HTTP/connector transcript, detached build identity и доказательство
read-only isolation, созданные вне trust boundary приложения и evaluator.

## Release gate

Положительный результат разрешён только при одновременном выполнении:

- доступно независимое witness/container-or-VM окружение;
- ровно три последовательных official runs с уникальными seeds;
- 12/12 PASS, 23/23 сообщений, capability/readiness/coverage 100%;
- HIGH confidence и валидные внешние source/run bindings;
- отсутствуют RBAC leak, side effect, credential/data mutation и hard cap;
- зелёные unit/integration/E2E/eval/privacy/build gates;
- независимый read-only review не находит P0/P1/P2.

FastGate не выполняет push, PR, deploy, promotion или Production migration.
