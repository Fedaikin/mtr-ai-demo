# Review: аналитический интеллект МТР-агента

Ветка: `codex/mtr-agent-analytical-intelligence`

Base: `70543c6c34d6778695a07a5400006742ed5e3a21`
Статус: G1 завершён; deterministic G2/G3 vertical реализован, persistence/eval/Preview ещё открыты

## Scope

- [x] Scope manifest зафиксирован до production edits.
- [x] Users/RBAC/auth и migrations `0000`–`0006` не изменяются.
- [x] Портфель 83 specifications / 3 584 positions сохраняется.
- [ ] Финальный diff не содержит несвязанных файлов, secrets или generated state.

## Analytics trust boundary

- [ ] Authorization и source filtering выполняются до retrieval.
- [x] Данные проходят coverage/quality/freshness gate до вывода.
- [x] LLM не вычисляет business metrics, forecast, scenario score или recommendation score.
- [ ] Evidence graph хранит source nodes, но durable lineage каждого derived result ещё не завершён.
- [x] Forecast содержит model/version/backtest/interval/assumptions или abstains.
- [x] Причина отделена от корреляции.
- [x] Scenario immutable и не меняет operational state.
- [ ] Verifier не создаёт факты и повторно авторизует citations.
- [x] Recommendation не является human decision.

## Safety и lifecycle

- [ ] Action использует proposal → confirm → reauthorization → idempotency → audit.
- [ ] Feedback не меняет online behavior.
- [ ] LearningCandidate quarantined и требует human approval.
- [ ] Role switch/revoke очищает или повторно авторизует context/history.
- [ ] SAP/Appius write отсутствует.

## Gates

- [x] G0 baseline/coverage: technical PASS, analytical completeness FAIL с точными denominators.
- [x] G1 semantic/data/evidence foundation.
- [ ] G2 engines реализованы и unit/integration green; oracle/eval gate ещё не достигнут.
- [ ] G3 unified `ANALYSIS` runtime/verifier/public UX и safe rich message history реализованы; durable evidence lineage и model-source citation adapter ещё открыты.
- [ ] G4 recommendation/autonomy/feedback.
- [ ] ≥200 eval, ≥40 E2E, held-out/adversarial/backtesting/scale; сейчас 34 legacy + 20 отдельных current-runtime analytical eval.
- [ ] Clean full gate, strict acceptance и scoped fix-loop.
- [ ] Draft PR и Preview exact SHA; Production не затронут.
