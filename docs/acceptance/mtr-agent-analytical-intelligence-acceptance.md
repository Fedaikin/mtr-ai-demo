# Строгая локальная приёмка аналитического интеллекта МТР-агента

Дата: `2026-08-13`  
Ветка: `codex/mtr-agent-analytical-intelligence`  
Проверенный code/eval/E2E SHA: `adefcaf8f2b1fcaf6ffa23b10d99e045d0fde668`
Production: не изменён

Статусы относятся к локальному коду и синтетическому санкционированному dataset. Они не заменяют exact-SHA Preview-приёмку.

| ID | Requirement | Maturity | Implementation | Dataset cases | Test/E2E | Runtime evidence | Metric | Exact SHA | Status | Limitation |
|---|---|---|---|---:|---|---|---|---|---|---|
| A-01 | Immutable baseline | I0 | Legacy deterministic runtime | 34 | `pnpm eval:agent` | 34/34 | 100% | `8a472d7` | ПРОЙДЕНО | Legacy pack не считается production-shaped analytical pack |
| A-02 | ≥200 total eval | I0–I4/A2 | Семь независимых manifests/runners | 200 | `pnpm check` | 34+50+17+20+32+20+27 | 200/200 | `8a472d7` | ПРОЙДЕНО | Preview не запускался |
| A-03 | ≥140 production-shaped runtime | I1–I4/A2 | Analytical, learning, security, scale, multi-turn | 146 | Все новые runners кроме legacy/provider-only | 50+17+32+20+27 | 146 ≥ 140 | `8a472d7` | ПРОЙДЕНО | Provider-only 20 не включены в числитель |
| A-04 | ≥50 analytical I2–I4 | I2–I4 | Evidence graph, forecast, root cause, scenarios, verifier | 50 | `eval:agent:analytical` | 50/50 | 100% | `8a472d7` | ПРОЙДЕНО | Synthetic `g1-vertical-v1` |
| A-05 | ≥50 adversarial/security | A1 | Provider, authorization, injection, revoke/leakage | 50 | provider/security + analytical/learning adversarial partitions | 12+32+2+4 | 50 | `8a472d7` | ПРОЙДЕНО | Локальные boundaries, не внешний pentest |
| A-06 | ≥30 temporal/backtesting | I3 | 52-week movements, rolling origins | 30+ | Analytical pack | 20 explicit oracle + temporal validation cases | ≥30 | `8a472d7` | ПРОЙДЕНО | Future real outcomes отсутствуют |
| A-07 | ≥20 root-cause oracle | I3 | Deterministic causal/refuted/associated drivers | 20 | Analytical pack | 20/20 | 100% oracle agreement | `8a472d7` | ПРОЙДЕНО | Synthetic causal labels |
| A-08 | ≥20 forecast with backtest | I3 | Three models, rolling-origin backtest, interval | 20 | Analytical pack | 20/20 | 44 origins, 3 models | `8a472d7` | ПРОЙДЕНО | Не production forecast |
| A-09 | ≥20 scenario/ranking oracle | I4 | Immutable scenario engine + deterministic ranker | 20 | Analytical pack | 20/20 | 100% arithmetic/order | `8a472d7` | ПРОЙДЕНО | Human approval остаётся обязательным |
| A-10 | ≥20 RBAC/revoke/leakage | A1 | Permission/scope before retrieval, citation/case/action reauth | 32 | `eval:agent:security` | 32/32 | leakage/side effect 0 | `8a472d7` | ПРОЙДЕНО | Canonical RBAC schema не менялась |
| A-11 | ≥15 multi-turn | I3–I4/A2 | Same-thread elliptical follow-up and deterministic restore | 27 | `eval:agent:multi-turn` | 27/27 | context mixing 0 | `8a472d7` | ПРОЙДЕНО | Контекст страницы передаётся каждым запросом |
| A-12 | ≥15 feedback/knowledge/version | A2 | Quarantine, human curation, provenance, no online learning | 29 | learning + multi-turn feedback | 17+12 | online transitions 0 | `8a472d7` | ПРОЙДЕНО | Outcome learning остаётся будущим этапом |
| A-13 | ≥20 scale | I2–I4 | 12 specs, components/assemblies/negatives/analogue boundaries | 20 | `eval:agent:scale` | 20/20, concurrency 10 | p95 21.80 ms | `8a472d7` | ПРОЙДЕНО | In-memory synthetic dataset; не DB/LLM load test |
| A-14 | Provider conformance | A1 | Redaction, budgets, rate, timeout/cancel, kill switch, strict output | 20 | `eval:agent:provider` | 20/20 | unsafe provider calls 0 | `8a472d7` | ПРОЙДЕНО | Внешний provider не подключён |
| A-15 | Feedback does not auto-train | A2 | Candidate остаётся `QUARANTINED` до human curation | 12 multi-turn +17 lifecycle | learning/multi-turn packs | Повторный ответ идентичен | 100% | `8a472d7` | ПРОЙДЕНО | Fine-tuning запрещён |
| A-16 | Human-only expert decision | A2/A3 | Recommendation/proposal не является решением | Unit/integration corpus | `pnpm test` | Unsupported expert decision absent | 0 substitutions | `8a472d7` | ПРОЙДЕНО | Требуется Preview UX-проверка |
| A-17 | SAP/Appius write absent | A0–A3 | Agent tools и proposals ограничены разрешёнными типами | Security/action tests | `pnpm test` | Unsupported write rejected | 0 writes | `8a472d7` | ПРОЙДЕНО | Scenario engine остаётся отдельным контуром |
| A-18 | Full local quality gate | G5 | Lint, typecheck, Vitest, privacy, evals, build/PDF trace | 526 tests +200 eval | `pnpm check` | 132 files/526 tests; privacy 470; build PASS | 100% | `adefcaf` | ПРОЙДЕНО | Vite config выводит неблокирующее предупреждение |
| A-19 | ≥40 E2E business scenarios | G5 | Playwright business/UX matrix | 40 distinct test bodies | Desktop + mobile projects | Desktop 37 PASS/3 target skips; mobile 21 PASS/19 target skips; каждый distinct scenario выполнен на применимом target | 40/40 | `adefcaf` | ПРОЙДЕНО | 15 analytical scenarios исполняются один раз на desktop; responsive cases отдельно на mobile |
| A-20 | Draft PR + exact-SHA Preview | Release | Feature branch only | — | Не запускалось | Remote/upstream/Vercel credentials отсутствуют | blocked | `adefcaf` | ЗАБЛОКИРОВАНО ВНЕШНЕЙ ЗАВИСИМОСТЬЮ | Нельзя безопасно push/deploy; Production запрещён |

## Итог

Локальный curriculum, полный code gate и E2E-матрица `40/40` пройдены. Локальная приёмка **ПРОЙДЕНА**; релизный verdict остаётся **ЗАБЛОКИРОВАН** только внешней зависимостью: требуется push feature-ветки, draft PR и exact-SHA Preview-приёмка без изменения Production.
