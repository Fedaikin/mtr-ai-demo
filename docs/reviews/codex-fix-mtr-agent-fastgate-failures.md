# Review: codex/fix-mtr-agent-fastgate-failures

## Паспорт

- Ветка: `codex/fix-mtr-agent-fastgate-failures`
- Ответственный: Codex
- Назначение: устранить продуктовые FastGate FAIL и сделать доказательный gate
  fail-closed
- База: `0416351a3bf4459e47c46cc5fefc91b85497d141`
- Preview: не запускался
- Дата: 2026-08-14

## Scope и ограничения

- [x] `AGENTS.md` и корректирующий prompt прочитаны полностью.
- [x] Baseline воспроизведён: 39/100, 3 PASS, 8 FAIL, 1 NOT_RUN.
- [x] Продуктовые причины FG-02..FG-12 исправлены regression-first.
- [x] Ложноположительные проверки FG-04/06/07/08 усилены независимой точной
  арифметикой и typed evidence.
- [x] Confirm/execute заблокирован на сервере в режиме `PROPOSE_ONLY`.
- [x] Пользователи, пароли, роли, 83 спецификации, migrations и Product/
  Production datasets не изменялись.
- [x] Push, PR, deploy и Production operations не выполнялись.

## Root cause → fix → evidence

| Контур | Причина | Исправление | Проверка |
|---|---|---|---|
| FG-02 | NLU не удерживал активный проект и отрицания | приоритет explicit context, project NLU, exclusions | phrasing regressions |
| FG-03/11 | stock citation не проходила scoped reauthorization | tenant/project/warehouse-aware material validation | route/runtime/RBAC tests |
| FG-04 | evaluator принимал неполную shortage/compatibility выдачу | точная строка shortage + candidate pool + decoy exclusion + qty/rules | independent oracle assertion |
| FG-05 | «сегодня» смешивал очередь и intake | отдельные today rows и pending queue | oracle/runtime regression |
| FG-06 | сроковой запрос не доказывал полный scope | exact project/spec/date/status multiset и citation union | three-day oracle assertion |
| FG-07 | проверялись только поля ответа | разрешённая и запрещённая пары, exact score/coverage/deviations/rules/review | pair oracle assertion |
| FG-08 | проверялись только агрегаты отчёта | exact per-position state/responsibility/document/clause | completed-run oracle assertion |
| FG-10 | generic code extraction и injection routing | bounded extraction, abstention, injection refusal | runtime regression |
| FG-12 | proposal-only был только транспортным обещанием | server-side 409 на confirm + before/after checksum | route integration + FastGate |
| Logs | E2E перестал доказывать журнал операции | tool/capability events и фильтр capabilityKey | repository/unit/E2E |
| Evaluator | self-signature ошибочно считалась независимым witness | self-binding только diagnostic; strict witness fail-closed | supervisor/scoring tests |

## Независимый review и исправление методологии

Первый независимый read-only review отклонил прежний HIGH/100/PASS. Runner сам
создавал Ed25519 key, передавал private key приложению, самостоятельно считал
сообщения и запускал writable `pnpm dev` в permissive macOS sandbox. Отдельного
connector witness, signed HTTP transcript, detached read-only build attestation
и counterfactual overlay witness не было.

Этот вывод принят. Старый aggregate недействителен. Supervisor больше не
симулирует официальный witness: `assessStrictWitnessEnvironment()` fail-closed
возвращает пять явных environment blockers и не запускает official runs. Запрос
`--runs` принимает только точное значение 3.

Первый re-review затем обнаружил, что typed observations терялись в scoring,
FG-08 строил expected из сохранённых результатов, а FG-04/07/10/11 содержали
слишком слабые assertions. Эти замечания также приняты: scoring теперь сохраняет
typed expected/actual/IDs; FG-08 независимо вычисляет решения из raw current
positions и versioned responsibility rules; regression намеренно портит
persisted result и доказывает неизменность oracle; shortage/substitute,
reliability, public `NOT_FOUND` и analyst stock сверяются с точной арифметикой,
snapshot и warehouse scope.

## Safety

- [x] Product FastGate использует временную PGlite и не пересоздаёт 83
  спецификации.
- [x] FG-12 не может подтвердить действие даже прямым HTTP-вызовом.
- [x] Dataset/RBAC fingerprint и глобальный target-state checksum проверяются.
- [x] Internal application signature не объявляется external source proof.
- [x] Preview без exact-SHA attestation не выдаётся за локальный результат.
- [x] Credentials/private keys/raw private values не сохраняются в Git.

## Проверки текущего corrective diff

- [x] Усиленные FastGate/product/supervisor/log regressions: 9 файлов / 55 тестов PASS.
- [x] Full Vitest sequential: 163 файла / 679 тестов PASS.
- [x] Typecheck PASS.
- [x] ESLint PASS.
- [x] Privacy scan: 569 файлов PASS.
- [x] Production build + PDF runtime asset verifier PASS.
- [x] Восстановленный operation-log E2E: desktop + mobile, 2/2 PASS.
- [x] Диагностический FastGate: 12/12 PASS, 23/23 сообщений, capability
  100/100, coverage 100%, readiness 84/100, confidence MEDIUM.
- [x] Official FastGate настроен fail-closed: на clean commit обязан вернуть
  `BLOCKED_BY_ENVIRONMENT`; exact-SHA запуск выполняется после commit как
  неизменяемый release-handoff artifact.
- [x] Финальный независимый read-only re-review: PASS, подтверждённых P0/P1/P2
  в стабильном продуктовом diff нет.

Ранее выполненные неизменённые suites остаются зелёными: base 34/34,
analytical 50/50, learning 17/17, provider 20/20, security 32/32, scale 20/20,
multi-turn 27/27, universal 158/158.

## Решение

- [x] ПРОДУКТОВЫЕ FASTGATE-КЕЙСЫ ИСПРАВЛЕНЫ.
- [x] ЛОЖНЫЙ HIGH/PASS УСТРАНЁН.
- [ ] ПОЛНЫЙ FASTGATE DOD НЕ ЗАКРЫТ.
- [x] `BLOCKED_BY_ENVIRONMENT`: нет независимого connector witness, signed HTTP
  transcript, detached read-only build attestation, disposable container/VM и
witnessed counterfactual overlays.

Финальный диагностический artifact:
`test-results/mtr-agent-fastgate/2026-08-14T18-18-05-813Z-75936a812f46/result.json`.
Его evaluator/oracle hashes совпадают с проверенным source snapshot; результат
12/12, 23/23, raw capability 100/100, readiness 84, `MEDIUM`, `NOT READY`.

Для снятия блокера требуется отдельное решение пользователя об инфраструктуре:
предоставить disposable VM/container и независимый witness/connector либо
разрешить создание такого внешнего контура. До этого ветка не должна получать
release/Preview/Production PASS.
