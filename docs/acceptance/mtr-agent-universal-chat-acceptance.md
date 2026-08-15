# Приёмка универсального МТР-агента

Статус: `LOCAL_G6_COMPLETE_WITH_EXTERNAL_G3_AND_RELEASE_BLOCKERS`

Baseline: `96436a9320a29f6f778007a36e587df6f2154114`
Ветка: `codex/mtr-agent-universal-chat`
Dataset: `universal-chat-v1@1.0.0`
Prompt: `4.1.0`

## Локальный результат

| Gate | Evidence | Статус |
|---|---|---|
| G0 | baseline, counts, gaps и scope manifest | PASS |
| G1 | 83/83 specification links, 3 584/3 584 query path, project/intake/deadline data | PASS |
| G2 | scoped capabilities, формулы, compatibility/reliability, multi-turn deterministic runtime | PASS |
| G3 boundary | официальный OpenAI SDK/Responses, strict schema, budgets, timeout, trace и fallback tests | PASS |
| G3 live Preview | реальный model call на exact deployment SHA | BLOCKED_EXTERNAL |
| G4 | attachment preview/publish, RBAC, idempotency, injection safety | PASS |
| G5 | proposal/confirm/cancel, reauthorization, self/last-admin/last-manager/SoD, atomic audit | PASS |
| G6 local | 602 Vitest, 350 eval и 65 уникальных business E2E; полный Playwright: 83 PASS / 47 profile skips; production webpack build/PDF trace PASS | PASS |
| Draft PR / Preview | remote/upstream и Vercel/OpenAI Preview credentials отсутствуют | BLOCKED_EXTERNAL |

## Обязательные показатели

- project/material oracle: 100% на parameterized fixture cases;
- intake/deadline fixed-clock oracle: 100%;
- hard gates и compatibility score: domain code, 100% regression coverage текущего контракта;
- duplicate stock allocation: 0 в oracle cases;
- structured public response: allowlist projection, no internal tool/provider leakage;
- unknown/empty/partial source: confidence 0 либо limitation/review, без ложного положительного утверждения;
- attachments: preview без команды, explicit publish once, repeat без duplicate;
- privileged actions: separate confirm, repeat без duplicate, forbidden invariants 100%;
- evaluation corpus: 350/350;
- unique browser business scenarios: 65; полный desktop/mobile Playwright gate: 83 PASS / 47 ожидаемых profile skips.

## Что не засчитывается как выполненное

Локальный mocked Responses client доказывает boundary, но не live provider. Локальный Playwright доказывает браузерный пользовательский путь, но не exact Preview SHA. Поэтому общий release-статус остаётся «завершено с внешним блокером», пока владелец не предоставит Preview-only OpenAI secret/model и authenticated push/deploy path.

Production, данные пользователей, логины и role bundles не изменялись.
