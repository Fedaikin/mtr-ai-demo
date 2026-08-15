# Review: codex/mtr-agent-fastgate-official-93

## Паспорт и verified current state

- Ветка: `codex/mtr-agent-fastgate-official-93`
- База: `82a096be9baa5956aa5a6b2528eae6dd365a3259`
- Merge base: `82a096be9baa5956aa5a6b2528eae6dd365a3259`
- Исходный tree: `17b956d59d322d4a544dcb6aaccdfe33007b181d`
- Исходное tracked-дерево: clean
- Цель: repo-contained независимый FastGate-контур и официальный результат
  `>=93`, `HIGH`, `3/3`, `12/12`, `23/23` без изменения Product data.
- Preview/Production/PR/push: не разрешены и не выполняются.
- Дата начала: 2026-08-14

## Baseline hashes

- `pnpm-lock.yaml`: `113c2de19be74bf7da9f1fdf313f37a447dfb7efe6b39bc3f9b632a1c078da00`
- manifest: `ed066136a10e4f37f98d5ca374b2bf555b5bf74fb6b525279fcea4ea2d425255`
- evaluator: `9e69d28882469cb05dc51bc2b1add6f62a29da03ff6435c04f0b15c6b77dccf4`
- oracle: `cbeca9384f824048e75f6c8bdb27a87eb979a5c3f7ffd6b779ab6b6375ae5961`
- baseline Vitest: 163 файлов / 679 тестов.
- host: macOS Darwin 25.6.0, arm64, 16 GiB RAM.

## Подтверждённые исходные blockers

- `INDEPENDENT_CONNECTOR_WITNESS_UNAVAILABLE`
- `SIGNED_HTTP_TRANSCRIPT_UNAVAILABLE`
- `DETACHED_READ_ONLY_BUILD_ATTESTATION_UNAVAILABLE`
- `DISPOSABLE_VM_OR_CONTAINER_UNAVAILABLE`
- `COUNTERFACTUAL_OVERLAY_WITNESS_UNAVAILABLE`

Статический checkpoint подтвердил отсутствие runtime. После отдельного явного
разрешения пользователя установлены Homebrew `colima 0.10.3`, `docker 29.7.2`
и `docker-compose 5.4.0`. Запущена пользовательская Colima VM через macOS VZ
без `sudo`: 6 CPU, 10 GiB, `virtiofs`, Docker context `colima`; Docker socket
находится только в `~/.colima/default/docker.sock`. `~/.docker/config.json`
до установки отсутствовал; создан JSON только с Homebrew CLI plugin path.

## Root cause

Диагностический runner совмещает evaluator, приложение, источник, signing key и
message counter в одном trust domain. Он запускает writable `pnpm dev`, а
`assessStrictWitnessEnvironment()` намеренно возвращает `ready:false`. Поэтому
cap 84/MEDIUM является корректным fail-closed результатом отсутствующего
доказательного окружения, а не оценкой качества 12 продуктовых ответов.

## Подсистемы, которые не переписываются без доказанного FAIL

- 12-case/23-message manifest и веса;
- независимая продуктовая арифметика FG-04/06/07/08/10/11;
- canonical RBAC/session runtime;
- `PROPOSE_ONLY` server-side 409 barrier;
- 83 спецификации, пользователи, роли, пароли, migrations и Product datasets;
- universal chat вне явного FastGate environment.

## Traceability и проверки

Заполняется по мере выполнения:

- [x] canonical JSON/signature/certificate/hash-chain/replay tests — 3 tests
- [x] independent connector witness and source-row binding contract tests — 3 tests
- [x] signed HTTP transcript exact 23-message and tamper tests — 2 tests
- [x] counterfactual overlay integrity/coverage tests — 3 tests
- [ ] exact-SHA/image/runtime attestation tests — static contract ready; Colima runtime probe PASS
- [x] exact 3-run/min-median/HIGH/offline verifier unit tests — 11 tests
- [x] cleanup target scoping and secret-redaction tests
- [x] infrastructure static contract tests — 5 tests
- [x] doctor evidence — `test-results/mtr-agent-fastgate/doctor-official-93.json`
- [x] full TypeScript/lint/Vitest/privacy/build gates
- [ ] 10-session isolation and 50-session load — runtime implementation ready, evidence pending
- [ ] independent read-only review artifact
- [ ] final tracked tree clean

Проверки checkpoint:

- targeted official contracts: 6 files / 26 tests PASS;
- полный Vitest: exit 0;
- `pnpm typecheck`: PASS;
- `pnpm lint`: PASS;
- `pnpm privacy:scan`: 591 candidate files PASS;
- `pnpm build`: PASS, 23/23 static pages, PDF runtime assets 2/2;
- `git diff --check`: PASS;
- `pnpm fastgate:official -- --runs 3`: ожидаемо `BLOCKED_BY_ENVIRONMENT`,
  `executedRuns=0`; score не присвоен.
- post-install disposable read-only container probe: PASS;
- doctor Colima isolation regression: RED (`isAcceptedDockerIsolation` missing)
  → GREEN (healthy user-owned Colima socket accepted; system socket/stopped VM
  rejected); runtime blockers classified `RESOLVED` while the tree is dirty.

## Архитектурные решения checkpoint

- Diagnostic self-signature отделена от новых ролей `SUPERVISOR`, `HTTP_PROXY`,
  `CONNECTOR_WITNESS`, `OFFLINE_VERIFIER`, `READ_ONLY_REVIEWER`.
- Ed25519 private key остаётся closure-local внутри конкретного процесса; в
  certificate/envelope/Compose/app env private material отсутствует.
- Proxy фиксирует безопасные хеши, normalized route, subject/permission/thread/
  message hashes, template ordinal и retry marker; cookies/passwords не пишет.
- Connector event связывает capability, connector/operation, argument hash,
  source snapshot/row IDs+hashes, projection/result hash и предыдущий event.
- Compose имеет internal networks, read-only rootfs, `cap_drop: ALL`,
  `no-new-privileges`, tmpfs и named volumes; host home/Docker socket не mounted.
- Cleanup принимает только project name `mtr-fastgate-official-*` и не использует
  system/volume prune либо filesystem glob.
- App-side registry в `FASTGATE_OFFICIAL=1` после локальных schema/RBAC gates
  делегирует выполнение только `http://connector-witness:4320`; URL allowlist
  fail-closed, identity/permission/claims и signing key не передаются.
- Connector witness сам поднимает отдельную PGlite-копию, применяет тот же сырой
  counterfactual input, исполняет canonical capability registry и подписывает
  hash-chain фактических output/source rows. Oracle остаётся в private volume.
- Application bootstrap использует отдельную PGlite-копию и не имеет доступа к
  oracle/private witness key. Одинаковость только входной мутации доказывается
  независимыми applied-plan commitments.
- Container supervisor активирован: immutable seeded 23-message schedule до
  первого сообщения, evaluator через signed proxy, 10 security и 50 load
  sessions, затем offline verification. Runtime evidence ещё не получен.

## Неизменённые области

- users/passwords/RBAC/auth sessions;
- Product/Preview/Production и Vercel;
- migrations/schema/bootstrap/83 specifications/catalog/SAP/normative fixtures;
- universal chat/runtime вне FastGate composition;
- Git remotes, PR и push.

## Итоговое решение

- [ ] PASS
- [ ] FAIL
- [ ] BLOCKED_BY_ENVIRONMENT
- [ ] BLOCKED_BY_EXTERNAL_AUTHORITY

Текущее состояние: runtime permission выполнен, Colima probe зелёный.
Официальный PASS не заявлен; выполняется witnessed app integration/fix-loop на
новом exact commit SHA.
