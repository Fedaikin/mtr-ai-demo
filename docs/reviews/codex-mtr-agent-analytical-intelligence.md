# Review: аналитический интеллект МТР-агента

Ветка: `codex/mtr-agent-analytical-intelligence`

Base: `70543c6c34d6778695a07a5400006742ed5e3a21`
Статус: deterministic G1–G3 vertical, безопасный feedback slice G4, curriculum 200/200 и E2E 40/40 реализованы; exact-SHA Preview внешне заблокирован

## Scope

- [x] Scope manifest зафиксирован до production edits.
- [x] Users/RBAC/auth и migrations `0000`–`0006` не изменяются.
- [x] Портфель 83 specifications / 3 584 positions сохраняется.
- [x] Финальный diff не содержит несвязанных файлов, secrets или generated state.

## Analytics trust boundary

- [x] Authorization и source filtering выполняются до retrieval.
- [x] Данные проходят coverage/quality/freshness gate до вывода.
- [x] LLM не вычисляет business metrics, forecast, scenario score или recommendation score.
- [x] Provider-neutral boundary применяет redaction-before-call, kill switch, rate/token/cost budgets, timeout/cancel, strict output schema и audit metadata без reasoning.
- [ ] Evidence graph хранит source nodes, но durable lineage каждого derived result ещё не завершён.
- [x] Forecast содержит model/version/backtest/interval/assumptions или abstains.
- [x] Причина отделена от корреляции.
- [x] Scenario immutable и не меняет operational state.
- [ ] Verifier не создаёт факты и повторно авторизует citations.
- [x] Recommendation не является human decision.

## Safety и lifecycle

- [x] Action использует proposal → confirm → reauthorization → idempotency → audit.
- [x] Feedback не меняет online behavior.
- [x] LearningCandidate quarantined и требует human approval, regression case и validation checksum.
- [x] Role switch/revoke очищает widget context; case/evidence history повторно авторизуется при чтении.
- [x] SAP/Appius write отсутствует.

## Gates

- [x] G0 baseline/coverage: technical PASS, analytical completeness FAIL с точными denominators.
- [x] G1 semantic/data/evidence foundation.
- [x] G2 engines реализованы и unit/integration green; полный target curriculum ещё не достигнут.
- [x] G3 unified `ANALYSIS` runtime/verifier/public UX, rich message history и durable reauthorized analytical evidence lineage реализованы.
- [ ] G4 частично: recommendation, A3 proposal/confirm, analytical history и curated feedback lifecycle реализованы; outcome learning и proactive acceptance ещё открыты.
- [x] ≥200 eval, adversarial/security, multi-turn и scale quota: 34 legacy + 50 analytical + 17 learning + 20 provider + 32 security + 20 scale + 27 multi-turn = 200.
- [x] ≥40 E2E business scenarios: 40 distinct test bodies выполнены на применимых desktop/mobile targets.
- [x] Clean local full gate: 132 test files / 526 tests, privacy 470, eval 200/200, production build/PDF assets PASS.
- [x] Строгий локальный acceptance-отчёт создан; Preview fix-loop остаётся внешне заблокирован.
- [ ] Draft PR и Preview exact SHA; Production не затронут.
